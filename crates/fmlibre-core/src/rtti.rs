//! C++ classes by name. The compiler keeps the name of every class with virtual functions, and the game's objects of
//! such a class start with a pointer to its vtable: so the vtables of a class can be found from its name, and its
//! objects from the vtables. Some of the game's data, such as the season's statistics, hangs off nothing the editor
//! reads otherwise.
//!
//! The macOS build follows the Itanium C++ ABI: a vtable is preceded by the offset to the top of the object and a
//! pointer to the class's type info, whose second word points at the mangled name ("15GAME_COMP_STATS",
//! "N2db4TEAME"). On Apple silicon the compiler may set the top bit of that pointer, for a name that is not unique.
//!
//! Windows builds keep MSVC's descriptors instead: a vtable is preceded by a pointer to its complete object locator,
//! which names the class's type descriptor by its offset in the module, and the descriptor holds the mangled name
//! (".?AVGAME_COMP_STATS@@", ".?AVTEAM@db@@") after a vtable pointer and a spare word.

use std::collections::HashMap;
#[cfg(windows)]
use std::ops::Range;

use fmlibre_mem::{Module, Process, Region, regions};

/// Bytes read at a time.
const CHUNK: u64 = 16 << 20;

/// The top bit an Apple silicon build may set in a type info's name pointer.
#[cfg(target_os = "macos")]
const NON_UNIQUE: u64 = 1 << 63;

/// The bytes of a complete object locator (MSVC, x64): signature 1, the offset of the vtable in the object, a
/// constructor displacement, then the offsets in the module of the type descriptor (at +12), of the class hierarchy
/// and of the locator itself (at +20).
#[cfg(windows)]
const LOCATOR: usize = 24;

/// Where a type descriptor (MSVC) holds the class's name: after the pointer to `type_info`'s vtable and a spare word.
#[cfg(windows)]
const DESCRIPTOR_NAME: u64 = 0x10;

/// The name the compiler keeps for `class` (as written in C++, e.g. `db::TEAM`) in this build: [`itanium_name`] on
/// macOS, [`msvc_name`] on Windows.
pub fn mangled(class: &str) -> String {
    if cfg!(target_os = "macos") { itanium_name(class) } else { msvc_name(class) }
}

/// The Itanium mangled name of a class: `GAME_COMP_STATS` is `15GAME_COMP_STATS`, `db::TEAM` is `N2db4TEAME`.
pub fn itanium_name(class: &str) -> String {
    let parts: Vec<String> = class.split("::").map(|part| format!("{}{part}", part.len())).collect();
    match parts.as_slice() {
        [single] => single.clone(),
        _ => format!("N{}E", parts.concat()),
    }
}

/// MSVC's name of a class: `GAME_COMP_STATS` is `.?AVGAME_COMP_STATS@@`, `db::TEAM` is `.?AVTEAM@db@@`. A template's
/// name (`?$…`, as the probe's `types` lists it) is kept as it is.
pub fn msvc_name(class: &str) -> String {
    if class.starts_with("?$") {
        return format!(".?AV{class}@@");
    }
    let mut parts: Vec<&str> = class.split("::").collect();
    parts.reverse();
    format!(".?AV{}@@", parts.join("@"))
}

/// The address points of the vtables the compiler made for `class` (as written in C++, e.g. `db::TEAM`): what the
/// first word of its objects holds. Only the vtables of whole objects, not those of a base inside another class.
#[cfg(target_os = "macos")]
pub fn vtables(process: &Process, plugin: &Module, class: &str) -> Vec<u64> {
    let name = itanium_name(class);
    let needle: Vec<u8> = name.bytes().chain([0]).collect();
    let mut names = Vec::new();
    each_chunk(process, plugin.base, plugin.end(), needle.len(), |base, bytes, limit| {
        let finder = memchr::memmem::Finder::new(&needle);
        for at in finder.find_iter(bytes).filter(|&at| at < limit) {
            // The name must start there, not end a longer one ("P15X" is a pointer's, "N2db15X…E" a nested one's).
            let before = at.checked_sub(1).map_or(0, |i| bytes[i]);
            if !before.is_ascii_alphanumeric() && before != b'_' {
                names.push(base + at as u64);
            }
        }
    });
    if names.is_empty() {
        return Vec::new();
    }
    let named: Vec<u64> = names.iter().flat_map(|&name| [name, name | NON_UNIQUE]).collect();
    // A type info's second word is the name pointer.
    let infos: Vec<u64> =
        words_equal_to(process, plugin.base, plugin.end(), &named).into_iter().map(|at| at - 8).collect();
    // A vtable's type info slot follows the offset to the top of the object, 0 for a whole object.
    words_equal_to(process, plugin.base, plugin.end(), &infos)
        .into_iter()
        .filter(|&at| process.read_u64(at - 8).is_ok_and(|top| top == 0))
        .map(|at| at + 8)
        .collect()
}

