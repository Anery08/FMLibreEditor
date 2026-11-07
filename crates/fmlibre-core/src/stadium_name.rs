//! A stadium's name, changed in place or given anew.
//!
//! A stadium points at its name (`[stadium] name`), an FM string: a `u32` length, the text in UTF-8 and a NUL, after a
//! `u32` count of the objects that hold it. The allocator's block starts 8 bytes before that count, with a `u32` of the
//! size it was asked for (the length plus 9: the count, the length, the text and the NUL) and a `u32` the editor leaves
//! as it is. On the Game Pass save Old Trafford (12 bytes, asked-for size 21) sits in a block of 32, right after
//! Kenilworth Road's (15, 24). On the Mac blocks come in steps of 8 (`[heap] string_step`): 24 for up to 7 bytes, 32 for
//! 8 to 15, 40 for 16 to 23, so the Emirates Stadium (16 bytes) sits in a block of 40, not 48. Steps of 8 are safe where
//! the game's are 16 too, as a block of 8 lies within the block of 16 it falls in, so both layouts take 8; the steps hold
//! up to the longest name the editor writes.
//!
//! A new name that keeps the size of the block, for a name the stadium alone holds (a count of 1), is written over the
//! old one: the size word, the length and the text. Any other goes into memory the editor takes in the game for it
//! (`Process::allocate`), laid out as the game's strings are, and the stadium is pointed at it. The game's allocator
//! knows nothing of that memory, so those strings get a count of holders the game never brings down to nothing: it
//! never lets them go. The old name stays where it was, for its other holders or for the undo. Each write keeps the
//! bytes it found, so one undo puts the old name back. Where the editor cannot take memory, only the first kind of
//! rename is offered.

use serde::Serialize;

use crate::clubs::{ClubSummary, club_stadium};
use crate::own_memory::CAN_ALLOCATE;
use crate::session::Session;
use crate::text::read_fm_string;
use crate::transfer::{MoveError, Patch, Patches};

/// From a string's pointer (its length) back to the count of its holders, to the word the editor leaves alone (or
/// marks its own strings with), and to the size word of its block.
const HOLDERS: u64 = 4;
const MARK: u64 = 8;
const SIZE_WORD: u64 = 12;
/// What a block holds besides the text: the size word, the second word, the count, the length and the NUL.
const OVERHEAD: usize = 17;
/// What the size word holds besides the text: the count, the length and the NUL.
const ASKED_OVERHEAD: u32 = 9;
/// Blocks come in steps of this many bytes where the layout does not say (`[heap] string_step`).
const STEP: usize = 16;
/// The longest name the editor reads as one, in bytes.
const LONGEST: usize = 255;
/// The longest name the editor writes, in bytes: longer than any stadium's on the saves seen (one of 64 to 79).
pub const LONGEST_NAME: usize = 80;
/// The count of holders of the strings the editor writes into memory of its own: so many that the game never brings
/// it down to nothing, and so never hands the string to its allocator.
const FOREVER: u32 = 0x4000_0000;
/// The second word of the editor's own strings, to know them again: "FMLE".
const OWN_MARK: u32 = u32::from_le_bytes(*b"FMLE");

/// How the game's allocator sizes the blocks of its strings: in steps of so many bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Blocks {
    step: usize,
}

impl Blocks {
    /// The size of the block the allocator gives a string of `bytes` bytes.
    fn size(self, bytes: usize) -> usize {
        (bytes + OVERHEAD).div_ceil(self.step) * self.step
    }

    /// The fewest and most bytes a name may take in a block of `size`, so that it keeps that size.
    fn lengths(self, size: usize) -> (usize, usize) {
        let max = size - OVERHEAD;
        let min = (size + 1).saturating_sub(self.step + OVERHEAD).max(1);
        (min, max)
    }
}

/// A stadium's name, as stored, and the names it can take.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StadiumName {
    pub name: String,
    /// How many of the game's objects hold the name.
    pub holders: u32,
    /// Whether the editor can give the stadium another name.
    pub renamable: bool,
    /// The fewest and most bytes of UTF-8 a new name may take.
    pub min_bytes: usize,
    pub max_bytes: usize,
}

