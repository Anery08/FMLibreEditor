//! A player's ties to nations and clubs: his secondary nationalities, and the nations and clubs he was trained in,
//! which make him homegrown under a competition's rules.
//!
//! The game keeps a person's relations as one list, the first field of the record his `relations` pointer leads to
//! (see [`RelationLayout`]): 16-byte entries that each point at a nation, club, person or competition and say how he
//! is tied to it. A secondary nationality is a tie of kind 9 to a nation; a training is one of kind 70 to a nation or
//! 72 to a club, whose value is the homegrown rule it meets. His first nationality is not among them: it is the
//! player's `nation` field.
//!
//! The editor reads those three kinds of tie. It points one at another nation or club, gives a training another
//! rule, takes one out, or adds one. Like the squad lists, the list is as long as the game made it and the editor
//! allocates nothing: a tie is added only where the list's block has room (see [`HeapLayout`]), which most players'
//! lists lack. So a tie can also take the place of what he thinks of a club: a club he favours (relation 3) or dislikes
//! (4), which says no more than that. His relations to people are left alone, as the other person's list holds the same
//! relation back to him.
//!
//! [`HeapLayout`]: crate::profile::HeapLayout
//! [`RelationLayout`]: crate::profile::RelationLayout

use fmlibre_mem::is_user_pointer;
use serde::{Deserialize, Serialize};

use crate::clubs::ClubSummary;
use crate::players::{Nation, PlayerSummary, nation_name};
use crate::session::Session;
use crate::text::read_fm_string;
use crate::transfer::{MoveError, Patch, Patches};

/// The longest list of relations the editor reads; on the test save the longest held 42.
const MOST_RELATIONS: u64 = 256;

/// The game's codes for the kinds of target.
const CLUB: u8 = 1;
const NATION: u8 = 8;

/// The game's codes for a club a person favours, and one he dislikes.
const FAVOURED_CLUB: u8 = 3;
const DISLIKED_CLUB: u8 = 4;

/// The homegrown rules the editor writes, by the game's code: 15–21, 0–21, 15–21 excluding loans, and 0–19 for a
/// year. The game has others, which the editor shows but does not write.
pub const HOMEGROWN_RULES: [u8; 4] = [1, 2, 5, 10];

/// The ties the editor reads and writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tie {
    /// A secondary nationality.
    Nationality,
    /// A nation he was trained in.
    TrainedInNation,
    /// A club he was trained at.
    TrainedAtClub,
}

impl Tie {
    const ALL: [Tie; 3] = [Tie::Nationality, Tie::TrainedInNation, Tie::TrainedAtClub];

    /// The kind of target and the kind of relation the game codes it with.
    fn codes(self) -> (u8, u8) {
        match self {
            Tie::Nationality => (NATION, 9),
            Tie::TrainedInNation => (NATION, 70),
            Tie::TrainedAtClub => (CLUB, 72),
        }
    }

    /// Whether its value is a homegrown rule.
    fn is_training(self) -> bool {
        self != Tie::Nationality
    }
}

/// What a tie points at.
#[derive(Debug, Clone, Copy)]
pub enum TieTarget<'a> {
    Nation(&'a Nation),
    Club(&'a ClubSummary),
}

impl TieTarget<'_> {
    fn uid(&self) -> u32 {
        match self {
            TieTarget::Nation(nation) => nation.uid.unwrap_or(0),
            TieTarget::Club(club) => club.uid,
        }
    }

    fn name(&self) -> String {
        match self {
            TieTarget::Nation(nation) => nation.name.clone(),
            TieTarget::Club(club) => club.name.clone(),
        }
    }
}

/// One of a player's ties.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    /// Where it is in his list of relations.
    pub index: usize,
    pub tie: Tie,
    /// The nation or club.
    #[serde(skip)]
    pub target: u64,
    /// The UID of the nation or club.
    pub target_uid: u32,
    /// The name of the nation or club.
    pub name: Option<String>,
    /// For a training, the homegrown rule it meets.
    pub rule: Option<u8>,
}

/// What a player thinks of a club.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Opinion {
    Favoured,
    Disliked,
}

