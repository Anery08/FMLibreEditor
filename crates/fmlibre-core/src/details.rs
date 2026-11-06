use std::collections::BTreeMap;

use fmlibre_mem::{Process, is_user_pointer};
use serde::Serialize;

use crate::date::FmDate;
use crate::medical::{Ban, Injury};
use crate::players::PlayerSummary;
use crate::profile::Layout;
use crate::relations::{ClubOpinion, Relation};

/// Position ratings in the order FM stores them.
pub const POSITIONS: [&str; 15] =
    ["gk", "sw", "dl", "dc", "dr", "dm", "ml", "mc", "mr", "aml", "amc", "amr", "st", "wbl", "wbr"];

/// Personality ratings in the order FM stores them.
pub const PERSONALITY: [&str; 8] = [
    "adaptability",
    "ambition",
    "loyalty",
    "pressure",
    "professionalism",
    "sportsmanship",
    "temperament",
    "controversy",
];

/// Player attributes grouped the way FM shows them.
pub const ATTRIBUTE_GROUPS: &[(&str, &[&str])] = &[
    (
        "technical",
        &[
            "corners",
            "crossing",
            "dribbling",
            "finishing",
            "first_touch",
            "free_kicks",
            "heading",
            "long_shots",
            "long_throws",
            "marking",
            "passing",
            "penalty_taking",
            "tackling",
            "technique",
        ],
    ),
    (
        "mental",
        &[
            "aggression",
            "anticipation",
            "bravery",
            "composure",
            "concentration",
            "decisions",
            "determination",
            "flair",
            "leadership",
            "off_the_ball",
            "positioning",
            "teamwork",
            "vision",
            "work_rate",
        ],
    ),
    (
        "physical",
        &["acceleration", "agility", "balance", "jumping_reach", "natural_fitness", "pace", "stamina", "strength"],
    ),
    (
        "goalkeeping",
        &[
            "aerial_reach",
            "command_of_area",
            "communication",
            "eccentricity",
            "handling",
            "kicking",
            "one_on_ones",
            "punching",
            "reflexes",
            "rushing_out",
            "throwing",
        ],
    ),
    ("hidden", &["consistency", "dirtiness", "important_matches", "injury_proneness", "versatility"]),
    ("feet", &["left_foot", "right_foot"]),
];

/// Everything the player profile shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDetails {
    #[serde(flatten)]
    pub summary: PlayerSummary,
    pub height_cm: u16,
    /// Asking price in pounds, when the club has set one.
    pub asking_price: Option<i32>,
    pub reputation: Reputation,
    pub international: International,
    /// Position ratings (1–20) by [`POSITIONS`] key; the summary's `positions` lists the playable ones.
    pub position_ratings: BTreeMap<&'static str, u8>,
    /// Personality ratings (1–20) by [`PERSONALITY`] key.
    pub personality: BTreeMap<&'static str, u8>,
    pub attributes: BTreeMap<String, Attribute>,
    pub contract: Option<Contract>,
    /// Energy and match sharpness, 0–10000 (100.00%), jadedness, -500 when rested, and morale,
    /// 1–20, which the game shows as his overall happiness: what the game changes every day.
    pub condition: u16,
    pub match_sharpness: u16,
    pub jadedness: i16,
    pub morale: u8,
    /// His traits (preferred moves), by their bit in the mask: 0 to 63.
    pub traits: Vec<u8>,
    /// Current injuries (see [`crate::Session::injuries`]).
    pub injuries: Vec<Injury>,
    /// Current bans (see [`crate::Session::bans`]).
    pub bans: Vec<Ban>,
    /// Secondary nationalities and homegrown status (see [`crate::Session::relations`]), and how many more his list
    /// has room for.
    pub ties: Vec<Relation>,
    pub tie_room: usize,
    /// The clubs he favours or dislikes, which a tie may take the place of where his list has no room (see
    /// [`crate::Session::club_opinions`]).
    pub club_opinions: Vec<ClubOpinion>,
    /// Whether the editor can read the retirements the game has planned (see
    /// [`crate::Session::planned_retirement`]), and the date he retires on when the game has planned it.
    pub retirement_known: bool,
    pub retires: Option<FmDate>,
    /// How many more clauses the list of his contract has room for (see [`crate::Session::clause_room`]).
    pub clause_room: usize,
    /// Where he is on loan, when he is (see [`crate::Session::loan`]).
    pub loan: Option<crate::loans::LoanDetails>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Reputation {
    pub home: u16,
    pub current: u16,
    pub world: u16,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct International {
    pub caps: u16,
    pub goals: u16,
    pub u21_caps: u8,
    pub u21_goals: u8,
}

/// An attribute as stored (`raw`, 0–100) and as FM shows it (`value`, 1–20).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Attribute {
    pub raw: u8,
    pub value: u8,
}

