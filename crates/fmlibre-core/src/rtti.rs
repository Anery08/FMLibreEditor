//! C++ classes by name. The compiler keeps the name of every class with virtual functions, and the game's objects of
//! such a class start with a pointer to its vtable: so the vtables of a class can be found from its name, and its
//! objects from the vtables. Some of the game's data, such as the season's statistics, hangs off nothing the editor
//! reads otherwise.
//!
//! The macOS build follows the Itanium C++ ABI: a vtable is preceded by the offset to the top of the object and a
//! pointer to the class's type info, whose second word points at the mangled name ("15GAME_COMP_STATS",
//! "N2db4TEAME"). On Apple silicon the compiler may set the top bit of that pointer, for a name that is not unique.
//! Windows builds keep MSVC's descriptors instead, which this module does not read: there it finds no class.

use std::collections::HashMap;

use fmlibre_mem::{Module, Process, Region, regions};

/// Bytes read at a time.
const CHUNK: u64 = 16 << 20;

/// The top bit an Apple silicon build may set in a type info's name pointer.
const NON_UNIQUE: u64 = 1 << 63;

/// The Itanium mangled name of a class: `GAME_COMP_STATS` is `15GAME_COMP_STATS`, `db::TEAM` is `N2db4TEAME`.
pub fn mangled(class: &str) -> String {
    let parts: Vec<String> = class.split("::").map(|part| format!("{}{part}", part.len())).collect();
    match parts.as_slice() {
        [single] => single.clone(),
        _ => format!("N{}E", parts.concat()),
    }
}

/// The address points of the vtables the compiler made for `class` (as written in C++, e.g. `db::TEAM`): what the
/// first word of its objects holds. Only the vtables of whole objects, not those of a base inside another class.
pub fn vtables(process: &Process, plugin: &Module, class: &str) -> Vec<u64> {
    let name = mangled(class);
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

/// The mangled name of the class of the object at `object` (see [`mangled`]); `None` when its first word is not a
/// vtable of `plugin`.
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

/// The objects on the game's heap whose first word is one of `vtables`, by vtable. One pass over every page of data
/// the game has allocated, which takes a second or two. The threads' stacks are left out: they hold only copies a
/// function made for a while.
pub fn objects(process: &Process, plugin: &Module, vtables: &[u64]) -> HashMap<u64, Vec<u64>> {
    let mut found: HashMap<u64, Vec<u64>> = vtables.iter().map(|&vtable| (vtable, Vec::new())).collect();
    if vtables.is_empty() {
        return found;
    }
    for region in regions(process, 0x1_0000, 0x7FFF_FFFF_0000).into_iter().filter(|r| r.holds_data() && !is_stack(r)) {
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
    found
}

/// Whether `region` is a thread's stack, which macOS tags as such.
#[cfg(target_os = "macos")]
fn is_stack(region: &Region) -> bool {
    const VM_MEMORY_STACK: u32 = 30;
    region.user_tag == VM_MEMORY_STACK
}

/// Windows does not tag a stack; its builds name no class this module reads, so it never looks for objects there.
#[cfg(windows)]
fn is_stack(_region: &Region) -> bool {
    false
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
        assert_eq!(mangled("GAME_COMP_STATS"), "15GAME_COMP_STATS");
        assert_eq!(mangled("db::TEAM"), "N2db4TEAME");
        assert_eq!(mangled("sicomps::FRIENDLY_ACTUAL_COMP"), "N7sicomps20FRIENDLY_ACTUAL_COMPE");
    }
}