/// A club a player favours or dislikes, which a tie may take the place of where his list has no room for another (see
/// [`Session::plan_relation_replace`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubOpinion {
    /// Where it is in his list of relations.
    pub index: usize,
    pub opinion: Opinion,
    /// The club.
    #[serde(skip)]
    pub target: u64,
    pub target_uid: u32,
    pub name: Option<String>,
}

/// A change to a player's ties, worked out from the game as it is now and ready to be written.
#[derive(Debug, Clone)]
pub struct RelationPlan {
    pub player: u32,
    /// The tie before and after: none before for one added, none after for one taken out.
    pub before: Option<Relation>,
    pub after: Option<Relation>,
    /// For a tie that took the place of what he thought of a club: that.
    pub replaced: Option<ClubOpinion>,
    patches: Vec<Patch>,
}

/// A change to a player's ties that was written: what undoing it takes.
#[derive(Debug, Clone)]
pub struct RelationSet {
    pub player: u32,
    pub before: Option<Relation>,
    pub after: Option<Relation>,
    pub replaced: Option<ClubOpinion>,
    patches: Vec<Patch>,
}

/// A player's list of relations, as read.
struct RelationList {
    header: u64,
    begin: u64,
    end: u64,
    capacity: u64,
    /// The bytes of each entry.
    entries: Vec<Vec<u8>>,
}

impl Session {
    /// The ties of `player`: his secondary nationalities, and the nations and clubs he was trained in.
    pub fn relations(&self, player: &PlayerSummary) -> Result<Vec<Relation>, MoveError> {
        let Some(list) = self.relation_list(player)? else {
            return Ok(Vec::new());
        };
        Ok(list.entries.iter().enumerate().filter_map(|(index, entry)| self.tie_at(index, entry)).collect())
    }

    /// Every entry of the list of relations of `player`, as stored, ties of the kinds the editor leaves alone
    /// included: their place in the list and their bytes.
    pub fn relation_entries(&self, player: &PlayerSummary) -> Result<Vec<(usize, Vec<u8>)>, MoveError> {
        Ok(self.relation_list(player)?.map(|list| list.entries.into_iter().enumerate().collect()).unwrap_or_default())
    }

    /// How many more ties the list of `player` has room for.
    pub fn relation_room(&self, player: &PlayerSummary) -> Result<usize, MoveError> {
        match self.relation_list(player)? {
            Some(list) => self.room(&list),
            None => Ok(0),
        }
    }

    /// The clubs `player` favours or dislikes, which a tie may take the place of (see `plan_relation_replace`).
    pub fn club_opinions(&self, player: &PlayerSummary) -> Result<Vec<ClubOpinion>, MoveError> {
        let Some(list) = self.relation_list(player)? else {
            return Ok(Vec::new());
        };
        Ok(list.entries.iter().enumerate().filter_map(|(index, entry)| self.opinion_at(index, entry)).collect())
    }

    /// Works out pointing the tie at `index` in the list of `player` at another nation or club, and giving a training
    /// another rule; what is left out stays. Nothing is written.
    pub fn plan_relation_change(
        &self,
        player: &PlayerSummary,
        index: usize,
        target: Option<TieTarget>,
        rule: Option<u8>,
    ) -> Result<RelationPlan, MoveError> {
        let r = &self.layout.relation;
        let list = self.relation_list(player)?.ok_or(MoveError::NoRelation { index })?;
        let before = list.entries.get(index).and_then(|entry| self.tie_at(index, entry));
        let before = before.ok_or(MoveError::NoRelation { index })?;
        let address = list.begin + index as u64 * r.size;
        let mut after = before.clone();
        let mut patches = Patches::default();
        if let Some(target) = target {
            after.target = self.tie_target(player, before.tie, target)?;
            after.target_uid = target.uid();
            after.name = Some(target.name());
            patches.push(address + r.target, before.target.to_le_bytes(), after.target.to_le_bytes());
        }
        if let Some(rule) = rule {
            let old = before.rule.ok_or(MoveError::UnknownRule { rule })?;
            if !HOMEGROWN_RULES.contains(&rule) {
                return Err(MoveError::UnknownRule { rule });
            }
            after.rule = Some(rule);
            patches.push(address + r.value, [old], [rule]);
        }
        if patches.0.is_empty() || self.relations(player)?.iter().any(|tie| tie.index != index && same(tie, &after)) {
            return Err(MoveError::SameRelation);
        }
        Ok(RelationPlan {
            player: player.uid,
            before: Some(before),
            after: Some(after),
            replaced: None,
            patches: patches.0,
        })
    }

