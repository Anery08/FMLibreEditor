//! Signing a free agent: a player with no club and no contract joins a club's senior team under a contract the editor
//! makes for him.
//!
//! The game's free agents have no team and no contract, and nothing but the game's list of players points at them. To
//! sign one, the editor takes a slot of the game's own pool of contracts as the game does when it makes one (see
//! `object_pool.rs`): the contract is then the game's like any other, saved with the others and let go of as they are.
//! It is a copy of the contract of the player of the club's senior team whose current ability is nearest his, among
//! those with a squad status fit for him (a goalkeeper's for a goalkeeper; for a player of 21 or more, no youngster's
//! and no youth contract), with:
//! - the player as its owner, and the senior team as his employer;
//! - the wage given, or the one it is modelled on;
//! - today as the day he signed and joined, and the end date given, or 30 June at the end of next season;
//! - no squad number, no loyalty bonus, and off the transfer and loan lists;
//! - none of the other's clauses, bonuses, reasons to be unhappy, or other records of its own
//!   ([`crate::ContractLayout::cleared`]).
//!
//! The kind of contract (full-time, part-time, ...), the squad status, how happy he is with it and the rest are the
//! other's. He then joins the senior team's list, grown when it is full (see [`Session::join_squad`]), and points at
//! the team and the contract. The undo takes all of it back, the slot first in the pool's chain again.

use fmlibre_mem::is_user_pointer;
use serde::Serialize;

use crate::clubs::ClubSummary;
use crate::date::FmDate;
use crate::edit::Kind;
use crate::players::{PLAYABLE_RATING, PlayerSummary};
use crate::session::Session;
use crate::transfer::{LISTED, MoveError, MovePlan, MoveTerms, NO_SQUAD_NUMBER, PLAYER_JOB, Patches};

/// The squad statuses only goalkeepers have: First-Choice, Cup and Domestic Cup Goalkeeper, Backup, and Emergency Backup
/// (see docs/recon/fm27-contracts.md).
const GOALKEEPERS: [u8; 5] = [15, 16, 17, 20, 21];

/// Those of youngsters: Breakthrough Prospect, Future Prospect and Youngster.
const YOUNGSTERS: [u8; 3] = [10, 11, 13];

/// Those of the other players, from Star Player to Emergency Backup: not B Team Regular or Surplus to Requirements.
const SENIORS: [u8; 7] = [1, 2, 3, 4, 5, 7, 9];

/// The status a new contract has when none of the club's has one fit for the player: Squad Player, or Backup for a
/// goalkeeper.
const SQUAD_PLAYER: u8 = 4;
const BACKUP: u8 = 20;

/// The age from which a player's contract is not modelled on a youngster's, or on a youth contract.
const ADULT: u16 = 21;

/// The kind of a youth contract (see [`crate::ContractLayout::contract_type`]).
const YOUTH_CONTRACT: u8 = 3;

/// What the contract the editor makes for a free agent says, as a plan has it: for the window to show before it is
/// written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewContract {
    /// Pounds per week.
    pub wage: i64,
    /// The end date, as a number like 20290630.
    pub expires: i64,
    /// The squad status's code (see docs/recon/fm27-contracts.md).
    pub squad_status: u8,
}

/// The end date of a contract the editor makes when none is given, as a number like 20290630: 30 June at the end of
/// the season after the one under way on `today` (seasons end on 30 June).
pub(crate) fn default_expiry(today: FmDate) -> i64 {
    let this_season_ends = if (today.month, today.day) <= (6, 30) { today.year } else { today.year + 1 };
    i64::from(this_season_ends + 1) * 10_000 + 630
}