/// A stadium renamed, or to be: the club, the names, and the bytes it writes, which its undo writes back.
#[derive(Debug, Clone)]
pub struct StadiumRename {
    pub club: u32,
    pub from: String,
    pub to: String,
    /// Whether the new name was written over the old one; otherwise the stadium is pointed at a string of its own.
    pub in_place: bool,
    pub(crate) patches: Vec<Patch>,
    /// Where the stadium keeps the pointer to its name, and the pointer, for a new string.
    pointer: (u64, u64),
}

/// What the editor needs to know of a name's block to change it.
struct NameBlock {
    /// The string's pointer (its length), and where the stadium keeps it.
    string: u64,
    pointer_at: u64,
    name: String,
    holders: u32,
    /// Whether the string is one the editor wrote into memory of its own.
    own: bool,
    /// How the allocator sizes its block.
    blocks: Blocks,
    /// The text and the bytes after it, to the block's end: what a new name in place overwrites.
    tail: Vec<u8>,
    size_word: u32,
}

impl NameBlock {
    /// Whether a new name may be written over this one: the stadium alone holds it (or it is the editor's own), and
    /// the new name keeps the block's size.
    fn takes_in_place(&self, bytes: usize) -> bool {
        (self.holders == 1 || self.own) && self.blocks.size(bytes) == self.blocks.size(self.name.len())
    }

    /// The fewest and most bytes a new name may take in this block.
    fn lengths(&self) -> (usize, usize) {
        self.blocks.lengths(self.blocks.size(self.name.len()))
    }
}

impl Session {
    /// How the game's allocator sizes the blocks of its strings, as the layout says.
    fn string_blocks(&self) -> Blocks {
        let step = self.layout.heap.string_step.map_or(STEP, |step| step as usize);
        Blocks { step }
    }

    /// The name of the stadium the senior team of `club` plays at, as stored, with the names it can take.
    pub fn stadium_name(&self, club: &ClubSummary) -> Result<StadiumName, MoveError> {
        let block = self.name_block(club)?;
        let (min_bytes, max_bytes, renamable) = if CAN_ALLOCATE {
            (1, LONGEST_NAME, true)
        } else {
            let (min, max) = block.lengths();
            (min, max, block.holders == 1 || block.own)
        };
        Ok(StadiumName { name: block.name, holders: block.holders, renamable, min_bytes, max_bytes })
    }

    /// Works out renaming the stadium of `club` to `name`, from the game as it is now. Nothing is written.
    pub fn plan_stadium_rename(&self, club: &ClubSummary, name: &str) -> Result<StadiumRename, MoveError> {
        let block = self.name_block(club)?;
        if name.is_empty() || name.trim() != name || name.chars().any(char::is_control) {
            return Err(MoveError::BadName);
        }
        let bytes = name.len();
        let mut rename = StadiumRename {
            club: club.uid,
            from: block.name.clone(),
            to: name.to_owned(),
            in_place: block.takes_in_place(bytes),
            patches: Vec::new(),
            pointer: (block.pointer_at, block.string),
        };
        if rename.in_place {
            let old_len = block.name.len() as u32;
            let new_len = bytes as u32;
            let mut text = name.as_bytes().to_vec();
            text.resize(block.tail.len(), 0);
            let mut patches = Patches::default();
            let size_word = (new_len + ASKED_OVERHEAD).to_le_bytes();
            patches.push(block.string - SIZE_WORD, block.size_word.to_le_bytes(), size_word);
            patches.push(block.string, old_len.to_le_bytes(), new_len.to_le_bytes());
            patches.push(block.string + 4, block.tail, text);
            rename.patches = patches.0;
            return Ok(rename);
        }
        if !CAN_ALLOCATE {
            if block.holders != 1 && !block.own {
                return Err(MoveError::SharedName { holders: block.holders });
            }
            let (min, max) = block.lengths();
            return Err(MoveError::NameLength { min, max, bytes });
        }
        if bytes > LONGEST_NAME {
            return Err(MoveError::NameLength { min: 1, max: LONGEST_NAME, bytes });
        }
        Ok(rename)
    }