    /// Works out taking the tie at `index` out of the list of `player`: the entries after it move up one. Nothing is
    /// written.
    pub fn plan_relation_removal(&self, player: &PlayerSummary, index: usize) -> Result<RelationPlan, MoveError> {
        let size = self.layout.relation.size;
        let list = self.relation_list(player)?.ok_or(MoveError::NoRelation { index })?;
        let before = list.entries.get(index).and_then(|entry| self.tie_at(index, entry));
        let before = before.ok_or(MoveError::NoRelation { index })?;
        let entries = &list.entries;
        let last = entries.len() - 1;
        let mut patches = Patches::default();
        // As in a squad list: the list repeats its last entry for a moment, then ends one earlier and clears it.
        patches.push(list.begin + index as u64 * size, entries[index..last].concat(), entries[index + 1..].concat());
        patches.push(list.header + 8, list.end.to_le_bytes(), (list.end - size).to_le_bytes());
        patches.push(list.begin + last as u64 * size, entries[last].clone(), vec![0; size as usize]);
        Ok(RelationPlan { player: player.uid, before: Some(before), after: None, replaced: None, patches: patches.0 })
    }

    /// Works out adding a tie of `tie` to `target` to the list of `player`, with the homegrown rule `rule` for a
    /// training, where the list's block has room. Nothing is written.
    pub fn plan_relation_add(
        &self,
        player: &PlayerSummary,
        tie: Tie,
        target: TieTarget,
        rule: Option<u8>,
    ) -> Result<RelationPlan, MoveError> {
        let size = self.layout.relation.size;
        let list = self.relation_list(player)?.ok_or(MoveError::RelationsFull)?;
        let after = self.new_tie(player, list.entries.len(), tie, target, rule)?;
        if self.room(&list)? == 0 {
            return Err(MoveError::RelationsFull);
        }
        let mut patches = Patches::default();
        let slot = self.process.read_bytes(list.end, size as usize)?;
        patches.push(list.end, slot, self.entry_of(&after));
        let end = list.end + size;
        let header = [list.end.to_le_bytes(), list.capacity.to_le_bytes()].concat();
        patches.push(list.header + 8, header, [end.to_le_bytes(), list.capacity.max(end).to_le_bytes()].concat());
        Ok(RelationPlan { player: player.uid, before: None, after: Some(after), replaced: None, patches: patches.0 })
    }

    /// Works out giving `player` a tie of `tie` to `target`, with the homegrown rule `rule` for a training, in place of
    /// the club he favours or dislikes at `index` in his list: the way to give him one more tie where his list has no
    /// room for it. Nothing is written.
    pub fn plan_relation_replace(
        &self,
        player: &PlayerSummary,
        index: usize,
        tie: Tie,
        target: TieTarget,
        rule: Option<u8>,
    ) -> Result<RelationPlan, MoveError> {
        let list = self.relation_list(player)?.ok_or(MoveError::NoOpinion { index })?;
        let old = list.entries.get(index).ok_or(MoveError::NoOpinion { index })?;
        let replaced = self.opinion_at(index, old).ok_or(MoveError::NoOpinion { index })?;
        let after = self.new_tie(player, index, tie, target, rule)?;
        let mut patches = Patches::default();
        patches.push(list.begin + index as u64 * self.layout.relation.size, old.clone(), self.entry_of(&after));
        let replaced = Some(replaced);
        Ok(RelationPlan { player: player.uid, before: None, after: Some(after), replaced, patches: patches.0 })
    }

