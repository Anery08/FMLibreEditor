//! A stadium's name, changed in place.
//!
//! A stadium points at its name (`[stadium] name`), an FM string: a `u32` length, the text in UTF-8 and a NUL, after a
//! `u32` count of the objects that hold it. The allocator's block starts 8 bytes before that count, with a `u32` of the
//! size it was asked for (the length plus 9: the count, the length, the text and the NUL) and a `u32` the editor leaves
//! as it is. Blocks come in steps of 16 bytes: 32 for up to 15 bytes of text, 48 for 16 to 31, and so on. On the Game
//! Pass save Old Trafford (12 bytes, asked-for size 21) sits in a block of 32, right after Kenilworth Road's (15, 24).
//!
//! The editor never asks the game for memory, so a new name goes into the same block, and only one that keeps the
//! block's size: when the game lets the name go, its allocator goes by the size word. It changes only a name the
//! stadium alone holds (a count of 1): a shared one would change for its other holders too. Each write keeps the bytes
//! it found, so one undo puts the old name back.

use serde::Serialize;

use crate::clubs::{ClubSummary, club_stadium};
use crate::session::Session;
use crate::text::read_fm_string;
use crate::transfer::{MoveError, Patch, Patches};

/// From a string's pointer (its length) back to the count of its holders, and to the size word of its block.
const HOLDERS: u64 = 4;
const SIZE_WORD: u64 = 12;
/// What a block holds besides the text: the size word, the word left alone, the count, the length and the NUL.
const OVERHEAD: usize = 17;
/// What the size word holds besides the text: the count, the length and the NUL.
const ASKED_OVERHEAD: u32 = 9;
/// Blocks come in steps of this many bytes.
const STEP: usize = 16;
/// The longest name the editor changes, in bytes.
const LONGEST: usize = 255;

/// The size of the block the allocator gives a string of `bytes` bytes.
fn block_size(bytes: usize) -> usize {
    (bytes + OVERHEAD).div_ceil(STEP) * STEP
}

/// The fewest and most bytes a name may take in a block of `size`, so that it keeps that size.
fn lengths_for(size: usize) -> (usize, usize) {
    let max = size - OVERHEAD;
    let min = if size <= 2 * STEP { 1 } else { size - STEP - OVERHEAD + 1 };
    (min, max)
}

/// A stadium's name, as stored, and the names it can take in place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StadiumName {
    pub name: String,
    /// How many of the game's objects hold the name; the editor changes only one the stadium alone holds.
    pub holders: u32,
    /// The fewest and most bytes of UTF-8 a new name may take: those that keep the size of the name's block.
    pub min_bytes: usize,
    pub max_bytes: usize,
}

impl StadiumName {
    /// Whether the editor can change the name: the stadium alone holds it.
    pub fn renamable(&self) -> bool {
        self.holders == 1
    }
}

/// A stadium renamed, or to be: the club, the names, and the bytes it writes, which its undo writes back.
#[derive(Debug, Clone)]
pub struct StadiumRename {
    pub club: u32,
    pub from: String,
    pub to: String,
    pub(crate) patches: Vec<Patch>,
}

/// What the editor needs to know of a name's block to change it.
struct NameBlock {
    /// The string's pointer: its length.
    string: u64,
    name: StadiumName,
    /// The text and the bytes after it, to the block's end: what a new name overwrites.
    tail: Vec<u8>,
    size_word: u32,
}

impl Session {
    /// The name of the stadium the senior team of `club` plays at, as stored, with the names it can take in place.
    pub fn stadium_name(&self, club: &ClubSummary) -> Result<StadiumName, MoveError> {
        Ok(self.name_block(club)?.name)
    }

