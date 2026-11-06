//! Memory the editor takes in the game, for what does not fit where the game put it: a stadium's longer name (see
//! `stadium_name.rs`), and a list of the game's with no room for one more, a player's relations (see `relations.rs`) or
//! a club's department of staff (see `staff_move.rs`).
//!
//! It takes it 64 KiB at a time (`Process::allocate`, `VirtualAllocEx`: private, read-write, no code) and hands it out
//! in blocks of 16 bytes and more, one after another, each zeroed; it never gives any back, so whatever the game does
//! with a block later, the memory stays. Where it cannot take memory (macOS), nothing that needs it is offered.
//!
//! A list the game keeps as `(begin, end, capacity)` is grown by writing what it holds and the new element into a block
//! of the editor's own, as large as the game's allocator gives a buffer of that capacity, and pointing the list at it.
//! The old buffer stays as it was, for the undo, which points the list back at it. Seen in the game (Game Pass, a
//! player's relations): saving, loading the save and quitting, when the game lets go of such lists, went without a
//! crash, and it saved what they held.

use std::sync::PoisonError;

use crate::session::Session;
use crate::transfer::{MoveError, Patch};

/// Whether the editor can take memory in the game.
pub(crate) const CAN_ALLOCATE: bool = cfg!(windows);

/// How much memory it takes at a time, unless one block needs more.
const POOL: u64 = 0x1_0000;

/// Blocks start at multiples of this many bytes, as the game's allocator's do.
const ALIGN: u64 = 16;

/// The room a grown list has past what it is grown for: so that the game, adding to it, finds room where it is.
pub(crate) const GROWN_ROOM: u64 = 3;

/// A list of the game's to grow into memory of the editor's own: what its header holds now, and what it is to hold.
#[derive(Debug, Clone)]
pub(crate) struct Growth {
    /// Where the list keeps its begin, end and capacity, and what they are now.
    pub(crate) header: u64,
    pub(crate) was: [u64; 3],
    /// Its elements and the new ones, as they are written.
    pub(crate) bytes: Vec<u8>,
    /// How many bytes the new buffer has room for.
    pub(crate) capacity: u64,
}

impl Growth {
    /// A list at `header`, holding `was` now, to hold `bytes`, with room for [`GROWN_ROOM`] more elements of `element`
    /// bytes.
    pub(crate) fn new(header: u64, was: [u64; 3], bytes: Vec<u8>, element: u64) -> Self {
        let capacity = bytes.len() as u64 + GROWN_ROOM * element;
        Self { header, was, bytes, capacity }
    }
}

impl Session {
    /// Takes the memory `growth` needs, writes what the list is to hold into it, and returns the write that points the
    /// list at it, for the caller to make with its others.
    pub(crate) fn grown_list(&self, growth: &Growth) -> Result<Patch, MoveError> {
        if let Some(lock) = self.structure_lock() {
            return Err(MoveError::Locked(lock));
        }
        let size = self.layout.heap.block_size(growth.capacity).unwrap_or(growth.capacity);
        let block = self.own_block(size)?;
        self.process.write_bytes(block, &growth.bytes)?;
        let words = |words: [u64; 3]| words.iter().flat_map(|word| word.to_le_bytes()).collect::<Vec<u8>>();
        let now = [block, block + growth.bytes.len() as u64, block + growth.capacity];
        Ok(Patch { address: growth.header, before: words(growth.was), after: words(now) })
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
