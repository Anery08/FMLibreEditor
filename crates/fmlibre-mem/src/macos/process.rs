use std::ffi::c_int;
use std::ops::Range;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use mach2::kern_return::KERN_SUCCESS;
use mach2::mach_port::{mach_port_deallocate, mach_port_mod_refs};
use mach2::port::{MACH_PORT_RIGHT_SEND, mach_port_t};
use mach2::traps::{mach_task_self, task_for_pid};
use mach2::vm::{mach_vm_allocate, mach_vm_read_overwrite, mach_vm_write};
use mach2::vm_statistics::VM_FLAGS_ANYWHERE;
use mach2::vm_types::{mach_vm_address_t, mach_vm_size_t};

use super::bridge::request_task;
use super::module::list_modules;
use super::region::region_at;
use crate::error::{Error, Result};

/// A process seen in the process list; not opened.
#[derive(Debug, Clone)]
pub struct ProcessEntry {
    pub pid: u32,
    pub exe_name: String,
}

/// Lists running processes whose executable name equals `exe_name`, ignoring case.
pub fn find_processes(exe_name: &str) -> Result<Vec<ProcessEntry>> {
    let needed = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if needed < 0 {
        return Err(Error::last_posix("proc_listallpids"));
    }
    // Room for processes that start meanwhile.
    let mut pids = vec![0 as c_int; needed as usize + 64];
    let size = (pids.len() * size_of::<c_int>()) as c_int;
    let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), size) };
    if count < 0 {
        return Err(Error::last_posix("proc_listallpids"));
    }
    pids.truncate(count as usize);

    let mut found = Vec::new();
    for pid in pids.into_iter().filter(|&pid| pid > 0) {
        // The name is the executable's file name, cut to 32 bytes.
        let mut buf = [0u8; 64];
        let len = unsafe { libc::proc_name(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if len <= 0 {
            continue;
        }
        let name = String::from_utf8_lossy(&buf[..len as usize]);
        if name.eq_ignore_ascii_case(exe_name) {
            found.push(ProcessEntry { pid: pid as u32, exe_name: name.into_owned() });
        }
    }
    Ok(found)
}

/// Whether this process runs as root. That does not open the game on macOS, unlike being
/// an administrator on Windows; it is reported all the same.
pub fn is_current_process_elevated() -> bool {
    unsafe { libc::geteuid() == 0 }
}

/// Whether this Mac has Apple silicon, also when this process runs as Intel code under Rosetta.
pub fn is_apple_silicon() -> bool {
    let mut value: c_int = 0;
    let mut size = size_of::<c_int>();
    let read = unsafe {
        libc::sysctlbyname(c"hw.optional.arm64".as_ptr(), (&raw mut value).cast(), &mut size, std::ptr::null_mut(), 0)
    };
    read == 0 && value == 1
}

/// How long the places of the modules are trusted before they are read again.
const MODULES_FRESH: Duration = Duration::from_secs(30);

/// The tag of the memory the editor takes in the game (`VM_MEMORY_APPLICATION_SPECIFIC_1`), in the high byte of the
/// flags of `mach_vm_allocate`.
const EDITOR_MEMORY_TAG: i32 = 240;

/// A process opened through its task port, for reading memory, and for writing it only when
/// opened with [`Process::open_read_write`].
pub struct Process {
    task: mach_port_t,
    pid: u32,
    writable: bool,
    /// Where the modules are mapped, and when that was read: a write never goes there.
    modules: Mutex<Option<(Instant, Vec<Range<u64>>)>>,
}

// A task port is a number in this process's port space; Mach calls on it are thread-safe.
unsafe impl Send for Process {}
unsafe impl Sync for Process {}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe { mach_port_deallocate(mach_task_self(), self.task) };
    }
}

impl Process {
    pub fn open_read(pid: u32) -> Result<Self> {
        Self::open(pid, false)
    }

    /// Opens `pid` for reading and also for writing its memory with [`Process::write_bytes`].
    pub fn open_read_write(pid: u32) -> Result<Self> {
        Self::open(pid, true)
    }

