//! Access to another process's memory on Windows and macOS.
//!
//! This crate knows nothing about Football Manager. It finds and opens
//! processes, lists their modules and memory regions, reads bytes and parses
//! module headers (PE on Windows, Mach-O on macOS) straight from the target's
//! memory. It writes only through [`Process::write_bytes`], on a process opened
//! for writing, and only into heap data: never into a module's code or data.
//!
//! macOS opens another process's memory only to a debugger, and only when the process
//! allows it, which the game does not. The game hands its memory over itself instead,
//! through the small library of `fmlibre-bridge` that it loads at start; [`bridge`] is
//! what the two sides say to each other.

#![cfg(any(windows, target_os = "macos"))]

mod error;
mod module;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

pub use error::{Error, Result};
#[cfg(target_os = "macos")]
pub use macos::{
    MachImage, MachSection, Process, ProcessEntry, Region, Segment, bridge, find_processes, is_apple_silicon,
    is_current_process_elevated, list_modules, region_at, regions,
};
pub use module::Module;
#[cfg(windows)]
pub use windows::{
    Export, PeImage, Process, ProcessEntry, Region, Section, find_processes, is_current_process_elevated, list_modules,
    region_at, regions,
};

/// Whether `p` looks like a user-mode pointer: 8-byte aligned and inside the
/// canonical user address range of a 64-bit process, on Windows and on macOS alike.
pub fn is_user_pointer(p: u64) -> bool {
    p.is_multiple_of(8) && (0x1_0000..0x7FFF_FFFF_0000).contains(&p)
}
