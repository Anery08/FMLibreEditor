//! The game's pools of objects, and taking a slot of one as the game does: for a contract the editor makes for a free
//! agent it signs (see `signing.rs`).
//!
//! The game keeps the objects of many of its classes in pools, statics of the game plugin's writable data laid out as
//! [`PoolLayout`] says. A pool hands out slots of one size from chunks it takes from the game's allocator: the first as
//! large as the save it loaded needed, each later one of a fixed number of slots. Its free slots are chained, the first
//! 8 bytes of each pointing at the next and the last's at nothing, and the pool keeps the first. Its free and its used
//! slots add up to its chunks' slots.
//!
//! On Game Pass 0.9.2409.0, with a save of August 2027 played on for a few days, 67 such pools sat in 128 KiB of the
//! plugin's data, with slots of 16 to 464 bytes. The contracts' (`db::FULL_CONTRACT`, 200 bytes) had a first chunk of
//! 12,810 slots, all used, and a second of 1,024 whose first 14 were: 12,824 used, as many as memory held contracts, and
//! 1,010 free, chained in order from the second chunk's 15th slot.
//!
//! Taking a slot is what the game does when it makes an object: the pool's first free slot is taken, and it keeps the
//! next one as its first, with one slot fewer free and one more used. The editor writes the three at once, and only
//! while the game is not making objects of that class itself, as with every change to the game's lists: the game should
//! be paused, or a slot it took at the same moment would be handed out twice. Undone, the slot is first in the chain
//! again, as it was. With no slot free the game would take another chunk; the editor does not, and refuses.

use fmlibre_mem::{Process, is_user_pointer};

use crate::locate::each_stretch;
use crate::profile::PoolLayout;
use crate::session::Session;
use crate::transfer::{MoveError, Patch};

/// The most chunks a pool is taken to have.
const MOST_CHUNKS: u64 = 4096;

/// The largest slot a pool is taken to have.
const LARGEST_SLOT: u32 = 1 << 20;

/// One of the game's pools, as read from `at`, where it keeps its list of chunks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectPool {
    pub at: u64,
    pub chunks: Vec<u64>,
    /// Its first free slot; 0 when none is free.
    pub first_free: u64,
    pub free: u32,
    pub used: u32,
    /// Bytes per slot.
    pub slot_size: u32,
    /// Slots of its first chunk, and of each later one.
    pub first_chunk: u32,
    pub later_chunks: u32,
}

/// What a pool keeps but its chunks, read from bytes that start where it keeps its list of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Statics {
    begin: u64,
    end: u64,
    first_free: u64,
    free: u32,
    used: u32,
    slot_size: u32,
    first_chunk: u32,
    later_chunks: u32,
}

impl Statics {
    /// What `bytes` hold, when they hold a pool: a list of chunks, slots of a size a pool has, free and used slots
    /// that add up to the chunks', and a first free slot just when one is free.
    fn parse(layout: &PoolLayout, bytes: &[u8]) -> Option<Self> {
        if (bytes.len() as u64) < layout.end() {
            return None;
        }
        let word = |at: u64| u64::from_le_bytes(bytes[at as usize..at as usize + 8].try_into().expect("8 bytes"));
        let half = |at: u64| u32::from_le_bytes(bytes[at as usize..at as usize + 4].try_into().expect("4 bytes"));
        let (begin, end, capacity) = (word(layout.chunks), word(layout.chunks + 8), word(layout.chunks + 16));
        let statics = Self {
            begin,
            end,
            first_free: word(layout.first_free),
            free: half(layout.free),
            used: half(layout.used),
            slot_size: half(layout.slot_size),
            first_chunk: half(layout.first_chunk),
            later_chunks: half(layout.later_chunks),
        };
        let list = is_user_pointer(begin)
            && is_user_pointer(capacity)
            && begin < end
            && end <= capacity
            && (end - begin).is_multiple_of(8)
            && (capacity - begin).is_multiple_of(8)
            && (end - begin) / 8 <= MOST_CHUNKS;
        if !list {
            return None;
        }
        let chunks = (end - begin) / 8;
        let slots = (8..=LARGEST_SLOT).contains(&statics.slot_size)
            && statics.slot_size.is_multiple_of(8)
            && statics.first_chunk > 0
            && statics.later_chunks > 0;
        let total = u64::from(statics.first_chunk) + u64::from(statics.later_chunks) * (chunks - 1);
        let counted = u64::from(statics.free) + u64::from(statics.used) == total;
        let first = if statics.free == 0 { statics.first_free == 0 } else { is_user_pointer(statics.first_free) };
        (slots && counted && first).then_some(statics)
    }
}

/// A slot of a pool, planned to be taken: where it is, what it holds now (the pointer to the next free slot, then
/// whatever its last object left), and the write to the pool that takes it.
#[derive(Debug, Clone)]
pub(crate) struct TakenSlot {
    pub(crate) slot: u64,
    pub(crate) was: Vec<u8>,
    pub(crate) pool: Patch,
}