    fn open(pid: u32, writable: bool) -> Result<Self> {
        Ok(Self { task: task_port(pid)?, pid, writable, modules: Mutex::new(None) })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether the process was opened for writing.
    pub fn can_write(&self) -> bool {
        self.writable
    }

    pub(crate) fn task(&self) -> mach_port_t {
        self.task
    }

    /// Full path of the process executable.
    pub fn image_path(&self) -> Result<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let len = unsafe { libc::proc_pidpath(self.pid as c_int, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if len <= 0 {
            return Err(Error::last_posix("proc_pidpath"));
        }
        buf.truncate(len as usize);
        Ok(PathBuf::from(std::ffi::OsString::from_vec(buf)))
    }

    /// Always `None`: games on macOS come as plain app bundles, with no package identity
    /// like the Microsoft Store's.
    pub fn package_full_name(&self) -> Result<Option<String>> {
        Ok(None)
    }

    /// Fills `buf` from target memory at `addr`; fails unless every byte could be read.
    pub fn read_into(&self, addr: u64, buf: &mut [u8]) -> Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        let mut read: mach_vm_size_t = 0;
        let code = unsafe {
            mach_vm_read_overwrite(self.task, addr, buf.len() as mach_vm_size_t, buf.as_mut_ptr() as u64, &mut read)
        };
        if code != KERN_SUCCESS || read != buf.len() as mach_vm_size_t {
            return Err(Error::Read { addr, len: buf.len(), code: code as u32 });
        }
        Ok(())
    }

    pub fn read_bytes(&self, addr: u64, len: usize) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; len];
        self.read_into(addr, &mut buf)?;
        Ok(buf)
    }

    pub fn read_u64(&self, addr: u64) -> Result<u64> {
        let mut b = [0u8; 8];
        self.read_into(addr, &mut b)?;
        Ok(u64::from_le_bytes(b))
    }

    pub fn read_u32(&self, addr: u64) -> Result<u32> {
        let mut b = [0u8; 4];
        self.read_into(addr, &mut b)?;
        Ok(u32::from_le_bytes(b))
    }

    /// Writes `data` at `addr`; fails unless every byte was written.
    ///
    /// Only heap data can be written: the whole range must lie in one region of
    /// private, writable and non-executable memory that no file backs, outside every
    /// module. Anything else, such as a module's code or data, is refused before the
    /// kernel is asked.
    pub fn write_bytes(&self, addr: u64, data: &[u8]) -> Result<()> {
        if !self.writable {
            return Err(Error::ReadOnly);
        }
        self.write_checked(addr, data)
    }

    /// Takes `len` bytes of new memory in the process: private, readable and writable, zeroed, anywhere in its address
    /// space (`mach_vm_allocate` on its task port, as on Windows `VirtualAllocEx`). For data the editor gives the game
    /// where the game's own blocks have no room, such as a longer name. The game's allocator knows nothing of it: a
    /// block of it may be handed to the game to let go of only where the game's allocator takes it into its own lists
    /// of free blocks, never where the game would hand it to `free()`, which stops the game for a block `malloc` never
    /// gave out. Tagged `VM_MEMORY_APPLICATION_SPECIFIC_1`, so that `vmmap` shows it apart from the game's; it is not
    /// given back while the game runs.
    pub fn allocate(&self, len: usize) -> Result<u64> {
        if !self.writable {
            return Err(Error::ReadOnly);
        }
        let mut at: mach_vm_address_t = 0;
        let flags = VM_FLAGS_ANYWHERE | (EDITOR_MEMORY_TAG << 24);
        let code = unsafe { mach_vm_allocate(self.task, &mut at, len as mach_vm_size_t, flags) };
        if code != KERN_SUCCESS {
            return Err(Error::Mach { op: "mach_vm_allocate", code });
        }
        Ok(at)
    }

    /// The editor writes no module's statics on macOS (see the Windows `write_static`): refused.
    pub fn write_static(&self, addr: u64, data: &[u8]) -> Result<()> {
        if !self.writable {
            return Err(Error::ReadOnly);
        }
        Err(Error::NotWritable { addr, len: data.len() })
    }

    fn write_checked(&self, addr: u64, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let len = data.len();
        let end = addr.checked_add(len as u64).ok_or(Error::NotWritable { addr, len })?;
        match region_at(self, addr) {
            Some(region) if region.holds_data() && end <= region.end() => {}
            _ => return Err(Error::NotWritable { addr, len }),
        }
        // The kernel reports a module's data pages that the process has written to as the
        // process's own memory, so the modules' places decide.
        if self.in_a_module(addr..end)? {
            return Err(Error::NotWritable { addr, len });
        }
        let count = u32::try_from(len).map_err(|_| Error::NotWritable { addr, len })?;
        let code = unsafe { mach_vm_write(self.task, addr, data.as_ptr() as usize, count) };
        if code != KERN_SUCCESS {
            return Err(Error::Write { addr, len, code: code as u32 });
        }
        Ok(())
    }
}