    /// Writes a planned rename and returns what it wrote, for its undo: over the old name, or into a string of the
    /// editor's own that the stadium is then pointed at. Each write lands only on the bytes the plan found, and is
    /// read back; when one fails, the ones before it are put back.
    pub fn apply_stadium_rename(&self, plan: &StadiumRename) -> Result<StadiumRename, MoveError> {
        let mut done = plan.clone();
        if !plan.in_place {
            let (pointer_at, old) = plan.pointer;
            let string = self.own_string(&plan.to)?;
            done.patches = vec![Patch {
                address: pointer_at,
                before: old.to_le_bytes().into(),
                after: string.to_le_bytes().into(),
            }];
        }
        self.apply_patches(&done.patches)?;
        Ok(done)
    }

    /// Puts the old name back, provided memory still holds the new one.
    pub fn undo_stadium_rename(&self, done: &StadiumRename) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// A string of `text` in memory of the editor's own, laid out as the game's are (the size word, the editor's mark, a
    /// count of holders that never runs out, the length, the text and a NUL), in a block of its own (see `own_memory.rs`).
    fn own_string(&self, text: &str) -> Result<u64, MoveError> {
        let bytes = text.as_bytes();
        let size = self.string_blocks().size(bytes.len()) as u64;
        let block = self.own_block(size)?;
        let mut data = Vec::with_capacity(size as usize);
        data.extend((bytes.len() as u32 + ASKED_OVERHEAD).to_le_bytes());
        data.extend(OWN_MARK.to_le_bytes());
        data.extend(FOREVER.to_le_bytes());
        data.extend((bytes.len() as u32).to_le_bytes());
        data.extend(bytes);
        data.push(0);
        self.process.write_bytes(block, &data)?;
        Ok(block + SIZE_WORD)
    }