impl Session {
    /// Whether `player` is a free agent: no team and no contract, as the game's own have.
    pub(crate) fn is_free_agent(&self, player: &PlayerSummary) -> Result<bool, MoveError> {
        let p = &self.layout.player;
        let object = player.address;
        if self.process.read_u32(object + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        let team = self.process.read_u64(object + p.team)?;
        let contract = self.process.read_u64(object + p.at(p.contract, player.shift))?;
        Ok(team == 0 && contract == 0)
    }

    /// Works out signing `player`, a free agent, to the senior team of `club` under a contract the editor makes on
    /// `terms` (see the module's notes). Nothing is written.
    pub fn plan_signing(
        &self,
        player: &PlayerSummary,
        club: &ClubSummary,
        terms: MoveTerms,
    ) -> Result<MovePlan, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let p = &layout.player;
        let (Some(size), Some(pools)) = (layout.contract.size, layout.pool.as_ref()) else {
            return Err(MoveError::NoPool);
        };
        let today = self.game_date().ok_or(MoveError::NoDate)?;
        self.check_terms(terms, Some(today))?;
        let object = player.address;
        if !self.is_free_agent(player)? {
            return Err(MoveError::UnusualContract);
        }
        if player.shift != 0 {
            return Err(MoveError::PlayerCoach);
        }
        if self.loan_contract(object, player.shift)?.is_some() {
            return Err(MoveError::OnLoan);
        }
        if process.read_u32(club.address + layout.club.uid)? != club.uid {
            return Err(MoveError::NotAClub { uid: club.uid });
        }
        let women = process.read_bytes(club.address + layout.club.women, 1)?[0] != 0;
        if player.woman != Some(women) {
            return Err(MoveError::MenAndWomen);
        }
        let (senior, list) = self.senior_team(club.address, club.uid)?;
        // A team without a list has no block to add to.
        let list = list.ok_or(MoveError::NoRoom { players: 0 })?;
        let elements = list.elements(process)?;
        if elements.contains(&object) {
            return Err(MoveError::NotListed);
        }

        let (model, status) = self.model_contract(senior, &elements, player)?;
        let pool = self.pool_holding(model, size)?;
        let taken = pool.take(process, pools)?;
        let model = process.read_bytes(model, size as usize)?;
        let contract = self.new_contract(model, object, senior, terms, today, status);
        let c = &layout.contract;
        let field = |offset: u64, kind: Kind| kind.decode(&contract[offset as usize..offset as usize + 4]);
        let made = NewContract {
            wage: field(c.wage, Kind::I32),
            expires: field(c.expires, Kind::Date),
            squad_status: contract[c.squad_status as usize],
        };

        let mut patches = Patches::default();
        patches.push(taken.pool.address, taken.pool.before, taken.pool.after);
        patches.push(taken.slot, taken.was, contract);
        let grow = self.join_squad(&list, &elements, object, &mut patches)?;
        patches.push(object + p.at(p.contract, player.shift), 0u64.to_le_bytes(), taken.slot.to_le_bytes());
        patches.push(object + p.team, 0u64.to_le_bytes(), senior.to_le_bytes());
        Ok(MovePlan {
            player: player.uid,
            from_club: 0,
            to_club: club.uid,
            other: None,
            released: None,
            patches: patches.0,
            leavers: Vec::new(),
            grow: grow.into_iter().collect(),
            contract: Some(made),
        })
    }

