//! Memory the editor takes in the game, for what does not fit where the game put it: a stadium's longer name (see
//! `stadium_name.rs`), a list of relations with room for one more (see `relations.rs`).
//!
//! It takes it 64 KiB at a time (`Process::allocate`: `VirtualAllocEx` on Windows, `mach_vm_allocate` on macOS; private,
//! read-write, no code) and hands it out in blocks of 16 bytes and more, one after another, each zeroed; it never gives
//! any back, so whatever the game does with a block later, the memory stays. Where it cannot take memory, nothing that
//! needs it is offered.
//!
//! A list's buffer of the editor's own is one the game lets go of one day, and its allocator takes such a block into
//! its class's list of free blocks without looking where it is (see the Mac notes, "The game's allocator"). So the
//! block is as large as the game's allocator gives a buffer of that capacity, for the game to hand out again, and no
//! larger than the largest block it hands out (`[heap] largest_block`): a larger one it would give to the system's
//! `free()`, which on macOS stops the game for memory `malloc` never gave out.

use std::sync::PoisonError;

use crate::session::Session;
use crate::transfer::MoveError;

/// Whether the editor can take memory in the game.
pub(crate) const CAN_ALLOCATE: bool = cfg!(any(windows, target_os = "macos"));

/// How much memory it takes at a time, unless one block needs more.
const POOL: u64 = 0x1_0000;

/// Blocks start at multiples of this many bytes, as the game's allocator's do.
const ALIGN: u64 = 16;

impl Session {
    /// The size of the block of the editor's own a list's buffer of `bytes` gets: as large as the game's allocator
    /// gives a buffer of that capacity. None where the game would let go of such a buffer through the system's
    /// allocator (past `[heap] largest_block`): such a list is not grown.
    pub(crate) fn grown_block_size(&self, bytes: u64) -> Option<u64> {
        self.layout.heap.grown_block(bytes)
    }

    /// A block of at least `size` bytes of memory of the editor's own, zeroed: the next of its pool, or the first of a
    /// new one when the last is used up.
    pub(crate) fn own_block(&self, size: u64) -> Result<u64, MoveError> {
        let size = size.div_ceil(ALIGN) * ALIGN;
        let mut pool = self.own_memory.lock().unwrap_or_else(PoisonError::into_inner);
        let (region, length, used) = match *pool {
            Some((region, length, used)) if used + size <= length => (region, length, used),
            _ => {
                let length = POOL.max(size);
                (self.process.allocate(length as usize)?, length, 0)
            }
        };
        *pool = Some((region, length, used + size));
        Ok(region + used)
    }
}