    /// The block of the name of the stadium of `club`, checked: the stadium of the class the clubs' share, its name a
    /// string whose size word and block the editor understands.
    fn name_block(&self, club: &ClubSummary) -> Result<NameBlock, MoveError> {
        let s = self.layout.stadium.as_ref().ok_or(MoveError::NoStadium)?;
        if self.process.read_u32(club.address + self.layout.club.uid)? != club.uid {
            return Err(MoveError::NotAClub { uid: club.uid });
        }
        let (stadium, bytes) = club_stadium(&self.process, &self.layout, club.address).ok_or(MoveError::NoStadium)?;
        let class = u64::from_le_bytes(bytes[..8].try_into().expect("8 bytes"));
        if self.stadium_class() != Some(class) {
            return Err(MoveError::NoStadium);
        }
        let string = u64::from_le_bytes(bytes[s.name as usize..s.name as usize + 8].try_into().expect("8 bytes"));
        let name = read_fm_string(&self.process, string).ok_or(MoveError::NoStadium)?;
        let len = name.len();
        let head = self.process.read_bytes(string - SIZE_WORD, SIZE_WORD as usize)?;
        let word = |at: u64| u32::from_le_bytes(head[at as usize..at as usize + 4].try_into().expect("4 bytes"));
        let (size_word, mark, holders) = (word(0), word(SIZE_WORD - MARK), word(SIZE_WORD - HOLDERS));
        // A string laid out otherwise is one the editor does not understand, and leaves alone.
        if len > LONGEST || size_word != len as u32 + ASKED_OVERHEAD || holders == 0 {
            return Err(MoveError::NoStadium);
        }
        let blocks = self.string_blocks();
        let tail = self.process.read_bytes(string + 4, blocks.size(len) - OVERHEAD + 1)?;
        if tail[len] != 0 {
            return Err(MoveError::NoStadium);
        }
        let own = mark == OWN_MARK && holders == FOREVER;
        Ok(NameBlock { string, pointer_at: stadium + s.name, name, holders, own, blocks, tail, size_word })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIXTEEN: Blocks = Blocks { step: 16 };
    const EIGHT: Blocks = Blocks { step: 8 };

    #[test]
    fn a_name_in_place_keeps_the_size_of_its_block() {
        // In steps of 16, as Windows was taken to have: Old Trafford (12 bytes) and Kenilworth Road (15) in blocks of 32.
        assert_eq!(SIXTEEN.size(12), 32);
        assert_eq!(SIXTEEN.size(15), 32);
        assert_eq!(SIXTEEN.lengths(32), (1, 15));
        // A name of 16 to 31 bytes is in a block of 48.
        assert_eq!(SIXTEEN.size(16), 48);
        assert_eq!(SIXTEEN.size(31), 48);
        assert_eq!(SIXTEEN.lengths(48), (16, 31));
        assert_eq!(SIXTEEN.lengths(64), (32, 47));
        // The Mac: the Emirates Stadium (16 bytes) and The Archibalds' Stadium (23) in blocks of 40, Leicester City
        // Stadium (22) too; Old Trafford (12) in one of 32, and a name of up to 7 bytes in one of 24.
        assert_eq!(EIGHT.size(16), 40);
        assert_eq!(EIGHT.size(22), 40);
        assert_eq!(EIGHT.size(23), 40);
        assert_eq!(EIGHT.size(24), 48);
        assert_eq!(EIGHT.size(12), 32);
        assert_eq!(EIGHT.size(7), 24);
        assert_eq!(EIGHT.lengths(24), (1, 7));
        assert_eq!(EIGHT.lengths(32), (8, 15));
        assert_eq!(EIGHT.lengths(40), (16, 23));
        // The longest name the editor writes: 104 bytes, still within the steps of 8 (up to 136).
        assert_eq!(EIGHT.size(LONGEST_NAME), 104);
        for blocks in [SIXTEEN, EIGHT] {
            for bytes in 1..=200 {
                let (min, max) = blocks.lengths(blocks.size(bytes));
                assert!((min..=max).contains(&bytes), "{bytes}");
                assert_eq!(blocks.size(min), blocks.size(max));
                // A byte fewer or more than they allow takes another block.
                assert!(min == 1 || blocks.size(min - 1) < blocks.size(min), "{bytes}");
                assert!(blocks.size(max + 1) > blocks.size(max), "{bytes}");
            }
        }
    }

    #[test]
    fn steps_of_8_stay_inside_blocks_of_16() {
        // What steps of 8 let a name take in place lies within the block of steps of 16 too, and keeps its size there:
        // so 8 is safe where the game's steps are 16.
        for old in 1..=LONGEST_NAME {
            assert!(EIGHT.size(old) <= SIXTEEN.size(old), "{old}");
            for new in 1..=LONGEST_NAME {
                if EIGHT.size(new) == EIGHT.size(old) {
                    assert_eq!(SIXTEEN.size(new), SIXTEEN.size(old), "{old} {new}");
                }
            }
        }
    }

    #[test]
    fn only_a_name_held_once_or_of_the_editors_own_changes_in_place() {
        let block = |name: &str, holders, own| NameBlock {
            string: 0,
            pointer_at: 0,
            name: name.to_owned(),
            holders,
            own,
            blocks: SIXTEEN,
            tail: Vec::new(),
            size_word: 0,
        };
        // "Old Trafford" (12): another name of up to 15 bytes in place, a longer one elsewhere.
        assert!(block("Old Trafford", 1, false).takes_in_place(15));
        assert!(!block("Old Trafford", 1, false).takes_in_place(16));
        // "Emirates Stadium" (16): a shorter name than 16 bytes elsewhere, as the block would not keep its size.
        assert!(!block("Emirates Stadium", 1, false).takes_in_place(14));
        // A shared name never in place; the editor's own, as one held once.
        assert!(!block("Maracanã", 4, false).takes_in_place(9));
        assert!(block("FML Ground", FOREVER, true).takes_in_place(12));
        // On the Mac the Emirates Stadium takes 16 to 23 bytes in place, not 31: a block of 40 holds no more.
        let emirates = NameBlock { blocks: EIGHT, ..block("Emirates Stadium", 1, false) };
        assert!(emirates.takes_in_place(23));
        assert!(!emirates.takes_in_place(24));
        assert!(!emirates.takes_in_place(15));
        assert_eq!(emirates.lengths(), (16, 23));
    }
}