impl ObjectPool {
    /// The pool that keeps its list of chunks at `at`, when what is there checks out as one.
    pub fn read(process: &Process, layout: &PoolLayout, at: u64) -> Result<Option<Self>, MoveError> {
        let bytes = process.read_bytes(at, layout.end() as usize)?;
        match Statics::parse(layout, &bytes) {
            Some(statics) => Self::with_chunks(process, at, statics),
            None => Ok(None),
        }
    }

    /// The pool `statics` describe, with its chunks read, when each is somewhere a chunk can be.
    fn with_chunks(process: &Process, at: u64, statics: Statics) -> Result<Option<Self>, MoveError> {
        let bytes = process.read_bytes(statics.begin, (statics.end - statics.begin) as usize)?;
        let chunks: Vec<u64> = bytes.as_chunks::<8>().0.iter().map(|word| u64::from_le_bytes(*word)).collect();
        if !chunks.iter().all(|&chunk| is_user_pointer(chunk)) {
            return Ok(None);
        }
        let Statics { first_free, free, used, slot_size, first_chunk, later_chunks, .. } = statics;
        Ok(Some(Self { at, chunks, first_free, free, used, slot_size, first_chunk, later_chunks }))
    }

    /// How many slots the chunk at `index` in its list has.
    pub fn slots_of(&self, index: usize) -> u64 {
        u64::from(if index == 0 { self.first_chunk } else { self.later_chunks })
    }

    /// How many slots it has.
    pub fn slots(&self) -> u64 {
        (0..self.chunks.len()).map(|index| self.slots_of(index)).sum()
    }

    /// Whether one of its slots starts at `address`.
    pub fn is_slot(&self, address: u64) -> bool {
        let size = u64::from(self.slot_size);
        self.chunks.iter().enumerate().any(|(index, &chunk)| {
            address >= chunk && address - chunk < self.slots_of(index) * size && (address - chunk).is_multiple_of(size)
        })
    }

    /// Plans taking its first free slot as the game does (see the module's notes). Refused when none is free, or when
    /// the slot is not one of the pool's or does not point at another, or at nothing when it is the last.
    pub(crate) fn take(&self, process: &Process, layout: &PoolLayout) -> Result<TakenSlot, MoveError> {
        if self.free == 0 || self.first_free == 0 {
            return Err(MoveError::PoolFull);
        }
        let slot = self.first_free;
        let was = process.read_bytes(slot, self.slot_size as usize)?;
        let next = u64::from_le_bytes(was[..8].try_into().expect("8 bytes"));
        let chained = if self.free == 1 { next == 0 } else { next != slot && self.is_slot(next) };
        if !self.is_slot(slot) || !chained {
            return Err(MoveError::NoPool);
        }
        // One write takes it: the first free slot, and the two counts, which sit side by side.
        let from = layout.first_free.min(layout.free).min(layout.used);
        let to = (layout.first_free + 8).max(layout.free + 4).max(layout.used + 4);
        let before = process.read_bytes(self.at + from, (to - from) as usize)?;
        let mut after = before.clone();
        let mut put = |offset: u64, bytes: &[u8]| {
            let at = (offset - from) as usize;
            after[at..at + bytes.len()].copy_from_slice(bytes);
        };
        put(layout.first_free, &next.to_le_bytes());
        put(layout.free, &(self.free - 1).to_le_bytes());
        put(layout.used, &(self.used + 1).to_le_bytes());
        Ok(TakenSlot { slot, was, pool: Patch { address: self.at + from, before, after } })
    }
}

impl Session {
    /// Every pool in the game plugin's writable data, by where it keeps its list of chunks; none where the layout does
    /// not place pools. Reads about a megabyte, for the probe.
    pub fn object_pools(&self) -> Vec<ObjectPool> {
        let Some(layout) = self.layout.pool.as_ref() else {
            return Vec::new();
        };
        self.pool_statics(layout, |_| true)
            .into_iter()
            .filter_map(|(at, statics)| ObjectPool::with_chunks(&self.process, at, statics).ok().flatten())
            .collect()
    }

    /// The pool whose slots of `size` bytes hold the object at `object`: where one was found before, if it still does,
    /// or else found by searching the plugin's writable data.
    pub(crate) fn pool_holding(&self, object: u64, size: u64) -> Result<ObjectPool, MoveError> {
        let layout = self.layout.pool.as_ref().ok_or(MoveError::NoPool)?;
        let holds = |pool: &ObjectPool| u64::from(pool.slot_size) == size && pool.is_slot(object);
        let mut found = self.pools_found.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for &at in found.iter() {
            if let Some(pool) = ObjectPool::read(&self.process, layout, at)?.filter(holds) {
                return Ok(pool);
            }
        }
        for (at, statics) in self.pool_statics(layout, |statics| u64::from(statics.slot_size) == size) {
            if let Some(pool) = ObjectPool::with_chunks(&self.process, at, statics)?.filter(holds) {
                found.push(at);
                return Ok(pool);
            }
        }
        Err(MoveError::NoPool)
    }

