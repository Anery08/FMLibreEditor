//! macOS: processes from libproc, modules from dyld's image list, memory through the
//! game's task port, which the bridge library in the game hands over (see [`bridge`]).

pub mod bridge;
mod macho;
mod module;
mod process;
mod region;

use std::ffi::{CStr, c_char};

use mach2::kern_return::kern_return_t;

pub use macho::{MachImage, MachSection, Segment};
pub use module::list_modules;
pub use process::{Process, ProcessEntry, find_processes, is_apple_silicon, is_current_process_elevated};
pub use region::{Region, region_at, regions};

unsafe extern "C" {
    fn mach_error_string(error_value: kern_return_t) -> *const c_char;
}

/// The system's words for a `kern_return_t`, e.g. "(os/kern) invalid address".
pub(crate) fn mach_error_text(code: kern_return_t) -> String {
    let text = unsafe { mach_error_string(code) };
    if text.is_null() {
        return "unknown error".to_owned();
    }
    unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned()
}