    /// Works out renaming the stadium of `club` to `name`, from the game as it is now. Nothing is written.
    pub fn plan_stadium_rename(&self, club: &ClubSummary, name: &str) -> Result<StadiumRename, MoveError> {
        let block = self.name_block(club)?;
        if !block.name.renamable() {
            return Err(MoveError::SharedName { holders: block.name.holders });
        }
        if name.is_empty() || name.trim() != name || name.chars().any(char::is_control) {
            return Err(MoveError::BadName);
        }
        let bytes = name.len();
        let (min, max) = (block.name.min_bytes, block.name.max_bytes);
        if !(min..=max).contains(&bytes) {
            return Err(MoveError::NameLength { min, max, bytes });
        }
        let old_len = block.name.name.len() as u32;
        let new_len = bytes as u32;
        let mut text = name.as_bytes().to_vec();
        text.resize(block.tail.len(), 0);
        let mut patches = Patches::default();
        patches.push(block.string - SIZE_WORD, block.size_word.to_le_bytes(), (new_len + ASKED_OVERHEAD).to_le_bytes());
        patches.push(block.string, old_len.to_le_bytes(), new_len.to_le_bytes());
        patches.push(block.string + 4, block.tail.clone(), text);
        Ok(StadiumRename { club: club.uid, from: block.name.name, to: name.to_owned(), patches: patches.0 })
    }

    /// Writes a planned rename: each write only over the bytes the plan found, read back; when one fails, the ones
    /// before it are put back.
    pub fn apply_stadium_rename(&self, plan: &StadiumRename) -> Result<(), MoveError> {
        self.apply_patches(&plan.patches)
    }

    /// Puts the old name back, provided memory still holds the new one.
    pub fn undo_stadium_rename(&self, done: &StadiumRename) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// The block of the name of the stadium of `club`, checked: the stadium of the class the clubs' share, its name a
    /// string whose size word and block the editor understands.
    fn name_block(&self, club: &ClubSummary) -> Result<NameBlock, MoveError> {
        let s = self.layout.stadium.as_ref().ok_or(MoveError::NoStadium)?;
        if self.process.read_u32(club.address + self.layout.club.uid)? != club.uid {
            return Err(MoveError::NotAClub { uid: club.uid });
        }
        let (_, bytes) = club_stadium(&self.process, &self.layout, club.address).ok_or(MoveError::NoStadium)?;
        let class = u64::from_le_bytes(bytes[..8].try_into().expect("8 bytes"));
        if self.stadium_class() != Some(class) {
            return Err(MoveError::NoStadium);
        }
        let string = u64::from_le_bytes(bytes[s.name as usize..s.name as usize + 8].try_into().expect("8 bytes"));
        let name = read_fm_string(&self.process, string).ok_or(MoveError::NoStadium)?;
        let len = name.len();
        let head = self.process.read_bytes(string - SIZE_WORD, SIZE_WORD as usize)?;
        let word = |at: usize| u32::from_le_bytes(head[at..at + 4].try_into().expect("4 bytes"));
        let (size_word, holders) = (word(0), word((SIZE_WORD - HOLDERS) as usize));
        // A string laid out otherwise is one the editor does not understand, and leaves alone.
        if len > LONGEST || size_word != len as u32 + ASKED_OVERHEAD || holders == 0 {
            return Err(MoveError::NoStadium);
        }
        let size = block_size(len);
        let tail = self.process.read_bytes(string + 4, size - OVERHEAD + 1)?;
        if tail[len] != 0 {
            return Err(MoveError::NoStadium);
        }
        let (min_bytes, max_bytes) = lengths_for(size);
        Ok(NameBlock { string, name: StadiumName { name, holders, min_bytes, max_bytes }, tail, size_word })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_keeps_the_size_of_its_block() {
        // Old Trafford (12 bytes) and Kenilworth Road (15) in blocks of 32: up to 15 bytes.
        assert_eq!(block_size(12), 32);
        assert_eq!(block_size(15), 32);
        assert_eq!(lengths_for(32), (1, 15));
        // A name of 16 to 31 bytes is in a block of 48, and stays one of that length.
        assert_eq!(block_size(16), 48);
        assert_eq!(block_size(31), 48);
        assert_eq!(lengths_for(48), (16, 31));
        assert_eq!(lengths_for(64), (32, 47));
        for bytes in 1..=200 {
            let (min, max) = lengths_for(block_size(bytes));
            assert!((min..=max).contains(&bytes), "{bytes}");
            assert_eq!(block_size(min), block_size(max));
        }
    }
}