    /// The contract a new one for `player` is modelled on, and the squad status it then takes in place of the model's,
    /// if any. Of the players among `elements`, the list of the senior team `senior`, with a plain contract with it
    /// (their own, a player's, with the team as employer and senior team), the one whose current ability is nearest
    /// his, the first of them on a tie, among those with a status fit for him: a goalkeeper's for a goalkeeper, an
    /// outfield player's for the others, and for one of 21 or more no youngster's and no youth contract. When none
    /// has, the nearest of them all, and Squad Player (Backup for a goalkeeper).
    fn model_contract(
        &self,
        senior: u64,
        elements: &[u64],
        player: &PlayerSummary,
    ) -> Result<(u64, Option<u8>), MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let (p, c) = (&layout.player, &layout.contract);
        let goalkeeper = player.position_ratings[0] >= PLAYABLE_RATING;
        let young = player.age.is_some_and(|age| age < ADULT);
        let fits = |status: u8, kind: Option<u8>| {
            let senior_status = if goalkeeper { GOALKEEPERS.contains(&status) } else { SENIORS.contains(&status) };
            (senior_status || young && YOUNGSTERS.contains(&status)) && (young || kind != Some(YOUTH_CONTRACT))
        };
        // The nearest fitting one, and the nearest of all: the distance in ability, and the contract.
        let mut fitting: Option<(u16, u64)> = None;
        let mut any: Option<(u16, u64)> = None;
        for &element in elements {
            let Ok(contract) = process.read_u64(element + p.contract) else {
                continue;
            };
            if !is_user_pointer(contract) {
                continue;
            }
            let Ok(record) = process.read_bytes(contract, c.end() as usize) else {
                continue;
            };
            let word = |offset: u64| {
                u64::from_le_bytes(record[offset as usize..offset as usize + 8].try_into().expect("8 bytes"))
            };
            let plain = word(c.owner) == element + p.identity()
                && record[c.job as usize] == PLAYER_JOB
                && word(c.team) == senior
                && word(c.senior_team) == senior;
            let Ok(theirs) = process.read_bytes(element + p.current_ability, 2) else {
                continue;
            };
            if !plain {
                continue;
            }
            let distance = u16::from_le_bytes([theirs[0], theirs[1]]).abs_diff(player.current_ability);
            let nearer = |best: &Option<(u16, u64)>| best.is_none_or(|(nearest, _)| distance < nearest);
            if nearer(&any) {
                any = Some((distance, contract));
            }
            let kind = c.contract_type.map(|offset| record[offset as usize]);
            if fits(record[c.squad_status as usize], kind) && nearer(&fitting) {
                fitting = Some((distance, contract));
            }
        }
        match (fitting, any) {
            (Some((_, contract)), _) => Ok((contract, None)),
            (None, Some((_, contract))) => Ok((contract, Some(if goalkeeper { BACKUP } else { SQUAD_PLAYER }))),
            (None, None) => Err(MoveError::NoModel),
        }
    }

    /// The bytes of a new contract for the player `object` with the senior team `senior`, on `terms`, made from
    /// `model`'s (see the module's notes), with the squad status `status` when given.
    fn new_contract(
        &self,
        model: Vec<u8>,
        object: u64,
        senior: u64,
        terms: MoveTerms,
        today: FmDate,
        status: Option<u8>,
    ) -> Vec<u8> {
        let (p, c) = (&self.layout.player, &self.layout.contract);
        let at = |offset: u64, len: usize| offset as usize..offset as usize + len;
        let mut bytes = model.clone();
        let mut put = |offset: u64, value: &[u8]| bytes[at(offset, value.len())].copy_from_slice(value);
        put(c.owner, &(object + p.identity()).to_le_bytes());
        put(c.team, &senior.to_le_bytes());
        put(c.senior_team, &senior.to_le_bytes());
        put(c.job, &[PLAYER_JOB]);
        // The dates keep the flags the model's have.
        for offset in [c.signed, c.joined] {
            put(offset, &Kind::Date.encode(today.to_number(), &model[at(offset, 4)]));
        }
        let expires = terms.expires.unwrap_or_else(|| default_expiry(today));
        put(c.expires, &Kind::Date.encode(expires, &model[at(c.expires, 4)]));
        if let Some(wage) = terms.wage {
            put(c.wage, &Kind::I32.encode(wage, &model[at(c.wage, 4)]));
        }
        put(c.loyalty_bonus, &0i32.to_le_bytes());
        if let Some(status) = status {
            put(c.squad_status, &[status]);
        }
        put(c.squad_number, &[NO_SQUAD_NUMBER]);
        put(c.listing, &[model[c.listing as usize] & !LISTED]);
        put(c.unhappiness, &[0; 8]);
        put(c.clauses, &[0; 24]);
        put(c.competition_bonuses, &[0; 24]);
        for &offset in &c.cleared {
            put(offset, &[0; 8]);
        }
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_contract_runs_to_the_end_of_next_season() {
        let on = |number| default_expiry(FmDate::from_number(number).expect("a date"));
        assert_eq!(on(20270804), 20290630);
        assert_eq!(on(20280301), 20290630);
        assert_eq!(on(20280630), 20290630);
        assert_eq!(on(20280701), 20300630);
    }
}