impl Attribute {
    pub fn from_raw(raw: u8) -> Self {
        Self { raw, value: ((u16::from(raw) + 2) / 5).clamp(1, 20) as u8 }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    /// Pounds per week.
    pub wage: i32,
    pub signed: Option<FmDate>,
    pub expires: Option<FmDate>,
    pub joined: Option<FmDate>,
    pub squad_status: u8,
    /// The kind of contract (see `ContractLayout::contract_type`); none where the layout does not know it.
    pub contract_type: Option<u8>,
    pub squad_number: Option<u8>,
    pub transfer_listed: bool,
    pub loan_listed: bool,
    /// Pounds per week.
    pub loyalty_bonus: i32,
    /// How happy he is, and how happy with his playing time, as FMRTE shows them.
    pub happiness: i8,
    pub playing_time_happiness: i8,
    /// His clauses and bonuses, in the contract's order.
    pub clauses: Vec<Clause>,
    /// His reasons to be unhappy, over ones too, in the order the game keeps them.
    pub concerns: Vec<Concern>,
}

/// One of a player's reasons to be unhappy, as FMRTE lists them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Concern {
    pub started: Option<FmDate>,
    /// When it was over; none while it lasts.
    pub ended: Option<FmDate>,
    /// The game's code for what it is about (see the names in the app's dictionaries).
    pub motive: u16,
    /// 1 concerned, 2 internal; other codes as they are.
    pub kind: u8,
}

/// The most entries a record of reasons to be unhappy is believed to hold; the test save's longest held 6.
pub(crate) const MOST_CONCERNS: u64 = 64;

/// The reasons to be unhappy listed in the record `record` points at; none when there is no record or it does not
/// look like one.
fn read_concerns(process: &Process, record: u64) -> Vec<Concern> {
    if !is_user_pointer(record) {
        return Vec::new();
    }
    let Ok(count) = process.read_u64(record) else {
        return Vec::new();
    };
    if count > MOST_CONCERNS {
        return Vec::new();
    }
    (0..count)
        .filter_map(|i| process.read_u64(record + 8 + 8 * i).ok())
        .filter_map(|entry| process.read_bytes(entry, 28).ok())
        .map(|e| {
            let date = |at: usize| {
                FmDate::from_raw(u16::from_le_bytes([e[at], e[at + 1]]), u16::from_le_bytes([e[at + 2], e[at + 3]]))
            };
            Concern { started: date(0), ended: date(4), motive: u16::from_le_bytes([e[0x16], e[0x17]]), kind: e[0x18] }
        })
        .collect()
}

/// One of a contract's clauses or bonuses: a release clause, an appearance fee, a yearly wage rise...
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clause {
    /// Its place in the contract's list.
    pub index: usize,
    /// The game's code for what it is (see the names in the app's dictionaries).
    pub kind: u16,
    /// Pounds; none for a clause without an amount, such as a yearly wage rise.
    pub amount: Option<u32>,
    /// What it depends on: goals, assists, matches, years or a percentage, by kind; none for most.
    pub condition: Option<u16>,
}

/// The clauses of the contract at `contract`, from its list of 8-byte entries; none when the list does not look
/// like one.
pub(crate) fn read_clauses(process: &Process, layout: &Layout, contract: u64) -> Vec<Clause> {
    const MOST: u64 = 64;
    let at = contract + layout.contract.clauses;
    let (Ok(begin), Ok(end)) = (process.read_u64(at), process.read_u64(at + 8)) else {
        return Vec::new();
    };
    if !is_user_pointer(begin) || end < begin || end - begin > 8 * MOST || (end - begin) % 8 != 0 {
        return Vec::new();
    }
    let Ok(bytes) = process.read_bytes(begin, (end - begin) as usize) else {
        return Vec::new();
    };
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .enumerate()
        .map(|(index, e)| {
            let amount = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
            let condition = u16::from_le_bytes([e[4], e[5]]);
            Clause {
                index,
                kind: u16::from_le_bytes([e[6], e[7]]),
                amount: (amount != u32::MAX).then_some(amount),
                condition: (condition != u16::MAX).then_some(condition),
            }
        })
        .collect()
}

