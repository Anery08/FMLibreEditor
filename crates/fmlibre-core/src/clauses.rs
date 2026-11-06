//! A player's contract clauses and bonuses: changing what one pays or depends on, taking one out, and adding a
//! release clause.
//!
//! A contract lists them at `clauses` (see [`ContractLayout`]): 8-byte entries of a `u32` amount in pounds
//! (`0xFFFFFFFF` for none), a `u16` condition (`0xFFFF` for none: the goals, matches, years or percentage it depends
//! on, by kind) and a `u16` kind. The editor changes an amount or a condition an entry has, and never gives one to an
//! entry without; it takes an entry out, the ones after it moving up; and it adds a release clause to a contract
//! without one where the list's block has room. Like the other lists, it allocates nothing: most lists are as long as
//! the game made them, so a release clause can be added to few contracts.
//!
//! [`ContractLayout`]: crate::profile::ContractLayout

use fmlibre_mem::is_user_pointer;

use crate::date::FmDate;
use crate::details::Clause;
use crate::players::PlayerSummary;
use crate::session::Session;
use crate::transfer::{MoveError, Patch, Patches};

/// The kind of a release clause (FMRTE's "Minimum Fee Release Clause"), the one the editor adds.
pub const RELEASE_CLAUSE: u16 = 0;

/// The kinds of release clause, as the game's English contract screen names them (Steam build 26340721): Minimum Fee
/// (0), Relegation (1), Non Promotion (2), Minimum Fee for foreign clubs (16), domestic clubs in a higher division
/// (17), domestic clubs (18), clubs in the UEFA Champions League (27) or in a continental competition (31), and an
/// Active Relegation Release Clause (55). Their condition, when they have one, is when they expire (see
/// [`release_clause_expiry`]).
pub const RELEASE_CLAUSES: [u16; 9] = [0, 1, 2, 16, 17, 18, 27, 31, 55];

/// The day a release clause expires: its condition counts the days from the contract's start (`signed`), and one
/// without a condition never expires. Ben Schlicke's release clause for domestic clubs in a higher division, signed on
/// 3 July 2027 with 791, expires on 1 September 2029, as the game's contract screen says. None for another kind of
/// clause, or when the contract's start is not known.
pub fn release_clause_expiry(clause: &Clause, signed: Option<FmDate>) -> Option<FmDate> {
    if !RELEASE_CLAUSES.contains(&clause.kind) {
        return None;
    }
    Some(signed?.plus_days(i64::from(clause.condition?)))
}

/// The most an amount may be, in pounds: the dearest release clause on the test save was 859,031,872 (a billion
/// euros), and the most a transfer fee may be is 2 billion.
pub const MOST_CLAUSE_AMOUNT: u32 = 2_000_000_000;

/// The most a condition may be: the test save's were a few hundred at most (matches, goals, percentages, years).
pub const MOST_CLAUSE_CONDITION: u16 = 1_000;

/// Bytes per entry.
const ENTRY: usize = 8;

/// The longest list of clauses the editor reads.
const MOST_CLAUSES: u64 = 64;

/// A change to a player's clauses, worked out from the game as it is now and ready to be written.
#[derive(Debug, Clone)]
pub struct ClausePlan {
    pub player: u32,
    /// The clause before and after: none before for one added, none after for one taken out.
    pub before: Option<Clause>,
    pub after: Option<Clause>,
    patches: Vec<Patch>,
}

/// A change to a player's clauses that was written: what undoing it takes.
#[derive(Debug, Clone)]
pub struct ClauseSet {
    pub player: u32,
    pub before: Option<Clause>,
    pub after: Option<Clause>,
    patches: Vec<Patch>,
}

/// A contract's list of clauses, as read.
struct ClauseList {
    header: u64,
    begin: u64,
    end: u64,
    capacity: u64,
    entries: Vec<[u8; ENTRY]>,
}

impl Session {
    /// How many more clauses the contract of `player` has room for: up to the capacity of its list.
    pub fn clause_room(&self, player: &PlayerSummary) -> Result<usize, MoveError> {
        let list = self.clause_list(player)?;
        Ok(((list.capacity - list.end) / ENTRY as u64) as usize)
    }

