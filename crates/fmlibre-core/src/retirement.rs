//! The retirements the game has planned, and keeping a player from retiring.
//!
//! The game decides ahead of time who retires and when, and keeps those plans in its retirement manager, one object
//! a static points at, which the build profile places ([`BuildProfile::retirement_manager`]). The manager lists them
//! twice: as pointers to the 24-byte entries, and as an index of the same entries sorted by person id. An entry names
//! the person by the id the game gives him (player `player_person`), not by a pointer, and holds the date he retires.
//!
//! Keeping a player from retiring takes his entry out of both lists, the way the game drops one, and gives him the
//! trait "Will play football as long as possible" in place of "Will retire at top". The entry itself stays where it
//! is, unlisted, and comes back with an undo.
//!
//! [`BuildProfile::retirement_manager`]: crate::profile::BuildProfile::retirement_manager

use fmlibre_mem::is_user_pointer;
use serde::Serialize;

use crate::date::FmDate;
use crate::players::PlayerSummary;
use crate::rtti::{class_of, mangled};
use crate::session::Session;
use crate::transfer::{MoveError, Patch, Patches, PointerList, removal_patches};

/// The class of the retirement manager, as written in C++.
const MANAGER_CLASS: &str = "RETIREMENT_MANAGER";

/// The traits (bits of player `traits`) "Will retire at top" and "Will play football as long as possible".
const RETIRE_AT_TOP: u32 = 48;
const PLAY_ON: u32 = 49;

/// Bytes per entry of the index by person id: the `u32` id, 4 spare bytes and the pointer to the entry.
const INDEX_ENTRY: usize = 16;

/// The most pointers the block of the list of planned retirements may hold. The game plans them for the whole
/// database and doubles the block as the list grows, so late in a season it is far past a squad's 2,000; the index
/// by person id must still list as many.
const LONGEST_PLANNED: u64 = 1 << 17;

/// One retirement the game has planned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRetirement {
    /// The id the game gives the person who retires (player `player_person`).
    pub person: u32,
    pub date: Option<FmDate>,
    /// Where the entry is.
    #[serde(skip)]
    pub address: u64,
}

/// Keeping a player from retiring, worked out from the game as it is now and ready to be written.
#[derive(Debug, Clone)]
pub struct RetirementPlan {
    pub player: u32,
    /// The date he was to retire on; none when the game had not planned it yet.
    pub date: Option<FmDate>,
    taken: Taken,
    patches: Vec<Patch>,
}

/// Keeping a player from retiring that was written: what undoing it takes.
#[derive(Debug, Clone)]
pub struct RetirementSet {
    pub player: u32,
    pub date: Option<FmDate>,
    taken: Taken,
    patches: Vec<Patch>,
}

/// What keeping a player from retiring took out, to put it back once the game has changed the lists, as it does
/// each time someone retires.
#[derive(Debug, Clone, Copy)]
struct Taken {
    person: u32,
    /// His entry, none when the game had planned nothing; and the entry after his in the list, none when he was last.
    entry: Option<u64>,
    next: Option<u64>,
    /// The byte of the mask that holds the two traits: where it is, and what it held before and after.
    traits: (u64, u8, u8),
}

/// The manager's two lists, as read.
struct Planned {
    /// The list of pointers; `None` when it is empty and has no block.
    list: Option<PointerList>,
    entries: Vec<u64>,
    /// Where the list's header is, and its end and capacity.
    list_header: u64,
    list_end: u64,
    list_capacity: u64,
    /// The index by person id: where its header is, where it begins and ends, its capacity and its entries.
    index_header: u64,
    index_begin: u64,
    index_end: u64,
    index_capacity: u64,
    index: Vec<[u8; INDEX_ENTRY]>,
}

