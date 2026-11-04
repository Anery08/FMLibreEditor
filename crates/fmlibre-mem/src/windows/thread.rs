use std::ops::Range;

use windows_sys::Wdk::System::Threading::{NtQueryInformationThread, ThreadBasicInformation};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::Threading::{OpenThread, THREAD_QUERY_LIMITED_INFORMATION};

use super::handle::{OwnedHandle, create_snapshot};
use super::process::Process;
use super::region::region_at;
use crate::error::{Error, Result};

/// What `NtQueryInformationThread` gives for `ThreadBasicInformation` in a 64-bit process, which the Windows SDK
/// does not declare.
#[repr(C)]
#[derive(Default)]
struct BasicInformation {
    exit_status: i32,
    /// The thread's environment block (TEB) in its process.
    teb: u64,
    client_id: [u64; 2],
    affinity_mask: u64,
    priority: i32,
    base_priority: i32,
}

/// A TEB starts with an `NT_TIB`, which holds the top of the thread's stack and the lowest address it has grown to.
const STACK_BASE: u64 = 0x08;
const STACK_LIMIT: u64 = 0x10;

/// The stacks of the threads of `process`, each the whole range reserved for it, from the bottom of its allocation up
/// to its top. Windows does not tag a stack's memory as such, but each thread's environment block says where its
/// stack is. A thread that ends meanwhile is left out; one Windows will not open is an error.
pub fn thread_stacks(process: &Process) -> Result<Vec<Range<u64>>> {
    let snapshot = create_snapshot(TH32CS_SNAPTHREAD, 0)?;
    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<THREADENTRY32>() as u32;

    let mut stacks = Vec::new();
    let mut more = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
    while more {
        if entry.th32OwnerProcessID == process.pid() {
            stacks.extend(stack_of(process, entry.th32ThreadID)?);
        }
        more = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
    }
    Ok(stacks)
}

/// The stack of the thread `tid` of `process`, or `None` when the thread has ended.
fn stack_of(process: &Process, tid: u32) -> Result<Option<Range<u64>>> {
    let handle = unsafe { OpenThread(THREAD_QUERY_LIMITED_INFORMATION, 0, tid) };
    if handle.is_null() {
        let err = Error::last("OpenThread");
        return if err.is_access_denied() { Err(err) } else { Ok(None) };
    }
    let handle = OwnedHandle(handle);
    let mut info = BasicInformation::default();
    let status = unsafe {
        NtQueryInformationThread(
            handle.0,
            ThreadBasicInformation,
            (&raw mut info).cast(),
            size_of::<BasicInformation>() as u32,
            std::ptr::null_mut(),
        )
    };
    if status < 0 {
        return Err(Error::Win32 { op: "NtQueryInformationThread", code: status as u32 });
    }
    // The environment block of a thread that has just ended may be gone.
    let (Ok(top), Ok(limit)) = (process.read_u64(info.teb + STACK_BASE), process.read_u64(info.teb + STACK_LIMIT))
    else {
        return Ok(None);
    };
    // A stack grows down from its top inside the one allocation reserved for it when the thread started.
    let bottom = region_at(process, limit).map_or(limit, |region| region.allocation_base);
    Ok(Some(bottom..top))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_stack_of_each_thread() {
        let process = Process::open_read(std::process::id()).expect("open this process");
        let here = 0u64;
        let address = &here as *const u64 as u64;
        let (sender, receiver) = std::sync::mpsc::channel();
        let (done, wait) = std::sync::mpsc::channel::<()>();
        let other = std::thread::spawn(move || {
            let there = 0u64;
            sender.send(&there as *const u64 as u64).expect("send");
            wait.recv().ok();
        });
        let elsewhere = receiver.recv().expect("the other thread's stack");

        let stacks = thread_stacks(&process).expect("this process's stacks");
        assert!(stacks.iter().any(|stack| stack.contains(&address)), "this thread's: {stacks:x?}");
        assert!(stacks.iter().any(|stack| stack.contains(&elsewhere)), "the other thread's: {stacks:x?}");
        let heap = Box::new(0u64);
        assert!(!stacks.iter().any(|stack| stack.contains(&(&*heap as *const u64 as u64))), "the heap is no stack");

        done.send(()).ok();
        other.join().expect("the other thread");
    }
}