    /// Writes a planned change to a player's ties, each write over the bytes it expects, after checking them all.
    pub fn apply_relation(&self, plan: &RelationPlan) -> Result<RelationSet, MoveError> {
        self.apply_patches(&plan.patches)?;
        let RelationPlan { player, ref before, ref after, ref replaced, ref patches } = *plan;
        Ok(RelationSet {
            player,
            before: before.clone(),
            after: after.clone(),
            replaced: replaced.clone(),
            patches: patches.clone(),
        })
    }

    /// A new tie of `tie` to `target` for `player`, at `index` in his list, with the homegrown rule `rule` for a
    /// training: checked to be one the editor writes, and one he does not have yet.
    fn new_tie(
        &self,
        player: &PlayerSummary,
        index: usize,
        tie: Tie,
        target: TieTarget,
        rule: Option<u8>,
    ) -> Result<Relation, MoveError> {
        let rule = match (tie.is_training(), rule) {
            (true, Some(rule)) if HOMEGROWN_RULES.contains(&rule) => Some(rule),
            (false, None) => None,
            (_, rule) => return Err(MoveError::UnknownRule { rule: rule.unwrap_or(0) }),
        };
        let tie = Relation {
            index,
            tie,
            target: self.tie_target(player, tie, target)?,
            target_uid: target.uid(),
            name: Some(target.name()),
            rule,
        };
        if self.relations(player)?.iter().any(|known| same(known, &tie)) {
            return Err(MoveError::SameRelation);
        }
        Ok(tie)
    }

    /// The bytes of a new entry for `tie`, as the game writes one: a nationality's strength of 100 and 80, or a
    /// training's rule.
    fn entry_of(&self, tie: &Relation) -> Vec<u8> {
        let r = &self.layout.relation;
        let mut entry = vec![0u8; r.size as usize];
        entry[r.target as usize..r.target as usize + 8].copy_from_slice(&tie.target.to_le_bytes());
        let (kind, relation) = tie.tie.codes();
        entry[r.target_kind as usize] = kind;
        entry[r.relation as usize] = relation;
        let value = r.value as usize;
        (entry[value], entry[value + 1]) = match tie.rule {
            Some(rule) => (rule, 0xFF),
            None => (0x64, 0x50),
        };
        entry[r.size as usize - 1] = 0xFF;
        entry
    }

    /// Puts the ties back as they were, provided the list still holds what the change wrote.
    pub fn undo_relation(&self, done: &RelationSet) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// The list of relations of `player`, or `None` for a player without a record of them.
    fn relation_list(&self, player: &PlayerSummary) -> Result<Option<RelationList>, MoveError> {
        let (p, size) = (&self.layout.player, self.layout.relation.size);
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        let header = self.process.read_u64(player.address + p.at(p.relations, player.shift))?;
        if !is_user_pointer(header) {
            return Ok(None);
        }
        let words = self.process.read_bytes(header, 24)?;
        let word = |i: usize| u64::from_le_bytes(words[i * 8..i * 8 + 8].try_into().expect("8 bytes"));
        let (begin, end, capacity) = (word(0), word(1), word(2));
        if begin == 0 && end == 0 && capacity == 0 {
            return Ok(Some(RelationList { header, begin, end, capacity, entries: Vec::new() }));
        }
        let sane = is_user_pointer(begin)
            && begin <= end
            && end <= capacity
            && (end - begin).is_multiple_of(size)
            && (capacity - begin).is_multiple_of(size)
            && capacity - begin <= size * MOST_RELATIONS;
        if !sane {
            return Err(MoveError::NotListed);
        }
        let bytes = self.process.read_bytes(begin, (end - begin) as usize)?;
        let entries = bytes.chunks(size as usize).map(<[u8]>::to_vec).collect();
        Ok(Some(RelationList { header, begin, end, capacity, entries }))
    }