/// The address points of the vtables the compiler made for `class` (as written in C++, e.g. `db::TEAM`, a class or a
/// struct): what the first word of its objects holds. Only the vtables of whole objects, not those of a base inside
/// another class.
#[cfg(windows)]
pub fn vtables(process: &Process, plugin: &Module, class: &str) -> Vec<u64> {
    let name = msvc_name(class);
    // A struct's name starts ".?AU" where a class's starts ".?AV".
    let needles: Vec<Vec<u8>> =
        [name.clone(), name.replacen(".?AV", ".?AU", 1)].iter().map(|name| name.bytes().chain([0]).collect()).collect();
    let mut descriptors = Vec::new();
    each_chunk(process, plugin.base, plugin.end(), needles[0].len(), |base, bytes, limit| {
        for needle in &needles {
            for at in memchr::memmem::find_iter(bytes, needle).filter(|&at| at < limit) {
                // Descriptors are 8-byte aligned.
                let descriptor = (base + at as u64).wrapping_sub(DESCRIPTOR_NAME);
                if descriptor.is_multiple_of(8) && plugin.contains(descriptor) {
                    descriptors.push(descriptor - plugin.base);
                }
            }
        }
    });
    if descriptors.is_empty() {
        return Vec::new();
    }
    // The locators of the class's whole objects: the vtable at offset 0 in the object.
    let mut locators = Vec::new();
    each_chunk(process, plugin.base, plugin.end(), LOCATOR, |base, bytes, limit| {
        let words: Vec<u32> = bytes.as_chunks::<4>().0.iter().map(|word| u32::from_le_bytes(*word)).collect();
        for start in 0..words.len().saturating_sub(LOCATOR / 4 - 1) {
            let locator = base + 4 * start as u64;
            if 4 * start < limit
                && descriptors.contains(&u64::from(words[start + 3]))
                && words[start] == 1
                && words[start + 1] == 0
                && u64::from(words[start + 5]) == locator - plugin.base
            {
                locators.push(locator);
            }
        }
    });
    // A vtable is preceded by a pointer to its locator.
    words_equal_to(process, plugin.base, plugin.end(), &locators).into_iter().map(|at| at + 8).collect()
}

/// The mangled name of the class of the object at `object` (see [`mangled`]); `None` when its first word is not a
/// vtable of `plugin`.
#[cfg(target_os = "macos")]
pub fn class_of(process: &Process, plugin: &Module, object: u64) -> Option<String> {
    let vtable = process.read_u64(object).ok()?;
    if !plugin.contains(vtable) {
        return None;
    }
    let info = process.read_u64(vtable - 8).ok()?;
    let name = process.read_u64(info + 8).ok()? & !NON_UNIQUE;
    if !plugin.contains(name) {
        return None;
    }
    let bytes = process.read_bytes(name, 128).ok()?;
    let end = bytes.iter().position(|&b| b == 0)?;
    String::from_utf8(bytes[..end].to_vec()).ok()
}

/// The mangled name of the class of the object at `object` (see [`mangled`]); `None` when its first word is not a
/// vtable of `plugin`.
#[cfg(windows)]
pub fn class_of(process: &Process, plugin: &Module, object: u64) -> Option<String> {
    let vtable = process.read_u64(object).ok()?;
    if !plugin.contains(vtable) {
        return None;
    }
    let locator = process.read_u64(vtable - 8).ok().filter(|&at| plugin.contains(at))?;
    let bytes = process.read_bytes(locator, LOCATOR).ok()?;
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    if word(0) != 1 || u64::from(word(20)) != locator - plugin.base {
        return None;
    }
    let name = process.read_bytes(plugin.base + u64::from(word(12)) + DESCRIPTOR_NAME, 128).ok()?;
    let end = name.iter().position(|&b| b == 0)?;
    String::from_utf8(name[..end].to_vec()).ok()
}

