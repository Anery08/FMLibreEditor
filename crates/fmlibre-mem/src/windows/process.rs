use std::ffi::c_void;
use std::path::PathBuf;

use windows_sys::Win32::Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE};
use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
use windows_sys::Win32::Storage::Packaging::Appx::GetPackageFullName;
use windows_sys::Win32::System::Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{MEM_COMMIT, MEM_RESERVE, PAGE_READWRITE, VirtualAllocEx};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_ACCESS_RIGHTS, PROCESS_NAME_WIN32,
    PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE, QueryFullProcessImageNameW,
};

use super::handle::{OwnedHandle, create_snapshot, from_wide};
use super::region::region_at;
use crate::error::{Error, Result, last_error};

/// A process seen in a system snapshot; not opened.
#[derive(Debug, Clone)]
pub struct ProcessEntry {
    pub pid: u32,
    pub exe_name: String,
}

/// Lists running processes whose executable name equals `exe_name`, ignoring case.
pub fn find_processes(exe_name: &str) -> Result<Vec<ProcessEntry>> {
    let snapshot = create_snapshot(TH32CS_SNAPPROCESS, 0)?;
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

    let mut found = Vec::new();
    let mut more = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while more {
        let name = from_wide(&entry.szExeFile);
        if name.eq_ignore_ascii_case(exe_name) {
            found.push(ProcessEntry { pid: entry.th32ProcessID, exe_name: name });
        }
        more = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(found)
}

/// Whether this process runs elevated (as administrator).
pub fn is_current_process_elevated() -> bool {
    let mut token: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return false;
    }
    let token = OwnedHandle(token);
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned = 0u32;
    let ok = unsafe {
        GetTokenInformation(
            token.0,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    };
    ok != 0 && elevation.TokenIsElevated != 0
}

/// A process opened for querying and reading memory, and for writing it only when
/// opened with [`Process::open_read_write`].
pub struct Process {
    handle: OwnedHandle,
    pid: u32,
    writable: bool,
}

// Process handles may be used from any thread; ReadProcessMemory and WriteProcessMemory are thread-safe.
unsafe impl Send for Process {}
unsafe impl Sync for Process {}

impl Process {
    pub fn open_read(pid: u32) -> Result<Self> {
        Self::open(pid, PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false)
    }

    /// Opens `pid` for reading and also for writing its memory with [`Process::write_bytes`].
    pub fn open_read_write(pid: u32) -> Result<Self> {
        let access = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION;
        Self::open(pid, access, true)
    }

    fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS, writable: bool) -> Result<Self> {
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return Err(Error::last("OpenProcess"));
        }
        Ok(Self { handle: OwnedHandle(handle), pid, writable })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether the process was opened for writing.
    pub fn can_write(&self) -> bool {
        self.writable
    }

    pub(crate) fn raw_handle(&self) -> HANDLE {
        self.handle.0
    }

    /// Full path of the process executable.
    pub fn image_path(&self) -> Result<PathBuf> {
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(self.handle.0, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) };
        if ok == 0 {
            return Err(Error::last("QueryFullProcessImageNameW"));
        }
        Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
    }

    /// Package full name of a packaged (Microsoft Store / Game Pass) process, `None` otherwise.
    pub fn package_full_name(&self) -> Result<Option<String>> {
        let mut len = 0u32;
        match unsafe { GetPackageFullName(self.handle.0, &mut len, std::ptr::null_mut()) } {
            APPMODEL_ERROR_NO_PACKAGE => return Ok(None),
            ERROR_INSUFFICIENT_BUFFER => {}
            code => return Err(Error::Win32 { op: "GetPackageFullName", code }),
        }
        let mut buf = vec![0u16; len as usize];
        match unsafe { GetPackageFullName(self.handle.0, &mut len, buf.as_mut_ptr()) } {
            ERROR_SUCCESS => Ok(Some(from_wide(&buf))),
            code => Err(Error::Win32 { op: "GetPackageFullName", code }),
        }
    }

    /// Fills `buf` from target memory at `addr`; fails unless every byte could be read.
    pub fn read_into(&self, addr: u64, buf: &mut [u8]) -> Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        let mut read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(self.handle.0, addr as *const c_void, buf.as_mut_ptr().cast(), buf.len(), &mut read)
        };
        if ok == 0 || read != buf.len() {
            return Err(Error::Read { addr, len: buf.len(), code: last_error() });
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
    /// Takes `len` bytes of new memory in the process: private, readable and writable, zeroed. For data the editor
    /// gives the game where the game's own blocks have no room, such as a longer name. The game's allocator knows
    /// nothing of it, so what lives there must never be handed to the game to let go of (see the count of holders the
    /// editor gives its strings). It is not given back while the game runs.
    pub fn allocate(&self, len: usize) -> Result<u64> {
        if !self.writable {
            return Err(Error::ReadOnly);
        }
        let at =
            unsafe { VirtualAllocEx(self.handle.0, std::ptr::null(), len, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) };
        if at.is_null() {
            return Err(Error::Win32 { op: "VirtualAllocEx", code: last_error() });
        }
        Ok(at as u64)
    }

    /// Only heap data can be written: the whole range must lie in one region of
    /// committed, private, writable and non-executable memory. Anything else, such as
    /// a module's code or data, is refused before Windows is asked, because
    /// `WriteProcessMemory` would otherwise lift a page's protection to write it.
    pub fn write_bytes(&self, addr: u64, data: &[u8]) -> Result<()> {
        if !self.writable {
            return Err(Error::ReadOnly);
        }
        if data.is_empty() {
            return Ok(());
        }
        let len = data.len();
        let end = addr.checked_add(len as u64).ok_or(Error::NotWritable { addr, len })?;
        match region_at(self, addr) {
            Some(region) if region.holds_data() && end <= region.end() => {}
            _ => return Err(Error::NotWritable { addr, len }),
        }
        let mut written = 0usize;
        let ok = unsafe {
            WriteProcessMemory(self.handle.0, addr as *const c_void, data.as_ptr().cast(), len, &mut written)
        };
        if ok == 0 || written != len {
            return Err(Error::Write { addr, len, code: last_error() });
        }
        Ok(())
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
        process.write_bytes(at + 16, b"FMLE").expect("write into it");
        assert_eq!(process.read_bytes(at + 16, 4).expect("read back"), *b"FMLE");
        let read_only = Process::open_read(std::process::id()).expect("open this process");
        assert!(matches!(read_only.allocate(0x1000), Err(Error::ReadOnly)));
    }
}