    /// Works out giving the clause at `index` in the contract of `player` the amount `amount` and the condition
    /// `condition`; what is left out stays. Only what the clause has can be changed. Nothing is written.
    pub fn plan_clause_change(
        &self,
        player: &PlayerSummary,
        index: usize,
        amount: Option<u32>,
        condition: Option<u16>,
    ) -> Result<ClausePlan, MoveError> {
        let list = self.clause_list(player)?;
        let entry = *list.entries.get(index).ok_or(MoveError::NoClause { index })?;
        let before = clause_at(index, &entry);
        let mut after = before.clone();
        if let Some(amount) = amount {
            if before.amount.is_none() {
                return Err(MoveError::NotInClause { field: "clause.amount" });
            }
            check(amount.into(), "clause.amount", MOST_CLAUSE_AMOUNT.into())?;
            after.amount = Some(amount);
        }
        if let Some(condition) = condition {
            if before.condition.is_none() {
                return Err(MoveError::NotInClause { field: "clause.condition" });
            }
            check(condition.into(), "clause.condition", MOST_CLAUSE_CONDITION.into())?;
            after.condition = Some(condition);
        }
        let mut patches = Patches::default();
        patches.push(list.begin + (index * ENTRY) as u64, entry, entry_of(&after));
        if patches.0.is_empty() {
            return Err(MoveError::SameClause);
        }
        Ok(ClausePlan { player: player.uid, before: Some(before), after: Some(after), patches: patches.0 })
    }

    /// Works out taking the clause at `index` out of the contract of `player`: the ones after it move up one. Nothing
    /// is written.
    pub fn plan_clause_removal(&self, player: &PlayerSummary, index: usize) -> Result<ClausePlan, MoveError> {
        let list = self.clause_list(player)?;
        let entry = list.entries.get(index).ok_or(MoveError::NoClause { index })?;
        let before = clause_at(index, entry);
        let entries = &list.entries;
        let last = entries.len() - 1;
        let size = ENTRY as u64;
        let mut patches = Patches::default();
        // As in a squad list: the list repeats its last entry for a moment, then ends one earlier and clears it.
        patches.push(list.begin + index as u64 * size, entries[index..last].concat(), entries[index + 1..].concat());
        patches.push(list.header + 8, list.end.to_le_bytes(), (list.end - size).to_le_bytes());
        patches.push(list.begin + last as u64 * size, entries[last], [0; ENTRY]);
        Ok(ClausePlan { player: player.uid, before: Some(before), after: None, patches: patches.0 })
    }

    /// Works out giving the contract of `player`, which has none, a release clause of `amount` pounds, where its list
    /// has room. Nothing is written.
    pub fn plan_release_clause(&self, player: &PlayerSummary, amount: u32) -> Result<ClausePlan, MoveError> {
        check(amount.into(), "clause.amount", MOST_CLAUSE_AMOUNT.into())?;
        let list = self.clause_list(player)?;
        if list.entries.iter().any(|entry| clause_at(0, entry).kind == RELEASE_CLAUSE) {
            return Err(MoveError::SameClause);
        }
        if list.begin == 0 || list.capacity - list.end < ENTRY as u64 {
            return Err(MoveError::ClausesFull);
        }
        let after = Clause { index: list.entries.len(), kind: RELEASE_CLAUSE, amount: Some(amount), condition: None };
        let mut patches = Patches::default();
        let slot = self.process.read_bytes(list.end, ENTRY)?;
        patches.push(list.end, slot, entry_of(&after));
        let end = list.end + ENTRY as u64;
        patches.push(list.header + 8, list.end.to_le_bytes(), end.to_le_bytes());
        Ok(ClausePlan { player: player.uid, before: None, after: Some(after), patches: patches.0 })
    }

    /// Writes a planned change to a player's clauses, each write over the bytes it expects, after checking them all.
    pub fn apply_clause(&self, plan: &ClausePlan) -> Result<ClauseSet, MoveError> {
        self.apply_patches(&plan.patches)?;
        let ClausePlan { player, ref before, ref after, ref patches } = *plan;
        Ok(ClauseSet { player, before: before.clone(), after: after.clone(), patches: patches.clone() })
    }

    /// Puts the clauses back as they were, provided the list still holds what the change wrote.
    pub fn undo_clause(&self, done: &ClauseSet) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// The list of clauses of the contract of `player`, once the contract is checked to point back at him.
    fn clause_list(&self, player: &PlayerSummary) -> Result<ClauseList, MoveError> {
        let p = &self.layout.player;
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        let contract = self.process.read_u64(player.address + p.at(p.contract, player.shift))?;
        if !is_user_pointer(contract) {
            return Err(MoveError::NoContract);
        }
        let owner = self.process.read_u64(contract + self.layout.contract.owner)?;
        if owner != player.address + p.identity() + player.shift {
            return Err(MoveError::UnusualContract);
        }
        let header = contract + self.layout.contract.clauses;
        let words = self.process.read_bytes(header, 24)?;
        let word = |i: usize| u64::from_le_bytes(words[i * 8..i * 8 + 8].try_into().expect("8 bytes"));
        let (begin, end, capacity) = (word(0), word(1), word(2));
        if begin == 0 && end == 0 && capacity == 0 {
            return Ok(ClauseList { header, begin, end, capacity, entries: Vec::new() });
        }
        let size = ENTRY as u64;
        let sane = is_user_pointer(begin)
            && begin <= end
            && end <= capacity
            && (end - begin).is_multiple_of(size)
            && (capacity - begin).is_multiple_of(size)
            && capacity - begin <= size * MOST_CLAUSES;
        if !sane {
            return Err(MoveError::NotListed);
        }
        let bytes = self.process.read_bytes(begin, (end - begin) as usize)?;
        let entries = bytes.as_chunks::<ENTRY>().0.to_vec();
        Ok(ClauseList { header, begin, end, capacity, entries })
    }
}

