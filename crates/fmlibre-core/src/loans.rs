//! A player's loan: the second contract a player on loan has, with the team he is on loan to.
//!
//! The game keeps it apart from his contract with his own club (see [`LoanLayout`]). The editor reads where he is on
//! loan and from when to when, and changes the day the loan ends (the field `loan.expires`, see [`crate::fields`]). It
//! never ends a loan itself: a loan brought forward to end the day after the game's date ends when the game gets
//! there, and the game brings the player back to his club as it does at the end of any loan.
//!
//! [`LoanLayout`]: crate::profile::LoanLayout

use fmlibre_mem::is_user_pointer;
use serde::Serialize;

use crate::date::FmDate;
use crate::players::PlayerSummary;
use crate::rtti;
use crate::session::Session;
use crate::text::read_fm_string;

/// Where a player is on loan, as his loan contract says, and the club he belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanDetails {
    /// The club he is on loan to.
    pub club_uid: Option<u32>,
    pub club: Option<String>,
    /// The club his own contract is with.
    pub parent_uid: Option<u32>,
    pub parent: Option<String>,
    /// When the loan started, and the day it ends.
    pub from: Option<FmDate>,
    pub until: Option<FmDate>,
    /// His squad number at the club he is on loan to.
    pub squad_number: Option<u8>,
    /// Pounds per week, as the loan contract holds it.
    pub wage: i32,
}

impl Session {
    /// Whether the editor can find loan contracts in this game: the layout places them and the game names their class.
    pub fn loans_known(&self) -> bool {
        !self.loan_vtables().is_empty()
    }

    /// The vtables of loan contracts: none when the layout does not place loans or the game does not name the class.
    fn loan_vtables(&self) -> &[u64] {
        self.loan_class.get_or_init(|| match &self.layout.loan {
            Some(loan) => rtti::vtables(&self.process, &self.plugin, &loan.class),
            None => Vec::new(),
        })
    }

    /// The loan contract of the player whose object is at `object`, with his person block shifted by `shift`: `None`
    /// when he is not on loan, or when what his record leads to is not a loan contract that points back at him.
    pub fn loan_contract(&self, object: u64, shift: u64) -> fmlibre_mem::Result<Option<u64>> {
        let Some(loan) = &self.layout.loan else {
            return Ok(None);
        };
        let p = &self.layout.player;
        let record = self.process.read_u64(object + p.at(loan.record, shift))?;
        if !is_user_pointer(record) {
            return Ok(None);
        }
        let contract = self.process.read_u64(record + loan.contract)?;
        if !is_user_pointer(contract) || !self.loan_vtables().contains(&self.process.read_u64(contract)?) {
            return Ok(None);
        }
        let owner = self.process.read_u64(contract + self.layout.contract.owner)?;
        Ok((owner == object + p.identity() + shift).then_some(contract))
    }

    /// Where `player` is on loan, or `None` when he is not (or the editor cannot tell in this game).
    pub fn loan(&self, player: &PlayerSummary) -> fmlibre_mem::Result<Option<LoanDetails>> {
        let p = &self.layout.player;
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Ok(None);
        }
        let Some(contract) = self.loan_contract(player.address, player.shift)? else {
            return Ok(None);
        };
        let c = &self.layout.contract;
        let bytes = self.process.read_bytes(contract, (c.squad_number + 1) as usize)?;
        let u16_at = |at: u64| u16::from_le_bytes([bytes[at as usize], bytes[at as usize + 1]]);
        let date = |at: u64| FmDate::from_raw(u16_at(at), u16_at(at + 2));
        let team = u64::from_le_bytes(bytes[c.team as usize..c.team as usize + 8].try_into().expect("8 bytes"));
        let own = self.process.read_u64(player.address + p.at(p.contract, player.shift))?;
        let parent_team = if is_user_pointer(own) { self.process.read_u64(own + c.team)? } else { 0 };
        let (club_uid, club) = self.club_of_team(team);
        let (parent_uid, parent) = self.club_of_team(parent_team);
        let number = bytes[c.squad_number as usize];
        Ok(Some(LoanDetails {
            club_uid,
            club,
            parent_uid,
            parent,
            from: date(c.signed),
            until: date(c.expires),
            squad_number: (number != 255).then_some(number),
            wage: i32::from_le_bytes(bytes[c.wage as usize..c.wage as usize + 4].try_into().expect("4 bytes")),
        }))
    }

    /// The UID and name of the club of the team at `team`, as far as they can be read.
    fn club_of_team(&self, team: u64) -> (Option<u32>, Option<String>) {
        if !is_user_pointer(team) {
            return (None, None);
        }
        let Some(club) = self.process.read_u64(team + self.layout.team.club).ok().filter(|&c| is_user_pointer(c))
        else {
            return (None, None);
        };
        let uid = self.process.read_u32(club + self.layout.club.uid).ok();
        let name =
            self.process.read_u64(club + self.layout.club.name).ok().and_then(|at| read_fm_string(&self.process, at));
        (uid, name)
    }
}