impl Planned {
    /// Where the person `person` is in the index, and his entry's pointer.
    fn find(&self, person: u32) -> Option<(usize, u64)> {
        self.index.iter().enumerate().find_map(|(at, entry)| {
            let id = u32::from_le_bytes(entry[..4].try_into().expect("4 bytes"));
            (id == person).then(|| (at, u64::from_le_bytes(entry[8..].try_into().expect("8 bytes"))))
        })
    }
}

impl Session {
    /// Every retirement the game has planned, in the order it lists them; `None` when the editor cannot find them in
    /// this build.
    pub fn planned_retirements(&self) -> Result<Option<Vec<PlannedRetirement>>, MoveError> {
        let Some(planned) = self.planned()? else {
            return Ok(None);
        };
        planned.entries.iter().map(|&entry| self.read_retirement(entry)).collect::<Result<_, _>>().map(Some)
    }

    /// The date the game plans `player` to retire on: `Ok(None)` when it has planned none, and `Err` when the editor
    /// cannot tell (see [`Session::planned_retirements`]).
    pub fn planned_retirement(&self, player: &PlayerSummary) -> Result<Option<FmDate>, MoveError> {
        let planned = self.planned()?.ok_or(MoveError::NoRetirements)?;
        let person = self.person_id(player)?;
        match planned.find(person) {
            Some((_, entry)) => Ok(self.read_retirement(entry)?.date),
            None => Ok(None),
        }
    }

    /// Works out keeping `player` from retiring: his planned retirement taken out of the manager's lists, and the
    /// trait "Will play football as long as possible" in place of "Will retire at top". Nothing is written.
    pub fn plan_keep_playing(&self, player: &PlayerSummary) -> Result<RetirementPlan, MoveError> {
        let planned = self.planned()?.ok_or(MoveError::NoRetirements)?;
        let person = self.person_id(player)?;
        let mut patches = Patches::default();
        let mut date = None;
        let mut taken = Taken { person, entry: None, next: None, traits: (0, 0, 0) };
        if let Some((at, entry)) = planned.find(person) {
            let list = planned.list.as_ref().ok_or(MoveError::NoRetirements)?;
            let index = planned.entries.iter().position(|&listed| listed == entry).ok_or(MoveError::NoRetirements)?;
            date = self.read_retirement(entry)?.date;
            (taken.entry, taken.next) = (Some(entry), planned.entries.get(index + 1).copied());
            // The index first, as the game finds a person's entry by it; each list repeats its last entry for a
            // moment, then ends one earlier and clears the slot it gave up.
            let last = planned.index.len() - 1;
            let size = INDEX_ENTRY as u64;
            patches.push(
                planned.index_begin + at as u64 * size,
                planned.index[at..last].concat(),
                planned.index[at + 1..].concat(),
            );
            let end = planned.index_end;
            patches.push(planned.index_header + 8, end.to_le_bytes(), (end - size).to_le_bytes());
            patches.push(planned.index_begin + last as u64 * size, planned.index[last], [0; INDEX_ENTRY]);
            removal_patches(list, index, &planned.entries, &mut patches);
        }
        // The two traits share the mask's seventh byte.
        let p = &self.layout.player;
        let byte = player.address + p.at(p.traits, player.shift) + u64::from(RETIRE_AT_TOP / 8);
        let old = self.process.read_bytes(byte, 1)?[0];
        let new = (old & !(1 << (RETIRE_AT_TOP % 8))) | (1 << (PLAY_ON % 8));
        patches.push(byte, [old], [new]);
        taken.traits = (byte, old, new);
        if patches.0.is_empty() {
            return Err(MoveError::NotRetiring);
        }
        Ok(RetirementPlan { player: player.uid, date, taken, patches: patches.0 })
    }

    /// Writes planned changes to a player's retirement, each write over the bytes it expects, after checking them
    /// all.
    pub fn apply_retirement(&self, plan: &RetirementPlan) -> Result<RetirementSet, MoveError> {
        self.apply_patches(&plan.patches)?;
        let RetirementPlan { player, date, taken, ref patches } = *plan;
        Ok(RetirementSet { player, date, taken, patches: patches.clone() })
    }