/// The clause `entry` at `index` says.
fn clause_at(index: usize, entry: &[u8; ENTRY]) -> Clause {
    let amount = u32::from_le_bytes([entry[0], entry[1], entry[2], entry[3]]);
    let condition = u16::from_le_bytes([entry[4], entry[5]]);
    Clause {
        index,
        kind: u16::from_le_bytes([entry[6], entry[7]]),
        amount: (amount != u32::MAX).then_some(amount),
        condition: (condition != u16::MAX).then_some(condition),
    }
}

/// The bytes of `clause`.
fn entry_of(clause: &Clause) -> [u8; ENTRY] {
    let mut entry = [0; ENTRY];
    entry[..4].copy_from_slice(&clause.amount.unwrap_or(u32::MAX).to_le_bytes());
    entry[4..6].copy_from_slice(&clause.condition.unwrap_or(u16::MAX).to_le_bytes());
    entry[6..].copy_from_slice(&clause.kind.to_le_bytes());
    entry
}

/// `value` for the field `field`, which takes 0 to `max`.
fn check(value: i64, field: &'static str, max: i64) -> Result<(), MoveError> {
    if (0..=max).contains(&value) { Ok(()) } else { Err(MoveError::OutOfRange { field, value, min: 0, max }) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_read_back_as_written() {
        // Mbappé's release clause, a billion euros in pounds, and a yearly wage rise of 10%.
        let release: [u8; ENTRY] = [0x40, 0xC9, 0x33, 0x33, 0xFF, 0xFF, 0x00, 0x00];
        let clause = clause_at(2, &release);
        assert_eq!((clause.index, clause.kind, clause.amount, clause.condition), (2, 0, Some(859_031_872), None));
        assert_eq!(entry_of(&clause), release);
        let rise: [u8; ENTRY] = [0xFF, 0xFF, 0xFF, 0xFF, 10, 0, 3, 0];
        let clause = clause_at(0, &rise);
        assert_eq!((clause.kind, clause.amount, clause.condition), (3, None, Some(10)));
        assert_eq!(entry_of(&clause), rise);
    }

    #[test]
    fn amounts_and_conditions_are_checked() {
        assert!(check(0, "clause.amount", MOST_CLAUSE_AMOUNT.into()).is_ok());
        assert!(check(MOST_CLAUSE_AMOUNT.into(), "clause.amount", MOST_CLAUSE_AMOUNT.into()).is_ok());
        assert!(check(i64::from(MOST_CLAUSE_AMOUNT) + 1, "clause.amount", MOST_CLAUSE_AMOUNT.into()).is_err());
        assert!(check(1_001, "clause.condition", MOST_CLAUSE_CONDITION.into()).is_err());
    }

    #[test]
    fn release_clauses_expire_days_after_signing() {
        let date = |year, month, day| FmDate { year, month, day };
        let clause = |kind, condition| Clause { index: 0, kind, amount: Some(10_000_000), condition };
        // As the game's contract screen shows them: Ben Schlicke (17, signed 3 July 2027, 791) and Eli Junior Kroupi
        // (27, signed 15 January 2027, 960) both expire on 1 September 2029.
        assert_eq!(release_clause_expiry(&clause(17, Some(791)), Some(date(2027, 7, 3))), Some(date(2029, 9, 1)));
        assert_eq!(release_clause_expiry(&clause(27, Some(960)), Some(date(2027, 1, 15))), Some(date(2029, 9, 1)));
        // Without a condition it never expires; another kind's condition is no date.
        assert_eq!(release_clause_expiry(&clause(0, None), Some(date(2027, 7, 3))), None);
        assert_eq!(release_clause_expiry(&clause(3, Some(10)), Some(date(2027, 7, 3))), None);
        assert_eq!(release_clause_expiry(&clause(0, Some(791)), None), None);
    }
}
