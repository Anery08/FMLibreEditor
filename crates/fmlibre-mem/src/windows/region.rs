use std::ffi::c_void;

use windows_sys::Win32::System::Memory::{
    MEM_COMMIT, MEM_IMAGE, MEM_PRIVATE, MEMORY_BASIC_INFORMATION, PAGE_EXECUTE, PAGE_EXECUTE_READ,
    PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_NOACCESS, PAGE_READWRITE, PAGE_WRITECOPY,
    VirtualQueryEx,
};

use super::process::Process;

/// A run of pages with identical state and protection, as reported by `VirtualQueryEx`.
#[derive(Debug, Clone, Copy)]
pub struct Region {
    pub base: u64,
    pub size: u64,
    pub allocation_base: u64,
    pub state: u32,
    pub protect: u32,
    pub kind: u32,
}

impl Region {
    pub fn end(&self) -> u64 {
        self.base + self.size
    }

    pub fn is_committed(&self) -> bool {
        self.state == MEM_COMMIT
    }

    pub fn is_image(&self) -> bool {
        self.kind == MEM_IMAGE
    }

    /// Memory the process allocated for itself (heaps), as opposed to a mapped file or module.
    pub fn is_private(&self) -> bool {
        self.kind == MEM_PRIVATE
    }

    /// Whether the editor may write here: committed heap data, writable and not executable.
    pub fn holds_data(&self) -> bool {
        self.is_private() && self.is_writable() && !self.is_executable()
    }

    /// Whether the editor may write one of a module's statics here: committed memory of a module's image that the
    /// process writes and does not run, its data and not its code.
    pub fn holds_statics(&self) -> bool {
        self.is_image() && self.is_committed() && self.is_writable() && !self.is_executable()
    }

    pub fn is_readable(&self) -> bool {
        self.is_committed() && self.protect != 0 && self.protect & (PAGE_NOACCESS | PAGE_GUARD) == 0
    }

    pub fn is_writable(&self) -> bool {
        const WRITABLE: u32 = PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        self.is_readable() && self.protect & WRITABLE != 0
    }

    pub fn is_executable(&self) -> bool {
        const EXECUTABLE: u32 = PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        self.is_readable() && self.protect & EXECUTABLE != 0
    }

    /// Protection as a short "RWX" string, e.g. "RW-" or "R-X".
    pub fn protection(&self) -> String {
        if !self.is_readable() {
            return "---".to_owned();
        }
        let w = if self.is_writable() { 'W' } else { '-' };
        let x = if self.is_executable() { 'X' } else { '-' };
        format!("R{w}{x}")
    }
}

/// Walks the address space of `process` between `start` and `end`.
pub fn regions(process: &Process, start: u64, end: u64) -> Vec<Region> {
    let mut out = Vec::new();
    let mut addr = start;
    while addr < end {
        let Some(region) = region_at(process, addr) else {
            break;
        };
        out.push(region);
        addr = region.end();
    }
    out
}

/// The region that contains `addr`.
pub fn region_at(process: &Process, addr: u64) -> Option<Region> {
    let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    let written = unsafe {
        VirtualQueryEx(process.raw_handle(), addr as *const c_void, &mut mbi, size_of::<MEMORY_BASIC_INFORMATION>())
    };
    if written == 0 || mbi.RegionSize == 0 {
        return None;
    }
    Some(Region {
        base: mbi.BaseAddress as u64,
        size: mbi.RegionSize as u64,
        allocation_base: mbi.AllocationBase as u64,
        state: mbi.State,
        protect: mbi.Protect,
        kind: mbi.Type,
    })
}