impl Process {
    /// Whether `range` overlaps a module (the executable, a library or a bundle).
    fn in_a_module(&self, range: Range<u64>) -> Result<bool> {
        let mut modules = self.modules.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let fresh = modules.as_ref().is_some_and(|(read, _)| read.elapsed() < MODULES_FRESH);
        if !fresh {
            let places = list_modules(self)?.iter().map(|module| module.base..module.end()).collect();
            *modules = Some((Instant::now(), places));
        }
        let (_, places) = modules.as_ref().expect("the places were just read");
        Ok(places.iter().any(|place| range.start < place.end && place.start < range.end))
    }
}

/// The task port of `pid`: this process's own, the one the bridge in the game hands over,
/// or the one macOS gives a debugger. macOS gives a debugger the game's only when System
/// Integrity Protection's debugging restrictions are off.
fn task_port(pid: u32) -> Result<mach_port_t> {
    let task = unsafe { mach_task_self() };
    if pid == std::process::id() {
        // Another reference to this process's own port, for Process to release.
        let code = unsafe { mach_port_mod_refs(task, task, MACH_PORT_RIGHT_SEND, 1) };
        return if code == KERN_SUCCESS { Ok(task) } else { Err(Error::Mach { op: "mach_port_mod_refs", code }) };
    }
    if let Some(port) = request_task(pid)? {
        return Ok(port);
    }
    let mut port = 0;
    match unsafe { task_for_pid(task, pid as c_int, &mut port) } {
        KERN_SUCCESS => Ok(port),
        _ => Err(Error::NoBridge { pid }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static IN_THE_IMAGE: [u8; 8] = [0; 8];
    // Writable, but part of the module's image all the same.
    static WRITABLE_IN_THE_IMAGE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    #[test]
    fn writes_heap_data_only() {
        let process = Process::open_read_write(std::process::id()).expect("open this process");
        let heap = vec![0u8; 64].into_boxed_slice();
        let addr = heap.as_ptr() as u64;

        process.write_bytes(addr + 8, &[1, 2, 3]).expect("write into the heap");
        assert_eq!(process.read_bytes(addr + 6, 6).expect("read back"), [0, 0, 1, 2, 3, 0]);

        // A module's own memory, data or code, is never written.
        WRITABLE_IN_THE_IMAGE.store(7, std::sync::atomic::Ordering::Relaxed);
        let image = IN_THE_IMAGE.as_ptr() as u64;
        assert!(matches!(process.write_bytes(image, &[1]), Err(Error::NotWritable { .. })));
        let data = WRITABLE_IN_THE_IMAGE.as_ptr() as u64;
        assert!(matches!(process.write_bytes(data, &[1]), Err(Error::NotWritable { .. })));
        let code = writes_heap_data_only as *const () as u64;
        assert!(matches!(process.write_bytes(code, &[0xCC]), Err(Error::NotWritable { .. })));
        assert!(matches!(process.write_bytes(0x10, &[1]), Err(Error::NotWritable { .. })));

        let read_only = Process::open_read(std::process::id()).expect("open this process");
        assert!(matches!(read_only.write_bytes(addr, &[1]), Err(Error::ReadOnly)));
        drop(heap);
    }

    #[test]
    fn allocates_writable_memory_only_when_open_for_writing() {
        let process = Process::open_read_write(std::process::id()).expect("open this process");
        let at = process.allocate(0x1000).expect("allocate");
        assert_eq!(process.read_bytes(at, 4).expect("read it"), [0, 0, 0, 0]);
        // The editor's write guard takes it for heap data: private, writable, outside every module.
        process.write_bytes(at + 16, b"FMLE").expect("write into it");
        assert_eq!(process.read_bytes(at + 16, 4).expect("read back"), *b"FMLE");
        let region = region_at(&process, at).expect("its region");
        assert_eq!(region.user_tag, EDITOR_MEMORY_TAG as u32);
        let read_only = Process::open_read(std::process::id()).expect("open this process");
        assert!(matches!(read_only.allocate(0x1000), Err(Error::ReadOnly)));
    }

    #[test]
    fn finds_this_process() {
        let path = Process::open_read(std::process::id()).and_then(|p| p.image_path()).expect("own path");
        let name = path.file_name().and_then(|n| n.to_str()).expect("a file name");
        // proc_name cuts names to 32 bytes; test binaries are named longer.
        let short: String = name.chars().take(32).collect();
        let found = find_processes(&short).expect("list processes");
        assert!(found.iter().any(|p| p.pid == std::process::id()));
    }
}
