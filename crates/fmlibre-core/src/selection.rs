//! What a human manager has picked for his club.
//!
//! The match engine keeps the starting eleven and the substitutes of each of his tactics as prepared tactics (see
//! [`SelectionLayout`]): slots of the ids the game gives people. It keeps more than one copy of them, and nothing the
//! editor reads leads to them, so they are found by their class, in one pass over the game's memory that takes a few
//! seconds.
//!
//! When a player leaves the club, the game empties his slots, which its tactics screen then shows as "None". A move
//! out of the club does the same, in every copy that is the club's: one whose filled slots are mostly the club's
//! players, which a national team's selection is not. An undo fills a copy again only while nothing has changed it.
//!
//! [`SelectionLayout`]: crate::SelectionLayout

use std::collections::HashSet;

use crate::rtti;
use crate::session::Session;
use crate::transfer::{MoveError, Patch, Patches, PointerList};

/// What a slot holds when nobody fills it.
const EMPTY: u32 = u32::MAX;

/// A player leaving a club a human manager runs, as far as its selections go.
#[derive(Debug, Clone)]
pub(crate) struct Leaver {
    /// The id the game gives him.
    person: u32,
    /// The ids of the players of the club's teams, his among them.
    club: HashSet<u32>,
}

impl Session {
    /// Whether a move out of a club a human manager runs can empty the player's slots in its selections: the layout
    /// places them, and the game names their class.
    pub(crate) fn selections_known(&self) -> bool {
        !self.selection_vtables().is_empty()
    }

    fn selection_vtables(&self) -> &[u64] {
        self.selection_class.get_or_init(|| match &self.layout.selection {
            Some(selection) => rtti::vtables(&self.process, &self.plugin, &selection.class),
            None => Vec::new(),
        })
    }

    /// The player at `object` leaving the club whose teams are `teams`.
    pub(crate) fn leaver(&self, object: u64, teams: &[u64]) -> Result<Leaver, MoveError> {
        let selection = self.layout.selection.as_ref().ok_or(MoveError::HumanClub)?;
        let p = &self.layout.player;
        let person = self.process.read_u32(object + selection.player_person)?;
        let mut club = HashSet::new();
        for &team in teams {
            let Some(list) = PointerList::read(&self.process, team + self.layout.team.players)? else {
                continue;
            };
            for player in list.elements(&self.process)? {
                // A player-coach keeps his id further on. Reading both places only adds to the ids the club's
                // selections are told apart by.
                for &shift in &p.person_block_shifts {
                    if let Ok(id) = self.process.read_u32(player + p.at(selection.player_person, shift)) {
                        club.insert(id);
                    }
                }
            }
        }
        Ok(Leaver { person, club })
    }

    /// The writes that empty the slots of `leaver` in every selection of his club: one write of all the slots of a
    /// copy, so that an undo can tell whether anything has changed it since.
    pub(crate) fn selection_patches(&self, leaver: &Leaver) -> Result<Vec<Patch>, MoveError> {
        let selection = self.layout.selection.as_ref().ok_or(MoveError::HumanClub)?;
        let vtables = self.selection_vtables();
        if vtables.is_empty() {
            return Err(MoveError::HumanClub);
        }
        let mut patches = Patches::default();
        for object in rtti::objects(&self.process, &self.plugin, vtables)?.into_values().flatten() {
            // A block the game has taken back keeps its vtable, but not its list.
            if PointerList::read(&self.process, object + selection.list)?.is_none() {
                continue;
            }
            let address = object + selection.slots;
            let Ok(before) = self.process.read_bytes(address, selection.count as usize * 4) else {
                continue;
            };
            let slots: Vec<u32> = before.as_chunks::<4>().0.iter().map(|slot| u32::from_le_bytes(*slot)).collect();
            if let Some(after) = emptied(&slots, leaver) {
                patches.push(address, before, after.iter().flat_map(|slot| slot.to_le_bytes()).collect::<Vec<u8>>());
            }
        }
        Ok(patches.0)
    }

    /// Fills again the slots `patches` emptied, in each copy that is still a selection and still holds what the move
    /// left there. Copies the game or the manager has changed since stay as they are.
    pub(crate) fn restore_selections(&self, patches: &[Patch]) {
        let Some(selection) = &self.layout.selection else {
            return;
        };
        let vtables = self.selection_vtables();
        for patch in patches.iter().rev() {
            let object = patch.address - selection.slots;
            if self.process.read_u64(object).is_ok_and(|vtable| vtables.contains(&vtable)) {
                let _ = self.write_patch(patch.address, &patch.after, &patch.before);
            }
        }
    }
}

/// The slots of a selection with the leaver's emptied, when it holds him and is his club's: most of its filled slots
/// are the club's players. A player who has left lately may still fill a slot.
fn emptied(slots: &[u32], leaver: &Leaver) -> Option<Vec<u32>> {
    if !slots.contains(&leaver.person) {
        return None;
    }
    let filled = slots.iter().filter(|&&slot| slot != EMPTY).count();
    let club = slots.iter().filter(|slot| leaver.club.contains(slot)).count();
    (2 * club > filled).then(|| slots.iter().map(|&slot| if slot == leaver.person { EMPTY } else { slot }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaver(person: u32, club: &[u32]) -> Leaver {
        Leaver { person, club: club.iter().copied().collect() }
    }

    /// Eleven and nine substitutes, the rest empty, as the Arsenal save held them.
    fn slots(ids: &[u32]) -> Vec<u32> {
        let mut slots = ids.to_vec();
        slots.resize(26, EMPTY);
        slots
    }

    #[test]
    fn a_leaver_leaves_his_slot_empty() {
        let club: Vec<u32> = (1..=25).collect();
        let selection = slots(&(1..=20).collect::<Vec<_>>());
        let after = emptied(&selection, &leaver(1, &club)).expect("his club's selection");
        assert_eq!(after[0], EMPTY);
        assert_eq!(&after[1..20], &selection[1..20]);
        assert_eq!(&after[20..], &selection[20..]);
    }

    #[test]
    fn a_player_who_left_lately_does_not_hide_the_club() {
        // Slot 3 holds a player the game released, whom the team lists no longer hold.
        let club: Vec<u32> = (1..=25).filter(|&id| id != 4).collect();
        let selection = slots(&(1..=20).collect::<Vec<_>>());
        assert!(emptied(&selection, &leaver(7, &club)).is_some_and(|after| after[6] == EMPTY && after[3] == 4));
    }

    #[test]
    fn other_selections_are_left_alone() {
        let club: Vec<u32> = (1..=25).collect();
        // A national team's: the leaver among players of other clubs.
        let national = slots(&[1, 2, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
        assert_eq!(emptied(&national, &leaver(1, &club)), None);
        // His club's, without him.
        assert_eq!(emptied(&slots(&(2..=20).collect::<Vec<_>>()), &leaver(1, &club)), None);
    }
}