/// The objects on the game's heap whose first word is one of `vtables`, by vtable. One pass over every page of data
/// the game has allocated, which takes a second or two. The threads' stacks are left out: they hold only copies a
/// function made for a while. Fails when the stacks cannot be told apart.
pub fn objects(process: &Process, plugin: &Module, vtables: &[u64]) -> fmlibre_mem::Result<HashMap<u64, Vec<u64>>> {
    let mut found: HashMap<u64, Vec<u64>> = vtables.iter().map(|&vtable| (vtable, Vec::new())).collect();
    if vtables.is_empty() {
        return Ok(found);
    }
    let stacks = Stacks::of(process)?;
    for region in regions(process, 0x1_0000, 0x7FFF_FFFF_0000).into_iter().filter(|r| r.holds_data() && !stacks.hold(r))
    {
        if plugin.contains(region.base) {
            continue;
        }
        let mut offset = 0;
        while offset < region.size {
            let base = region.base + offset;
            let len = (region.size - offset).min(CHUNK);
            if let Ok(bytes) = process.read_bytes(base, len as usize) {
                for (i, word) in bytes.as_chunks::<8>().0.iter().enumerate() {
                    if let Some(objects) = found.get_mut(&u64::from_le_bytes(*word)) {
                        objects.push(base + (i * 8) as u64);
                    }
                }
            }
            offset += CHUNK;
        }
    }
    Ok(found)
}

/// The threads' stacks, which macOS tags as such.
#[cfg(target_os = "macos")]
struct Stacks;

#[cfg(target_os = "macos")]
impl Stacks {
    fn of(_process: &Process) -> fmlibre_mem::Result<Self> {
        Ok(Self)
    }

    fn hold(&self, region: &Region) -> bool {
        const VM_MEMORY_STACK: u32 = 30;
        region.user_tag == VM_MEMORY_STACK
    }
}

/// The threads' stacks, which Windows does not tag: each thread's environment block says where its stack is (see
/// [`fmlibre_mem::thread_stacks`]).
#[cfg(windows)]
struct Stacks(Vec<Range<u64>>);

#[cfg(windows)]
impl Stacks {
    fn of(process: &Process) -> fmlibre_mem::Result<Self> {
        fmlibre_mem::thread_stacks(process).map(Self)
    }

    fn hold(&self, region: &Region) -> bool {
        self.0.iter().any(|stack| stack.contains(&region.base))
    }
}

/// Calls `visit` with each readable stretch of `[start, end)`, `overlap` bytes longer than the part it should look at
/// (`limit`), so that a pattern across two stretches is seen once.
fn each_chunk(process: &Process, start: u64, end: u64, overlap: usize, mut visit: impl FnMut(u64, &[u8], usize)) {
    for region in regions(process, start, end).into_iter().filter(|r| r.is_readable()) {
        let mut offset = 0;
        while offset < region.size {
            let base = region.base + offset;
            let limit = (region.size - offset).min(CHUNK);
            let len = (region.size - offset).min(CHUNK + overlap as u64);
            if let Ok(bytes) = process.read_bytes(base, len as usize) {
                visit(base, &bytes, limit as usize);
            }
            offset += CHUNK;
        }
    }
}

/// The addresses of the 8-byte aligned words in `[start, end)` that hold one of `values`.
fn words_equal_to(process: &Process, start: u64, end: u64, values: &[u64]) -> Vec<u64> {
    let mut found = Vec::new();
    each_chunk(process, start, end, 0, |base, bytes, _| {
        for (i, word) in bytes.as_chunks::<8>().0.iter().enumerate() {
            if values.contains(&u64::from_le_bytes(*word)) {
                found.push(base + (i * 8) as u64);
            }
        }
    });
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_mangled_as_the_compiler_keeps_them() {
        assert_eq!(itanium_name("GAME_COMP_STATS"), "15GAME_COMP_STATS");
        assert_eq!(itanium_name("db::TEAM"), "N2db4TEAME");
        assert_eq!(itanium_name("sicomps::FRIENDLY_ACTUAL_COMP"), "N7sicomps20FRIENDLY_ACTUAL_COMPE");
        assert_eq!(msvc_name("RETIREMENT_MANAGER"), ".?AVRETIREMENT_MANAGER@@");
        assert_eq!(msvc_name("db::TEAM"), ".?AVTEAM@db@@");
        assert_eq!(
            msvc_name("simatch::PREPARED_TACTICS_CREATOR_ARRAY"),
            ".?AVPREPARED_TACTICS_CREATOR_ARRAY@simatch@@"
        );
    }
}
