//! A player's loan: the second contract a player on loan has, with the team he is on loan to.
//!
//! The game keeps it apart from his contract with his own club (see [`LoanLayout`]). The editor reads where he is on
//! loan, from when to when and on what terms, and changes the day the loan ends (the field `loan.expires`, see
//! [`crate::fields`]). It
//! never ends a loan itself. The game takes that day as the loan's last one: when it is over, the game ends the loan
//! and the player is back at his club the next day, as at the end of any loan. So a loan brought forward to end on the
//! game's date brings him back one day on (on the Game Pass save, Onana and Bayındır, made to end the next day, were
//! back two days on).
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
    /// Where its end stands against the game's date.
    pub ends: LoanEnd,
    /// Whether the editor brought it forward this session (see the app's change log); the core never sets it.
    pub recalled: bool,
    /// What the clubs agreed, as the game's Loan Club tab shows it; none where the layout does not place it, or what
    /// is there does not read as terms.
    pub terms: Option<LoanTerms>,
}

/// The terms of a loan, as the game's Loan Club tab shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanTerms {
    /// His own club may recall him ("Can be recalled"). The editor's recall does not go through the game's: it moves
    /// the loan's last day, which the game holds to either way.
    pub can_be_recalled: bool,
    /// The loan may be ended early: false where the game says "Loan cannot be terminated".
    pub can_be_terminated: bool,
    /// He may play in cup matches.
    pub cup_matches: bool,
    /// He may play against his own club.
    pub against_own_club: bool,
    /// Pounds: the fee for which the club he is on loan to may sign him for good ("Optional Future Fee").
    pub option_fee: Option<i32>,
    /// Pounds a month that club pays his own while he plays ("Monthly playing fee").
    pub monthly_fee: Option<i32>,
    /// Pounds a month it pays while he is not used ("Unused Monthly Fee").
    pub unused_fee: Option<i32>,
    /// The flags as the game keeps them, the bits the game shows nothing for too.
    pub flags: u16,
}

impl LoanTerms {
    /// The terms from what a loan contract holds: its flags and its three amounts (-1 for none). `None` when an
    /// amount is below -1, which no loan holds: then the bytes are not terms.
    pub fn decode(flags: u16, option_fee: i32, monthly_fee: i32, unused_fee: i32) -> Option<Self> {
        if [option_fee, monthly_fee, unused_fee].iter().any(|&amount| amount < -1) {
            return None;
        }
        let amount = |value: i32| (value >= 0).then_some(value);
        Some(Self {
            can_be_recalled: flags & 0x4 != 0,
            can_be_terminated: flags & 0x1000 == 0,
            cup_matches: flags & 0x2 != 0,
            against_own_club: flags & 0x1 != 0,
            option_fee: amount(option_fee),
            monthly_fee: amount(monthly_fee),
            unused_fee: amount(unused_fee),
            flags,
        })
    }
}

/// Where a loan's end stands against the game's date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoanEnd {
    /// After the game's date.
    Later,
    /// On the game's date: its last day. When the day is over the game ends it, and he is back at his club the next day.
    Today,
    /// Before the game's date, and he is still on loan: the game has not ended it when its day was over.
    Passed,
    /// The game's date, or the loan's end, is not known.
    Unknown,
}

impl LoanEnd {
    /// Where the end `until` stands against the game's date `today`.
    pub fn of(until: Option<FmDate>, today: Option<FmDate>) -> Self {
        match (until, today) {
            (Some(until), Some(today)) if until > today => LoanEnd::Later,
            (Some(until), Some(today)) if until == today => LoanEnd::Today,
            (Some(_), Some(_)) => LoanEnd::Passed,
            _ => LoanEnd::Unknown,
        }
    }
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
        let terms_layout = self.layout.loan.as_ref().and_then(|loan| loan.terms.as_ref());
        let length = terms_layout.map_or(0, |t| t.end()).max(c.squad_number + 1);
        let bytes = self.process.read_bytes(contract, length as usize)?;
        let u16_at = |at: u64| u16::from_le_bytes([bytes[at as usize], bytes[at as usize + 1]]);
        let i32_at = |at: u64| i32::from_le_bytes(bytes[at as usize..at as usize + 4].try_into().expect("4 bytes"));
        let date = |at: u64| FmDate::from_raw(u16_at(at), u16_at(at + 2));
        let team = u64::from_le_bytes(bytes[c.team as usize..c.team as usize + 8].try_into().expect("8 bytes"));
        let own = self.process.read_u64(player.address + p.at(p.contract, player.shift))?;
        let parent_team = if is_user_pointer(own) { self.process.read_u64(own + c.team)? } else { 0 };
        let (club_uid, club) = self.club_of_team(team);
        let (parent_uid, parent) = self.club_of_team(parent_team);
        let number = bytes[c.squad_number as usize];
        let until = date(c.expires);
        Ok(Some(LoanDetails {
            club_uid,
            club,
            parent_uid,
            parent,
            from: date(c.signed),
            until,
            squad_number: (number != 255).then_some(number),
            wage: i32_at(c.wage),
            ends: LoanEnd::of(until, self.game_date()),
            recalled: false,
            terms: terms_layout.and_then(|t| {
                LoanTerms::decode(u16_at(t.flags), i32_at(t.option_fee), i32_at(t.monthly_fee), i32_at(t.unused_fee))
            }),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_loan_ends_later_today_or_has_passed() {
        let day = |day: u8| Some(FmDate { year: 2026, month: 9, day });
        assert_eq!(LoanEnd::of(day(18), day(17)), LoanEnd::Later);
        assert_eq!(LoanEnd::of(day(17), day(17)), LoanEnd::Today);
        assert_eq!(LoanEnd::of(day(16), day(17)), LoanEnd::Passed);
        assert_eq!(LoanEnd::of(None, day(17)), LoanEnd::Unknown);
        assert_eq!(LoanEnd::of(day(17), None), LoanEnd::Unknown);
    }

    #[test]
    fn loan_terms_read_as_the_loan_club_tab_shows_them() {
        // Anton Kade, from FC Augsburg to Liverpool on the Steam save: cup matches, no recall, cannot be terminated.
        let kade = LoanTerms::decode(0x1002, 23_245_368, 371_665, 725_477).expect("terms");
        assert!(kade.cup_matches && !kade.against_own_club);
        assert!(!kade.can_be_recalled && !kade.can_be_terminated);
        assert_eq!(
            (kade.option_fee, kade.monthly_fee, kade.unused_fee),
            (Some(23_245_368), Some(371_665), Some(725_477))
        );
        // The most common flags there: 0x106, recall allowed, and no amounts.
        let plain = LoanTerms::decode(0x106, -1, -1, -1).expect("terms");
        assert!(plain.can_be_recalled && plain.can_be_terminated && plain.cup_matches);
        assert_eq!((plain.option_fee, plain.monthly_fee, plain.unused_fee), (None, None, None));
        assert_eq!(plain.flags, 0x106);
        // An amount below -1 is no term.
        assert_eq!(LoanTerms::decode(0x106, -2, -1, -1), None);
    }
}
