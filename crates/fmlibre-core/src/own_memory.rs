//! Memory the editor takes in the game, for what does not fit where the game put it: a stadium's longer name (see
//! `stadium_name.rs`), a list of relations with room for one more (see `relations.rs`).
//!
//! It takes it 64 KiB at a time (`Process::allocate`, `VirtualAllocEx`: private, read-write, no code) and hands it out
//! in blocks of 16 bytes and more, one after another, each zeroed; it never gives any back, so whatever the game does
//! with a block later, the memory stays. Where it cannot take memory (macOS), nothing that needs it is offered.

use std::sync::PoisonError;

use crate::session::Session;
use crate::transfer::MoveError;

/// Whether the editor can take memory in the game.
pub(crate) const CAN_ALLOCATE: bool = cfg!(windows);

/// How much memory it takes at a time, unless one block needs more.
const POOL: u64 = 0x1_0000;

/// Blocks start at multiples of this many bytes, as the game's allocator's do.
const ALIGN: u64 = 16;

impl Session {
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