    /// Puts his planned retirement and traits back: as they were, when the game still holds what the change wrote;
    /// otherwise, as the game changes the lists each time someone retires, his entry goes back into both (see
    /// [`Session::replan`]).
    pub fn undo_retirement(&self, done: &RetirementSet) -> Result<(), MoveError> {
        match self.undo_patches(&done.patches) {
            Err(MoveError::Changed { .. }) => self.replan(&done.taken),
            done => done,
        }
    }

    /// Puts back what keeping a player from retiring took out, into the manager's lists as they are now: his entry,
    /// which nothing else points at and the game has left alone, goes back into the list before the entry that
    /// followed it (by date when that one has gone) and into the index by person id, where both have room. When the
    /// game has planned his retirement again meanwhile, its plan stays. His traits come back if they hold what was
    /// written.
    fn replan(&self, taken: &Taken) -> Result<(), MoveError> {
        let mut patches = Patches::default();
        let (byte, old, new) = taken.traits;
        if old != new {
            if self.process.read_bytes(byte, 1)?[0] != new {
                return Err(MoveError::Changed { address: byte });
            }
            patches.push(byte, [new], [old]);
        }
        let planned = self.planned()?.ok_or(MoveError::NoRetirements)?;
        if let Some(entry) = taken.entry.filter(|_| planned.find(taken.person).is_none()) {
            let retirement = self.read_retirement(entry)?;
            if retirement.person != taken.person || planned.entries.contains(&entry) {
                return Err(MoveError::Changed { address: entry });
            }
            let (pointer, index) = (8, INDEX_ENTRY as u64);
            let begin = planned.list.as_ref().map(|list| list.begin_address()).ok_or(MoveError::NoRetirements)?;
            if planned.list_capacity - planned.list_end < pointer || planned.index_capacity - planned.index_end < index
            {
                return Err(MoveError::Changed { address: planned.list_header });
            }
            // The list runs in date order: before the entry that followed his if it still fits there, otherwise after
            // the last that retires on his date or earlier.
            let dates = planned.entries.iter().map(|&e| self.read_retirement(e).map(|r| r.date));
            let dates: Vec<Option<FmDate>> = dates.collect::<Result<_, _>>()?;
            let date = retirement.date;
            let by_date = dates.iter().position(|&listed| listed > date).unwrap_or(dates.len());
            let at = match taken.next.and_then(|next| planned.entries.iter().position(|&listed| listed == next)) {
                Some(at) if (at == 0 || dates[at - 1] <= date) && dates[at] >= date => at,
                _ => by_date,
            };
            // The list first, then the index the game finds a person's entry by: each moves the entries from his
            // place on one slot down, into room it has, then ends one later.
            let words = |entries: &[u64]| entries.iter().flat_map(|e| e.to_le_bytes()).collect::<Vec<u8>>();
            let moved = words(&planned.entries[at..]);
            let spare = self.process.read_bytes(planned.list_end, pointer as usize)?;
            patches.push(
                begin + at as u64 * pointer,
                [moved.clone(), spare].concat(),
                [&entry.to_le_bytes()[..], &moved[..]].concat(),
            );
            let end = planned.list_end;
            patches.push(planned.list_header + 8, end.to_le_bytes(), (end + pointer).to_le_bytes());

            let id = |e: &[u8; INDEX_ENTRY]| u32::from_le_bytes(e[..4].try_into().expect("4 bytes"));
            let slot = planned.index.iter().position(|e| id(e) > taken.person).unwrap_or(planned.index.len());
            let mut added = [0; INDEX_ENTRY];
            added[..4].copy_from_slice(&taken.person.to_le_bytes());
            added[8..].copy_from_slice(&entry.to_le_bytes());
            let moved = planned.index[slot..].concat();
            let spare = self.process.read_bytes(planned.index_end, INDEX_ENTRY)?;
            patches.push(
                planned.index_begin + slot as u64 * index,
                [moved.clone(), spare].concat(),
                [&added[..], &moved[..]].concat(),
            );
            let end = planned.index_end;
            patches.push(planned.index_header + 8, end.to_le_bytes(), (end + index).to_le_bytes());
        }
        self.write_patches(&patches.0)
    }

