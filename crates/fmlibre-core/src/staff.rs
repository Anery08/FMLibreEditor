use std::collections::{BTreeMap, HashMap};

use fmlibre_mem::{Module, Process, is_user_pointer};
use serde::Serialize;

use crate::calibrate::ArrayRef;
use crate::date::FmDate;
use crate::details::{Attribute, PERSONALITY, Reputation};
use crate::filter::attribute_keys;
use crate::index::{Listed, SearchIndex};
use crate::players::{club_of_team, club_uid_of_team, is_woman, nation_name, nation_uid};
use crate::profile::{Layout, StaffLayout};
use crate::text::{Memo, display_name, is_name_like, read_fm_string, read_name_entry};

/// Staff attributes grouped the way FM shows them.
pub const STAFF_ATTRIBUTE_GROUPS: &[(&str, &[&str])] = &[
    (
        "coaching",
        &[
            "attacking",
            "defending",
            "fitness",
            "goalkeeping",
            "possession",
            "set_pieces",
            "tactical",
            "technical",
            "working_with_youngsters",
        ],
    ),
    ("mental", &["authority", "determination", "motivating", "people_management"]),
    (
        "knowledge",
        &[
            "data_analysis",
            "judging_ability",
            "judging_potential",
            "judging_staff",
            "negotiating",
            "tactical_knowledge",
        ],
    ),
    ("medical", &["physiotherapy", "sports_science"]),
];

/// English name of an FM job code, as stored in contracts. Coaching jobs of
/// player-coaches use the code plus one.
pub fn job_name(code: u8) -> Option<&'static str> {
    let base = if code > 1 && code % 2 == 1 { code - 1 } else { code };
    Some(match base {
        1 => "Player",
        2 => "Coach",
        4 => "Chairperson",
        6 => "Director",
        // Deco (Barcelona), Julian Ward (Liverpool), Luís Campos (Paris Saint-Germain), as the game names their job.
        10 => "Director of Football",
        // Giuseppe Marotta (Inter) and Florentino Pérez (Real Madrid).
        70 => "President",
        12 => "Physio",
        14 => "Scout",
        16 => "Manager",
        20 => "Assistant Coach",
        22 => "Set Piece Coach",
        26 => "Fitness Coach",
        34 => "Goalkeeping Coach",
        40 => "Head of Sports Science",
        44 => "Chief Scout",
        48 => "Sports Scientist",
        50 => "Head Physio",
        58 => "Recruitment Analyst",
        60 => "Performance Analyst",
        64 => "Head of Youth Development",
        86 => "Loan Manager",
        88 => "Technical Director",
        _ => return None,
    })
}

/// The fields shown in staff lists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffSummary {
    pub uid: u32,
    pub name: String,
    pub full_name: Option<String>,
    pub date_of_birth: Option<FmDate>,
    pub age: Option<u16>,
    pub nation: Option<String>,
    /// The nation's UID, e.g. for its flag.
    pub nation_uid: Option<u32>,
    /// Address of the nation object, which the nation field points at.
    #[serde(skip)]
    pub nation_address: u64,
    /// The employer, from the contract.
    pub club: Option<String>,
    /// The employer's UID, e.g. for its logo.
    pub club_uid: Option<u32>,
    /// FM job code from the contract; see [`job_name`].
    pub job: Option<u8>,
    pub current_ability: u16,
    pub potential_ability: i16,
    /// The manager the player controls in this save.
    pub is_human: bool,
    /// The attributes as FM shows them (1–20), in [`STAFF_ATTRIBUTE_GROUPS`] order, for the list's filters; 0 for one
    /// the layout does not place.
    #[serde(skip)]
    pub attributes: Vec<u8>,
    /// When the contract ends, for the list's filter.
    #[serde(skip)]
    pub contract_expires: Option<FmDate>,
    /// Whether this is a woman, for the list's filter; unknown where the layout does not place the gender flags.
    #[serde(skip)]
    pub woman: Option<bool>,
    #[serde(skip)]
    pub address: u64,
    /// How far this object's identity block is shifted (see [`StaffLayout::identity_shifts`]).
    #[serde(skip)]
    pub shift: u64,
}

impl Listed for StaffSummary {
    fn uid(&self) -> u32 {
        self.uid
    }

    fn names(&self) -> String {
        match &self.full_name {
            Some(full) => format!("{} {full}", self.name),
            None => self.name.clone(),
        }
    }

    fn display_name(&self) -> &str {
        &self.name
    }

    fn rank(&self) -> i32 {
        // The human manager first, then by current ability.
        i32::from(self.current_ability) + if self.is_human { 1000 } else { 0 }
    }
}

pub type StaffIndex = SearchIndex<StaffSummary>;