/// Reads the full profile of `player`. Returns `None` when the object at the player's
/// address no longer belongs to that player (e.g. the game moved on). Only reads memory.
pub fn read_player_details(
    process: &Process,
    layout: &Layout,
    player: &PlayerSummary,
) -> fmlibre_mem::Result<Option<PlayerDetails>> {
    let p = &layout.player;
    let shift = player.shift;
    let buf = process.read_bytes(player.address, (p.end() + shift) as usize)?;
    let at = |offset: u64| p.at(offset, shift) as usize;
    let u8_at = |offset: u64| buf[at(offset)];
    let u16_at = |offset: u64| u16::from_le_bytes([buf[at(offset)], buf[at(offset) + 1]]);
    let u32_at = |offset: u64| u32::from_le_bytes(buf[at(offset)..at(offset) + 4].try_into().expect("4 bytes"));
    let u64_at = |offset: u64| u64::from_le_bytes(buf[at(offset)..at(offset) + 8].try_into().expect("8 bytes"));

    if u32_at(p.uid) != player.uid {
        return Ok(None);
    }

    let asking_price = u32_at(p.asking_price) as i32;
    let position_ratings = POSITIONS.iter().enumerate().map(|(i, &key)| (key, u8_at(p.positions + i as u64))).collect();
    let personality = PERSONALITY.iter().enumerate().map(|(i, &key)| (key, u8_at(p.personality + i as u64))).collect();
    let attributes =
        p.attributes.iter().map(|(key, &offset)| (key.clone(), Attribute::from_raw(u8_at(offset)))).collect();

    Ok(Some(PlayerDetails {
        summary: player.clone(),
        height_cm: u16_at(p.height),
        asking_price: (asking_price >= 0).then_some(asking_price),
        reputation: Reputation {
            home: u16_at(p.home_reputation),
            current: u16_at(p.current_reputation),
            world: u16_at(p.world_reputation),
        },
        international: International {
            caps: u16_at(p.international_caps),
            goals: u16_at(p.international_goals),
            u21_caps: u8_at(p.u21_caps),
            u21_goals: u8_at(p.u21_goals),
        },
        position_ratings,
        personality,
        attributes,
        contract: read_contract(process, layout, u64_at(p.contract)),
        condition: u16_at(p.condition),
        match_sharpness: u16_at(p.match_sharpness),
        jadedness: u16_at(p.jadedness) as i16,
        morale: u8_at(p.morale),
        traits: {
            let mask = u64::from_le_bytes(buf[at(p.traits)..at(p.traits) + 8].try_into().expect("8 bytes"));
            (0..64u8).filter(|&n| mask >> n & 1 == 1).collect()
        },
        // The session reads them, as they hang off a record of their own.
        injuries: Vec::new(),
        bans: Vec::new(),
        ties: Vec::new(),
        tie_room: 0,
        club_opinions: Vec::new(),
        retirement_known: false,
        retires: None,
        clause_room: 0,
        loan: None,
    }))
}

fn read_contract(process: &Process, layout: &Layout, address: u64) -> Option<Contract> {
    if !is_user_pointer(address) {
        return None;
    }
    let c = &layout.contract;
    let buf = process.read_bytes(address, c.end() as usize).ok()?;
    let u16_at = |offset: u64| u16::from_le_bytes([buf[offset as usize], buf[offset as usize + 1]]);
    let date_at = |offset: u64| FmDate::from_raw(u16_at(offset), u16_at(offset + 2));
    let listing = buf[c.listing as usize];
    let squad_number = buf[c.squad_number as usize];
    Some(Contract {
        wage: i32::from_le_bytes(buf[c.wage as usize..c.wage as usize + 4].try_into().expect("4 bytes")),
        signed: date_at(c.signed),
        expires: date_at(c.expires),
        joined: date_at(c.joined),
        squad_status: buf[c.squad_status as usize],
        contract_type: c.contract_type.map(|offset| buf[offset as usize]),
        squad_number: (squad_number != 255).then_some(squad_number),
        transfer_listed: listing & 1 != 0,
        loan_listed: listing & 2 != 0,
        loyalty_bonus: i32::from_le_bytes(
            buf[c.loyalty_bonus as usize..c.loyalty_bonus as usize + 4].try_into().expect("4 bytes"),
        ),
        happiness: buf[c.happiness as usize] as i8,
        playing_time_happiness: buf[c.playing_time_happiness as usize] as i8,
        clauses: read_clauses(process, layout, address),
        concerns: read_concerns(
            process,
            u64::from_le_bytes(buf[c.unhappiness as usize..c.unhappiness as usize + 8].try_into().expect("8 bytes")),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attribute_scale() {
        assert_eq!(Attribute::from_raw(100).value, 20); // Messi's left foot
        assert_eq!(Attribute::from_raw(97).value, 19);
        assert_eq!(Attribute::from_raw(28).value, 6);
        assert_eq!(Attribute::from_raw(3).value, 1);
        assert_eq!(Attribute::from_raw(0).value, 1);
    }
}