    /// The retirement manager, found from its static and checked by its class; `None` when this build's profile and
    /// layout do not place it or it does not check out.
    fn retirement_manager(&self) -> Option<u64> {
        self.layout.retirement.as_ref()?;
        let rva = self.profile.as_ref()?.retirement_manager?;
        let manager = self.process.read_u64(self.plugin.base + rva).ok().filter(|&at| is_user_pointer(at))?;
        let vtable = self.process.read_u64(manager).ok()?;
        if self.retirement_class.get() != Some(&vtable) {
            if class_of(&self.process, &self.plugin, manager)? != mangled(MANAGER_CLASS) {
                return None;
            }
            let _ = self.retirement_class.set(vtable);
        }
        Some(manager)
    }

    /// The manager's lists, checked: as many entries in the index as in the list. `None` when the manager cannot be
    /// found.
    fn planned(&self) -> Result<Option<Planned>, MoveError> {
        let Some(manager) = self.retirement_manager() else {
            return Ok(None);
        };
        let r = self.layout.retirement.as_ref().expect("the manager was found");
        let header = |at: u64| -> Result<[u64; 3], MoveError> {
            let words = self.process.read_bytes(at, 24)?;
            Ok([0, 1, 2].map(|i| u64::from_le_bytes(words[i * 8..i * 8 + 8].try_into().expect("8 bytes"))))
        };
        // A list the game has not needed yet has no block.
        let list_header = manager + r.planned;
        let [list_begin, list_end, list_capacity] = header(list_header)?;
        let list = match [list_begin, list_end, list_capacity] {
            [0, 0, 0] => None,
            _ => {
                let list = PointerList::read_up_to(&self.process, list_header, LONGEST_PLANNED)?;
                Some(list.ok_or(MoveError::NoRetirements)?)
            }
        };
        let entries = list.as_ref().map(|list| list.elements(&self.process)).transpose()?.unwrap_or_default();
        let index_header = manager + r.by_person;
        let [begin, end, capacity] = header(index_header)?;
        let size = INDEX_ENTRY as u64;
        let sane = (is_user_pointer(begin) || begin == 0)
            && begin <= end
            && end <= capacity
            && (end - begin).is_multiple_of(size)
            && (end - begin) / size == entries.len() as u64
            && entries.iter().all(|&entry| is_user_pointer(entry));
        if !sane {
            return Err(MoveError::NoRetirements);
        }
        let bytes = if end > begin { self.process.read_bytes(begin, (end - begin) as usize)? } else { Vec::new() };
        let index = bytes.as_chunks::<INDEX_ENTRY>().0.to_vec();
        Ok(Some(Planned {
            list,
            entries,
            list_header,
            list_end,
            list_capacity,
            index_header,
            index_begin: begin,
            index_end: end,
            index_capacity: capacity,
            index,
        }))
    }

    /// The entry at `entry`.
    fn read_retirement(&self, entry: u64) -> Result<PlannedRetirement, MoveError> {
        let r = self.layout.retirement.as_ref().ok_or(MoveError::NoRetirements)?;
        let person = self.process.read_u32(entry + r.person)?;
        let raw = self.process.read_u32(entry + r.date)?;
        Ok(PlannedRetirement { person, date: FmDate::from_raw(raw as u16, (raw >> 16) as u16), address: entry })
    }

    /// The id the game gives `player`, once his object is checked to still be his.
    fn person_id(&self, player: &PlayerSummary) -> Result<u32, MoveError> {
        let (p, r) = (&self.layout.player, self.layout.retirement.as_ref().ok_or(MoveError::NoRetirements)?);
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        Ok(self.process.read_u32(player.address + p.at(r.player_person, player.shift))?)
    }
}