    /// Whether the `len` bytes at `address` are among the statics of a pool the editor found in the game plugin (see
    /// [`Session::pool_holding`]): the only statics of the game it writes.
    pub(crate) fn is_pool_static(&self, address: u64, len: usize) -> bool {
        let Some(layout) = self.layout.pool.as_ref() else {
            return false;
        };
        let found = self.pools_found.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let end = address.saturating_add(len as u64);
        self.plugin.contains(address) && found.iter().any(|&at| address >= at && end <= at + layout.end())
    }

    /// Each place in the plugin's writable data that holds a pool `wanted` keeps, and what it holds there.
    fn pool_statics(&self, layout: &PoolLayout, wanted: impl Fn(&Statics) -> bool) -> Vec<(u64, Statics)> {
        let span = layout.end() as usize;
        let mut found = Vec::new();
        each_stretch(self, |start, bytes| {
            for offset in (0..bytes.len()).step_by(8) {
                let at = start + offset as u64;
                // A pool the stretch ends in the middle of is read whole.
                let read;
                let window = if offset + span <= bytes.len() {
                    &bytes[offset..offset + span]
                } else {
                    match self.process.read_bytes(at, span) {
                        Ok(bytes) => {
                            read = bytes;
                            &read[..]
                        }
                        Err(_) => continue,
                    }
                };
                if let Some(statics) = Statics::parse(layout, window).filter(&wanted) {
                    found.push((at, statics));
                }
            }
        });
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> PoolLayout {
        PoolLayout {
            chunks: 0x00,
            first_free: 0x18,
            free: 0x20,
            used: 0x24,
            slot_size: 0x28,
            first_chunk: 0x2C,
            later_chunks: 0x30,
        }
    }

    /// The bytes of a pool as the game keeps it, from its list of chunks on.
    fn statics(chunks: (u64, u64, u64), first_free: u64, counts: [u32; 5]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for word in [chunks.0, chunks.1, chunks.2, first_free] {
            bytes.extend_from_slice(&word.to_le_bytes());
        }
        for half in counts {
            bytes.extend_from_slice(&half.to_le_bytes());
        }
        bytes.extend_from_slice(&100u32.to_le_bytes());
        bytes
    }

    #[test]
    fn reads_the_contracts_pool_as_the_game_keeps_it() {
        // The contracts' pool on the Game Pass save: two chunks, 1,010 slots free and 12,824 used, of 200 bytes.
        let bytes = statics(
            (0x1e6_2b7b_08b0, 0x1e6_2b7b_08c0, 0x1e6_2b7b_08c0),
            0x1e5_66ff_8370,
            [1010, 12824, 200, 12810, 1024],
        );
        let found = Statics::parse(&layout(), &bytes).expect("a pool");
        assert_eq!((found.free, found.used, found.slot_size), (1010, 12824, 200));
        assert_eq!((found.first_chunk, found.later_chunks), (12810, 1024));
    }

    #[test]
    fn passes_over_what_only_looks_like_a_pool() {
        let list = (0x1e6_2b7b_08b0, 0x1e6_2b7b_08c0, 0x1e6_2b7b_08c0);
        // Free and used slots that do not add up to the chunks'.
        assert!(Statics::parse(&layout(), &statics(list, 0x1e5_66ff_8370, [1010, 12823, 200, 12810, 1024])).is_none());
        // Slots free, but no first one; none free, but a first one.
        assert!(Statics::parse(&layout(), &statics(list, 0, [1010, 12824, 200, 12810, 1024])).is_none());
        assert!(Statics::parse(&layout(), &statics(list, 0x1e5_66ff_8370, [0, 13834, 200, 12810, 1024])).is_none());
        // A slot size no pool has.
        assert!(Statics::parse(&layout(), &statics(list, 0x1e5_66ff_8370, [1010, 12824, 201, 12810, 1024])).is_none());
        // No chunks.
        let empty = (0x1e6_2b7b_08b0, 0x1e6_2b7b_08b0, 0x1e6_2b7b_08c0);
        assert!(Statics::parse(&layout(), &statics(empty, 0, [0, 0, 200, 12810, 1024])).is_none());
        // Too few bytes.
        assert!(Statics::parse(&layout(), &[0; 16]).is_none());
    }

    #[test]
    fn knows_where_its_slots_start() {
        let pool = ObjectPool {
            at: 0,
            chunks: vec![0x10_0000, 0x20_0000],
            first_free: 0x20_0000 + 14 * 200,
            free: 1010,
            used: 12824,
            slot_size: 200,
            first_chunk: 12810,
            later_chunks: 1024,
        };
        assert_eq!(pool.slots(), 13834);
        assert!(pool.is_slot(0x10_0000));
        assert!(pool.is_slot(0x10_0000 + 12809 * 200));
        assert!(!pool.is_slot(0x10_0000 + 12810 * 200));
        assert!(!pool.is_slot(0x10_0000 + 100));
        assert!(pool.is_slot(0x20_0000 + 1023 * 200));
        assert!(!pool.is_slot(0x20_0000 + 1024 * 200));
        assert!(!pool.is_slot(0x0f_ffff));
    }
}