/// Reads every member of staff; ages are computed for `today`. Only reads memory.
pub fn read_staff(
    process: &Process,
    module: &Module,
    array: &ArrayRef,
    layout: &Layout,
    today: Option<FmDate>,
) -> fmlibre_mem::Result<Vec<StaffSummary>> {
    let s = &layout.staff;
    let c = &layout.contract;
    let (begin, count) = array.locate(process, module)?;
    let pointers = process.read_bytes(begin, (count * 8) as usize)?;
    let plain_len = s.end() as usize;
    let mut buf = Vec::with_capacity(plain_len + s.max_shift() as usize);
    let mut contract = vec![0u8; c.end() as usize];
    // Each attribute's offset, and whether it is stored as FM shows it (a rating) rather than 0–100.
    let attribute_offsets: Vec<Option<(u64, bool)>> = attribute_keys(STAFF_ATTRIBUTE_GROUPS)
        .map(|key| {
            s.attributes.get(key).map(|&offset| (offset, false)).or(s.ratings.get(key).map(|&offset| (offset, true)))
        })
        .collect();

    let mut shifts: HashMap<u64, u64> = HashMap::new();
    let mut names = Memo::default();
    let mut clubs = Memo::default();
    let mut club_uids: HashMap<u64, Option<u32>> = HashMap::new();
    let mut nations = Memo::default();
    let mut nation_uids: HashMap<u64, Option<u32>> = HashMap::new();

    let mut staff = Vec::with_capacity(count as usize);
    for chunk in pointers.as_chunks::<8>().0 {
        let object = u64::from_le_bytes(*chunk);
        if !is_user_pointer(object) {
            continue;
        }
        buf.resize(plain_len, 0);
        if process.read_into(object, &mut buf).is_err() {
            continue;
        }
        let class = u64::from_le_bytes(buf[..8].try_into().expect("8 bytes"));
        let shift = *shifts.entry(class).or_insert_with(|| person_shift(process, s, object));
        if shift > 0 {
            buf.resize(plain_len + shift as usize, 0);
            if process.read_into(object, &mut buf).is_err() {
                continue;
            }
        }

        let u16_at = |offset: usize| u16::from_le_bytes([buf[offset], buf[offset + 1]]);
        let u32_at = |offset: usize| u32::from_le_bytes(buf[offset..offset + 4].try_into().expect("4 bytes"));
        let u64_at = |offset: usize| u64::from_le_bytes(buf[offset..offset + 8].try_into().expect("8 bytes"));
        let at = |offset: u64| s.at(offset, shift) as usize;

        let uid = u32_at(at(s.uid));
        let full_name = read_fm_string(process, u64_at(at(s.full_name)));
        let mut name_part = |offset| names.get(u64_at(at(offset)), |entry| read_name_entry(process, entry));
        let (common, first, last) = (name_part(s.common_name), name_part(s.first_name), name_part(s.last_name));
        let name = display_name(common, first, last, full_name.as_ref(), uid);
        let date_of_birth = FmDate::from_raw(u16_at(at(s.date_of_birth)), u16_at(at(s.date_of_birth) + 2));
        // The human-manager class also holds an account placeholder with no person behind it.
        if shift != 0 && date_of_birth.is_none() {
            continue;
        }
        let nation_ptr = u64_at(at(s.nation));
        let nation = nations.get(nation_ptr, |nation| nation_name(process, layout, nation));
        let nation_uid = *nation_uids.entry(nation_ptr).or_insert_with(|| nation_uid(process, layout, nation_ptr));

        let contract_ptr = u64_at(at(s.contract));
        let (job, club, club_uid, contract_expires) = if is_user_pointer(contract_ptr)
            && process.read_into(contract_ptr, &mut contract).is_ok()
        {
            let team = u64::from_le_bytes(contract[c.team as usize..c.team as usize + 8].try_into().expect("8 bytes"));
            let club = clubs.get(team, |team| club_of_team(process, layout, team));
            let club_uid = *club_uids.entry(team).or_insert_with(|| club_uid_of_team(process, layout, team));
            let contract_u16 =
                |offset: u64| u16::from_le_bytes([contract[offset as usize], contract[offset as usize + 1]]);
            let expires = FmDate::from_raw(contract_u16(c.expires), contract_u16(c.expires + 2));
            (Some(contract[c.job as usize]), club.clone(), club.and(club_uid), expires)
        } else {
            (None, None, None, None)
        };

        staff.push(StaffSummary {
            uid,
            name,
            full_name,
            date_of_birth,
            age: date_of_birth.zip(today).and_then(|(born, today)| born.age_on(today)),
            nation_uid: nation.as_ref().and(nation_uid),
            nation,
            nation_address: nation_ptr,
            club,
            club_uid,
            job,
            current_ability: u16_at(at(s.current_ability)),
            potential_ability: u16_at(at(s.potential_ability)) as i16,
            is_human: shift != 0,
            attributes: attribute_offsets
                .iter()
                .map(|place| match *place {
                    Some((offset, true)) => buf[at(offset)],
                    Some((offset, false)) => Attribute::from_raw(buf[at(offset)]).value,
                    None => 0,
                })
                .collect(),
            contract_expires,
            woman: s.gender.map(|offset| is_woman(buf[at(offset)])),
            address: object,
            shift,
        });
    }
    Ok(staff)
}