    /// The tie `entry` at `index` is, or `None` for a relation of another kind.
    fn tie_at(&self, index: usize, entry: &[u8]) -> Option<Relation> {
        let r = &self.layout.relation;
        let codes = (entry[r.target_kind as usize], entry[r.relation as usize]);
        let tie = Tie::ALL.into_iter().find(|tie| tie.codes() == codes)?;
        let target = u64::from_le_bytes(entry[r.target as usize..r.target as usize + 8].try_into().ok()?);
        if !is_user_pointer(target) {
            return None;
        }
        let (target_uid, name) = if tie == Tie::TrainedAtClub {
            let name = self.process.read_u64(target + self.layout.club.name).ok();
            (self.layout.club.uid, name.and_then(|text| read_fm_string(&self.process, text)))
        } else {
            (self.layout.nation.uid, nation_name(&self.process, &self.layout, target))
        };
        let target_uid = self.process.read_u32(target + target_uid).ok()?;
        let rule = tie.is_training().then_some(entry[r.value as usize]);
        Some(Relation { index, tie, target, target_uid, name, rule })
    }

    /// The club `entry` at `index` says the player favours or dislikes, or `None` for a relation of another kind, or one
    /// whose club does not check out.
    fn opinion_at(&self, index: usize, entry: &[u8]) -> Option<ClubOpinion> {
        let r = &self.layout.relation;
        let opinion = match (entry[r.target_kind as usize], entry[r.relation as usize]) {
            (CLUB, FAVOURED_CLUB) => Opinion::Favoured,
            (CLUB, DISLIKED_CLUB) => Opinion::Disliked,
            _ => return None,
        };
        let target = u64::from_le_bytes(entry[r.target as usize..r.target as usize + 8].try_into().ok()?);
        if !is_user_pointer(target) {
            return None;
        }
        let target_uid = self.process.read_u32(target + self.layout.club.uid).ok()?;
        let name = self.process.read_u64(target + self.layout.club.name).ok();
        let name = name.and_then(|text| read_fm_string(&self.process, text));
        Some(ClubOpinion { index, opinion, target, target_uid, name })
    }

    /// How many more entries the block of `list` holds: up to its capacity, or to the end of the allocator's block
    /// when its size is known and nothing has been written past the capacity.
    fn room(&self, list: &RelationList) -> Result<usize, MoveError> {
        if list.begin == 0 {
            return Ok(0);
        }
        let mut free = list.capacity - list.end;
        if let Some(block) = self.layout.heap.block_size(list.capacity - list.begin) {
            let spare = self.process.read_bytes(list.capacity, (list.begin + block - list.capacity) as usize)?;
            if spare.iter().all(|&b| b == 0) {
                free = list.begin + block - list.end;
            }
        }
        Ok((free / self.layout.relation.size) as usize)
    }

    /// The address of `target`, checked: one of the game's nations or clubs, as `tie` takes. A secondary nationality
    /// cannot be the player's first one.
    fn tie_target(&self, player: &PlayerSummary, tie: Tie, target: TieTarget) -> Result<u64, MoveError> {
        let p = &self.layout.player;
        match (tie, target) {
            (Tie::Nationality | Tie::TrainedInNation, TieTarget::Nation(nation)) => {
                let first = self.process.read_u64(player.address + p.at(p.nation, player.shift))?;
                let same_class = is_user_pointer(first)
                    && is_user_pointer(nation.address)
                    && self.process.read_u64(first)? == self.process.read_u64(nation.address)?;
                let uid = self.process.read_u32(nation.address + self.layout.nation.uid)?;
                if !same_class || Some(uid) != nation.uid {
                    return Err(MoveError::WrongTarget);
                }
                if tie == Tie::Nationality && nation.address == first {
                    return Err(MoveError::SameRelation);
                }
                Ok(nation.address)
            }
            (Tie::TrainedAtClub, TieTarget::Club(club)) => {
                if self.process.read_u32(club.address + self.layout.club.uid)? != club.uid {
                    return Err(MoveError::WrongTarget);
                }
                Ok(club.address)
            }
            _ => Err(MoveError::WrongTarget),
        }
    }
}

/// Whether two ties say the same: the same kind, to the same nation or club, under the same rule.
fn same(a: &Relation, b: &Relation) -> bool {
    a.tie == b.tie && a.target == b.target && a.rule == b.rule
}