/// Finds where `object` keeps its person block: the candidate shift under which most
/// of the name decodes, preferring the smaller shift on a tie.
pub(crate) fn person_shift(process: &Process, s: &StaffLayout, object: u64) -> u64 {
    let named = |text: Option<String>| u32::from(text.is_some_and(|t| is_name_like(&t)));
    let mut best = (0, 0);
    for &shift in &s.person_block_shifts {
        let pointer_at = |offset: u64| process.read_u64(object + s.at(offset, shift)).unwrap_or(0);
        let score = named(read_fm_string(process, pointer_at(s.full_name)))
            + named(read_name_entry(process, pointer_at(s.first_name)))
            + named(read_name_entry(process, pointer_at(s.last_name)))
            + named(read_name_entry(process, pointer_at(s.common_name)));
        if score > best.0 {
            best = (score, shift);
        }
    }
    best.1
}

/// Everything the staff profile shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffDetails {
    #[serde(flatten)]
    pub summary: StaffSummary,
    pub reputation: Reputation,
    /// Personality ratings (1–20) by [`PERSONALITY`] key.
    pub personality: BTreeMap<&'static str, u8>,
    /// Attributes by key. Ratings FM stores as shown have `raw` equal to `value`.
    pub attributes: BTreeMap<String, Attribute>,
    pub contract: Option<StaffContract>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffContract {
    /// Pounds per week.
    pub wage: i32,
    pub signed: Option<FmDate>,
    pub expires: Option<FmDate>,
    pub joined: Option<FmDate>,
    pub job: u8,
}

/// Reads the full profile of `member`. Returns `None` when the object no longer belongs
/// to them. Only reads memory.
pub fn read_staff_details(
    process: &Process,
    layout: &Layout,
    member: &StaffSummary,
) -> fmlibre_mem::Result<Option<StaffDetails>> {
    let s = &layout.staff;
    let shift = member.shift;
    let buf = process.read_bytes(member.address, (s.end() + shift) as usize)?;
    let at = |offset: u64| s.at(offset, shift) as usize;
    let u8_at = |offset: u64| buf[at(offset)];
    let u16_at = |offset: u64| u16::from_le_bytes([buf[at(offset)], buf[at(offset) + 1]]);
    let u32_at = |offset: u64| u32::from_le_bytes(buf[at(offset)..at(offset) + 4].try_into().expect("4 bytes"));
    let u64_at = |offset: u64| u64::from_le_bytes(buf[at(offset)..at(offset) + 8].try_into().expect("8 bytes"));

    if u32_at(s.uid) != member.uid {
        return Ok(None);
    }
    let personality = PERSONALITY.iter().enumerate().map(|(i, &key)| (key, u8_at(s.personality + i as u64))).collect();
    let attributes = s
        .attributes
        .iter()
        .map(|(key, &offset)| (key.clone(), Attribute::from_raw(u8_at(offset))))
        .chain(s.ratings.iter().map(|(key, &offset)| {
            let value = u8_at(offset);
            (key.clone(), Attribute { raw: value, value })
        }))
        .collect();

    Ok(Some(StaffDetails {
        summary: member.clone(),
        reputation: Reputation {
            home: u16_at(s.home_reputation),
            current: u16_at(s.current_reputation),
            world: u16_at(s.world_reputation),
        },
        personality,
        attributes,
        contract: read_staff_contract(process, layout, u64_at(s.contract)),
    }))
}

fn read_staff_contract(process: &Process, layout: &Layout, address: u64) -> Option<StaffContract> {
    if !is_user_pointer(address) {
        return None;
    }
    let c = &layout.contract;
    let buf = process.read_bytes(address, c.end() as usize).ok()?;
    let u16_at = |offset: u64| u16::from_le_bytes([buf[offset as usize], buf[offset as usize + 1]]);
    let date_at = |offset: u64| FmDate::from_raw(u16_at(offset), u16_at(offset + 2));
    Some(StaffContract {
        wage: i32::from_le_bytes(buf[c.wage as usize..c.wage as usize + 4].try_into().expect("4 bytes")),
        signed: date_at(c.signed),
        expires: date_at(c.expires),
        joined: date_at(c.joined),
        job: buf[c.job as usize],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_names() {
        assert_eq!(job_name(16), Some("Manager"));
        assert_eq!(job_name(35), Some("Goalkeeping Coach")); // player-coach variant
        assert_eq!(job_name(1), Some("Player"));
        assert_eq!(job_name(3), Some("Coach"));
        assert_eq!(job_name(7), Some("Director"));
        assert_eq!(job_name(10), Some("Director of Football"));
        assert_eq!(job_name(255), None);
    }

    #[test]
    fn staff_groups_cover_the_layout() {
        let layout = crate::layout_for(27).expect("FM27 layout");
        let mut grouped: Vec<&str> = STAFF_ATTRIBUTE_GROUPS.iter().flat_map(|(_, keys)| keys.iter().copied()).collect();
        grouped.sort_unstable();
        let mut mapped: Vec<&str> =
            layout.staff.attributes.keys().chain(layout.staff.ratings.keys()).map(String::as_str).collect();
        mapped.sort_unstable();
        assert_eq!(grouped, mapped);
    }
}
