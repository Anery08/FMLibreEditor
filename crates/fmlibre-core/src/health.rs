//! Checks that the editor reads the running game right, before it writes to it.
//!
//! After an update of the game the editor may still find its data, yet read some of it from the wrong place: a field
//! that moved reads the bytes of another. Each check samples players, staff or clubs and asks whether what the layout
//! reads looks like the game's own data, beyond the range one value has to keep: birth dates people are born on,
//! goalkeepers better at goalkeeping than the rest, contracts that point back at their players. A check that does not
//! pass keeps what it covers from being written ([`Check::of_field`], [`STRUCTURE`]), and an in-game date that does
//! not fit the contracts the game has signed is not used. Only reads memory.

use std::collections::HashMap;
use std::fmt;

use fmlibre_mem::{Process, is_user_pointer};
use serde::Serialize;

use crate::date::FmDate;
use crate::edit::{Entity, Field};
use crate::profile::Layout;
use crate::session::Session;

/// How many players, members of staff and clubs each check looks at, spread evenly over their arrays.
const SAMPLES: u64 = 2_000;

/// Fewer objects than this tell nothing: the check does not pass.
const LEAST_SAMPLED: u64 = 50;

/// What the editor checks before it writes, and what each check keeps from being written when it does not pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Check {
    /// The in-game date is set, and the contracts the game holds were signed before it. Without it the editor shows
    /// no ages and dates no contract.
    GameDate,
    /// Players' birth dates, heights, abilities and reputations hold values people have, and their current ability is
    /// within their potential without being it for most. Guards those fields and the rest of the player's own
    /// (nation, asking price, caps, traits).
    Players,
    /// Position ratings go up to 20, and each player rates 20 where he is natural.
    Positions,
    /// Attributes go up to 100 as stored; goalkeepers rate higher at goalkeeping than the rest, strikers at finishing
    /// and centre-backs at tackling.
    Attributes,
    /// The eight personality ratings go up to 20.
    Personality,
    /// Energy, match sharpness, jadedness and morale stay in the ranges the game keeps them in: no one below 35%
    /// sharpness, and most players fresh.
    LiveValues,
    /// Players' contracts point back at them, and some were signed after the player joined. Guards the contract
    /// fields; with [`Check::Teams`], [`Check::Staff`] and [`Check::Clubs`], every change to the game's lists and
    /// records ([`STRUCTURE`]).
    Contracts,
    /// A player's team belongs to a club and lists him.
    Teams,
    /// Members of staff have birth dates, abilities and attributes in range and contracts that point back at them,
    /// and goalkeeping coaches, physios and scouts are better than others at what their job is about.
    Staff,
    /// A club's senior team points back at the club.
    Clubs,
}

/// The checks a change to the game's lists and records needs (moves, swaps, healing, captains, ties, clauses,
/// retirements): it follows pointers from players, staff and clubs into contracts and teams.
pub const STRUCTURE: [Check; 4] = [Check::Contracts, Check::Teams, Check::Staff, Check::Clubs];

impl Check {
    pub const ALL: [Check; 10] = [
        Check::GameDate,
        Check::Players,
        Check::Positions,
        Check::Attributes,
        Check::Personality,
        Check::LiveValues,
        Check::Contracts,
        Check::Teams,
        Check::Staff,
        Check::Clubs,
    ];

    /// The name of the check in error codes' parameters and in the app: `gameDate`, `liveValues`, ...
    pub fn key(self) -> &'static str {
        match self {
            Check::GameDate => "gameDate",
            Check::Players => "players",
            Check::Positions => "positions",
            Check::Attributes => "attributes",
            Check::Personality => "personality",
            Check::LiveValues => "liveValues",
            Check::Contracts => "contracts",
            Check::Teams => "teams",
            Check::Staff => "staff",
            Check::Clubs => "clubs",
        }
    }

    /// The check that has to pass before `field` is written.
    pub fn of_field(field: &Field) -> Check {
        let key = field.key.as_str();
        match field.entity {
            Entity::Staff => Check::Staff,
            Entity::Club => Check::Clubs,
            Entity::Player if key.starts_with("attribute.") => Check::Attributes,
            Entity::Player if key.starts_with("position.") => Check::Positions,
            Entity::Player if key.starts_with("personality.") => Check::Personality,
            Entity::Player if key.starts_with("contract.") => Check::Contracts,
            Entity::Player if matches!(key, "condition" | "match_sharpness" | "jadedness" | "morale") => {
                Check::LiveValues
            }
            Entity::Player => Check::Players,
        }
    }
}

impl fmt::Display for Check {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Check::GameDate => "the in-game date",
            Check::Players => "the players' own values",
            Check::Positions => "the position ratings",
            Check::Attributes => "the attributes",
            Check::Personality => "the personality ratings",
            Check::LiveValues => "energy, match sharpness, jadedness and morale",
            Check::Contracts => "the contracts",
            Check::Teams => "the teams",
            Check::Staff => "the staff",
            Check::Clubs => "the clubs",
        })
    }
}

/// What one check found: how many of the objects it looked at fit, and whether that is enough.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub check: Check,
    pub passed: bool,
    pub fit: u64,
    pub sampled: u64,
    /// What else it measured, in a few words, for the probe.
    #[serde(skip)]
    pub note: String,
}

/// What the checks found on the running game.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub results: Vec<CheckResult>,
}

impl Health {
    /// Whether `check` passed.
    pub fn passed(&self, check: Check) -> bool {
        self.results.iter().any(|result| result.check == check && result.passed)
    }

    /// The checks that did not pass, in [`Check::ALL`] order.
    pub fn failed(&self) -> Vec<Check> {
        self.results.iter().filter(|result| !result.passed).map(|result| result.check).collect()
    }
}

/// Why the editor will not write a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lock {
    /// The game is a build the editor has no profile for, and editing it was not allowed.
    UnknownBuild,
    /// A check the change needs did not pass on this game.
    Failed(Check),
}

impl Lock {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Lock::UnknownBuild => "guard.unknownBuild",
            Lock::Failed(_) => "guard.failed",
        }
    }

    pub(crate) fn params(self) -> Vec<(&'static str, String)> {
        match self {
            Lock::UnknownBuild => Vec::new(),
            Lock::Failed(check) => vec![("check", check.key().to_owned())],
        }
    }
}

impl fmt::Display for Lock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Lock::UnknownBuild => f.write_str(
                "the editor has not been checked with this version of the game, so it does not write to it unless \
                 editing is allowed",
            ),
            Lock::Failed(check) => {
                write!(f, "{check} did not check out in this version of the game, so the editor leaves them unchanged")
            }
        }
    }
}

/// How many of the objects a check looked at fit.
#[derive(Debug, Default, Clone, Copy)]
struct Tally {
    fit: u64,
    sampled: u64,
}

impl Tally {
    fn add(&mut self, fits: bool) {
        self.sampled += 1;
        self.fit += u64::from(fits);
    }

    /// Whether enough were looked at and at least `least` of them (a share) fit.
    fn holds(self, least: f64) -> bool {
        self.sampled >= LEAST_SAMPLED && self.fit as f64 >= least * self.sampled as f64
    }

    fn result(self, check: Check, least: f64, note: String) -> CheckResult {
        CheckResult { check, passed: self.holds(least), fit: self.fit, sampled: self.sampled, note }
    }
}

/// The mean of the values added, and how many there were.
#[derive(Debug, Default, Clone, Copy)]
struct Mean {
    sum: f64,
    count: u64,
}

impl Mean {
    fn add(&mut self, value: f64) {
        self.sum += value;
        self.count += 1;
    }

    fn value(self) -> Option<f64> {
        (self.count > 0).then(|| self.sum / self.count as f64)
    }
}

/// `count` indices spread evenly over an array of `len` elements, at most [`SAMPLES`] of them.
fn sample(len: u64) -> impl Iterator<Item = u64> {
    let count = len.min(SAMPLES);
    (0..count).map(move |k| k * len / count)
}

/// The elements [`sample`] picks of the array of `len` pointers at `begin`.
fn sampled_objects(process: &Process, begin: u64, len: u64) -> Vec<u64> {
    sample(len)
        .filter_map(|index| process.read_u64(begin + index * 8).ok())
        .filter(|&object| is_user_pointer(object))
        .collect()
}

/// A player as the checks read him: his object's bytes, with the person block where his class keeps it.
struct SampledPlayer {
    object: u64,
    shift: u64,
    bytes: Vec<u8>,
}

impl SampledPlayer {
    fn u8(&self, layout: &Layout, offset: u64) -> u8 {
        self.bytes[layout.player.at(offset, self.shift) as usize]
    }

    fn u16(&self, layout: &Layout, offset: u64) -> u16 {
        let at = layout.player.at(offset, self.shift) as usize;
        u16::from_le_bytes([self.bytes[at], self.bytes[at + 1]])
    }

    fn u64(&self, layout: &Layout, offset: u64) -> u64 {
        let at = layout.player.at(offset, self.shift) as usize;
        u64::from_le_bytes(self.bytes[at..at + 8].try_into().expect("8 bytes"))
    }

    fn date(&self, layout: &Layout, offset: u64) -> Option<FmDate> {
        FmDate::from_raw(self.u16(layout, offset), self.u16(layout, offset + 2))
    }

    fn positions(&self, layout: &Layout) -> [u8; 15] {
        std::array::from_fn(|i| self.u8(layout, layout.player.positions + i as u64))
    }
}

/// Reads the players [`sample`] picks.
fn sample_players(session: &Session) -> Vec<SampledPlayer> {
    let Some(array) = session.arrays.players.as_ref() else {
        return Vec::new();
    };
    let Ok((begin, len)) = array.locate(&session.process, &session.plugin) else {
        return Vec::new();
    };
    let (process, p) = (&session.process, &session.layout.player);
    let mut shifts: HashMap<u64, u64> = HashMap::new();
    sampled_objects(process, begin, len)
        .into_iter()
        .filter_map(|object| {
            let mut bytes = process.read_bytes(object, p.end() as usize).ok()?;
            let class = u64::from_le_bytes(bytes[..8].try_into().expect("8 bytes"));
            let shift = *shifts.entry(class).or_insert_with(|| crate::players::person_shift(process, p, object));
            if shift > 0 {
                bytes = process.read_bytes(object, (p.end() + shift) as usize).ok()?;
            }
            Some(SampledPlayer { object, shift, bytes })
        })
        .collect()
}

/// Index of the goalkeeper's, the centre-back's and the striker's rating in [`crate::POSITIONS`].
const GK: usize = 0;
const DC: usize = 3;
const ST: usize = 12;

/// The attributes only goalkeepers are good at.
const GOALKEEPING: [&str; 9] = [
    "aerial_reach",
    "command_of_area",
    "communication",
    "handling",
    "kicking",
    "one_on_ones",
    "punching",
    "reflexes",
    "rushing_out",
];

/// How much higher, as stored (0–100), goalkeepers rate on average at goalkeeping than outfield players, strikers
/// at finishing than centre-backs, and centre-backs at tackling than strikers, for the attributes to be read right;
/// and among staff, goalkeeping coaches at goalkeeping, physios at physiotherapy and scouts at judging potential. On
/// the Game Pass test save (9 September 2026) these gaps were 42, 37 and 36, and 39, 51 and 30. With the players'
/// attributes read one byte off, the first three were 23, -4 and -5.
const GAP: f64 = 20.0;

/// Runs every check on the running game.
pub(crate) fn check(session: &Session, date: Option<FmDate>) -> Health {
    let layout = &session.layout;
    let process = &session.process;
    let players = sample_players(session);

    let mut own = Tally::default();
    // Current ability within the potential, and the two not the same for most: a potential read in place of the
    // current ability would equal it.
    let mut within = Tally::default();
    let mut same = Tally::default();
    let mut positions = Tally::default();
    let mut natural = Tally::default();
    let mut attributes = Tally::default();
    let mut personality = Tally::default();
    let mut live = Tally::default();
    // The game keeps match sharpness at 35% or above, and most players are fresh on any day.
    let mut sharp = Tally::default();
    let mut fresh = Tally::default();
    let mut contracts = Tally::default();
    // Contracts signed after the player joined: renewals, which a date read in place of the other cannot show.
    let mut renewed = Tally::default();
    let mut teams = Tally::default();
    // Goalkeeping by goalkeepers and by the rest; finishing and tackling by strikers and by centre-backs.
    let (mut keepers, mut outfield) = (Mean::default(), Mean::default());
    let (mut striker_finishing, mut defender_finishing) = (Mean::default(), Mean::default());
    let (mut striker_tackling, mut defender_tackling) = (Mean::default(), Mean::default());
    // The dates contracts were signed and players joined their clubs: none after the in-game date.
    let mut signed: Vec<FmDate> = Vec::new();

    let p = &layout.player;
    let attribute = |player: &SampledPlayer, key: &str| p.attributes.get(key).map(|&at| player.u8(layout, at));
    for player in &players {
        let born = player.date(layout, p.date_of_birth).is_some_and(|born| (1900..=2020).contains(&born.year));
        let height = (140..=220).contains(&player.u16(layout, p.height));
        let ability = (1..=200).contains(&player.u16(layout, p.current_ability));
        let potential = player.u16(layout, p.potential_ability) as i16;
        let potential = potential != 0 && (-200..=200).contains(&potential);
        let reputation = [p.home_reputation, p.current_reputation, p.world_reputation]
            .iter()
            .all(|&at| player.u16(layout, at) <= 10_000);
        own.add(born && height && ability && potential && reputation);
        let (current, potential) = (player.u16(layout, p.current_ability), player.u16(layout, p.potential_ability));
        if (1..=200).contains(&potential) {
            within.add(current <= potential);
            same.add(current == potential);
        }

        let ratings = player.positions(layout);
        positions.add(ratings.iter().all(|&rating| rating <= 20));
        natural.add(ratings.contains(&20));

        attributes.add(p.attributes.values().all(|&at| player.u8(layout, at) <= 100));
        let goalkeeping: Vec<u8> = GOALKEEPING.iter().filter_map(|key| attribute(player, key)).collect();
        let goalkeeping = goalkeeping.iter().map(|&v| f64::from(v)).sum::<f64>() / goalkeeping.len().max(1) as f64;
        if ratings[GK] == 20 {
            keepers.add(goalkeeping);
        } else if ratings[GK] <= 5 {
            outfield.add(goalkeeping);
        }
        let (finishing, tackling) = (attribute(player, "finishing"), attribute(player, "tackling"));
        if let (Some(finishing), Some(tackling)) = (finishing, tackling) {
            if ratings[ST] == 20 && ratings[DC] <= 10 {
                striker_finishing.add(f64::from(finishing));
                striker_tackling.add(f64::from(tackling));
            } else if ratings[DC] == 20 && ratings[ST] <= 10 {
                defender_finishing.add(f64::from(finishing));
                defender_tackling.add(f64::from(tackling));
            }
        }

        personality.add((0..crate::PERSONALITY.len() as u64).all(|i| player.u8(layout, p.personality + i) <= 20));

        let jadedness = player.u16(layout, p.jadedness) as i16;
        let (condition, sharpness) = (player.u16(layout, p.condition), player.u16(layout, p.match_sharpness));
        live.add(
            condition <= 10_000
                && sharpness <= 10_000
                && (-500..=10_000).contains(&jadedness)
                && player.u8(layout, p.morale) <= 20,
        );
        sharp.add(sharpness >= 3_500);
        fresh.add(condition >= 5_000);

        // His contract, when he has one, points back at him; and its dates.
        let contract = player.u64(layout, p.contract);
        if is_user_pointer(contract) {
            let fits = contract_fits(process, layout, contract, player.object + p.identity() + player.shift);
            contracts.add(fits.is_some());
            if let Some((signing, joining)) = fits {
                if let (Some(signing), Some(joining)) = (signing, joining) {
                    renewed.add(signing > joining);
                }
                signed.extend([signing, joining].into_iter().flatten());
            }
        }

        // His team belongs to a club and lists him.
        let team = player.u64(layout, p.team);
        if is_user_pointer(team) {
            teams.add(team_lists(process, layout, team, player.object));
        }
    }

    let gap = |high: Mean, low: Mean| high.value().zip(low.value()).map(|(high, low)| high - low);
    let gaps =
        [gap(keepers, outfield), gap(striker_finishing, defender_finishing), gap(defender_tackling, striker_tackling)];
    let shown = |gap: Option<f64>| gap.map_or_else(|| "-".to_owned(), |gap| format!("{gap:.0}"));
    let signature = gaps.iter().all(|gap| gap.is_some_and(|gap| gap >= GAP));

    let (date_holds, date_note) = date_fits(date, &signed);
    let staff = check_staff(session);
    let clubs = check_clubs(session);

    let mut attributes = attributes.result(Check::Attributes, 0.99, String::new());
    attributes.passed &= signature;
    attributes.note = format!(
        "goalkeeping gap {}, finishing gap {}, tackling gap {} (at least {GAP:.0} each)",
        shown(gaps[0]),
        shown(gaps[1]),
        shown(gaps[2])
    );
    let mut positions = positions.result(Check::Positions, 0.99, String::new());
    positions.passed &= natural.holds(0.95);
    positions.note = format!("{} of {} rate 20 somewhere", natural.fit, natural.sampled);
    let mut own = own.result(Check::Players, 0.97, String::new());
    own.passed &= within.holds(0.95) && same.fit * 2 <= same.sampled;
    own.note = format!("{} of {} within their potential, {} of them at it", within.fit, within.sampled, same.fit);
    let mut live = live.result(Check::LiveValues, 0.99, String::new());
    live.passed &= sharp.holds(0.99) && fresh.holds(0.6);
    live.note =
        format!("{} of {} at 35% sharpness or more, {} at 50% energy or more", sharp.fit, sharp.sampled, fresh.fit);
    let mut contracts = contracts.result(Check::Contracts, 0.95, String::new());
    contracts.passed &= renewed.sampled >= LEAST_SAMPLED && renewed.fit * 20 >= renewed.sampled;
    contracts.note = format!("{} of {} signed after the player joined", renewed.fit, renewed.sampled);

    Health {
        results: vec![
            CheckResult {
                check: Check::GameDate,
                passed: date_holds,
                fit: signed.iter().filter(|&&day| date.is_some_and(|date| day <= date)).count() as u64,
                sampled: signed.len() as u64,
                note: date_note,
            },
            own,
            positions,
            attributes,
            personality.result(Check::Personality, 0.99, String::new()),
            live,
            contracts,
            teams.result(Check::Teams, 0.95, String::new()),
            staff,
            clubs,
        ],
    }
}

/// Whether the contract at `contract` points back at the identity block at `owner`; if so, the date it was signed and
/// the date the player joined, where they are set.
fn contract_fits(
    process: &Process,
    layout: &Layout,
    contract: u64,
    owner: u64,
) -> Option<(Option<FmDate>, Option<FmDate>)> {
    let c = &layout.contract;
    let bytes = process.read_bytes(contract, c.end() as usize).ok()?;
    let u16_at = |at: u64| u16::from_le_bytes([bytes[at as usize], bytes[at as usize + 1]]);
    let u64_at = |at: u64| u64::from_le_bytes(bytes[at as usize..at as usize + 8].try_into().expect("8 bytes"));
    if u64_at(c.owner) != owner {
        return None;
    }
    let date = |at: u64| FmDate::from_raw(u16_at(at), u16_at(at + 2));
    Some((date(c.signed), date(c.joined)))
}

/// Whether `team` belongs to a club with a UID and its list of players holds `player`.
fn team_lists(process: &Process, layout: &Layout, team: u64, player: u64) -> bool {
    let club = process.read_u64(team + layout.team.club).unwrap_or(0);
    if !is_user_pointer(club) || process.read_u32(club + layout.club.uid).unwrap_or(0) == 0 {
        return false;
    }
    let Ok(header) = process.read_bytes(team + layout.team.players, 16) else {
        return false;
    };
    let begin = u64::from_le_bytes(header[..8].try_into().expect("8 bytes"));
    let end = u64::from_le_bytes(header[8..].try_into().expect("8 bytes"));
    if !is_user_pointer(begin) || end <= begin || end - begin > 8 * 5_000 || !(end - begin).is_multiple_of(8) {
        return false;
    }
    process
        .read_bytes(begin, (end - begin) as usize)
        .is_ok_and(|list| list.as_chunks::<8>().0.iter().any(|slot| u64::from_le_bytes(*slot) == player))
}

/// Whether `date`, the in-game date read, fits the contracts sampled: set, and no earlier than nearly every date
/// they were signed or their players joined, and the latest of those not long before it. A date read from the wrong
/// place passes neither way: an unset or old one comes before many contracts, a later one long after the last.
fn date_fits(date: Option<FmDate>, signed: &[FmDate]) -> (bool, String) {
    let Some(date) = date else {
        return (false, "no date set".to_owned());
    };
    let after = signed.iter().filter(|&&day| day > date).count();
    let Some(&latest) = signed.iter().filter(|&&day| day <= date).max() else {
        return (false, format!("{} contract dates, none before it", signed.len()));
    };
    let days = days_between(latest, date);
    let note = format!("{after} of {} contract dates after it; the latest before it {days} days earlier", signed.len());
    let fits = signed.len() as u64 >= LEAST_SAMPLED && after * 100 <= signed.len() && days <= 366;
    (fits, note)
}

/// Days from `from` to `to`.
fn days_between(from: FmDate, to: FmDate) -> i64 {
    let day = |date: FmDate| {
        let years = i64::from(date.year) - 1;
        years * 365 + years / 4 - years / 100 + years / 400 + i64::from(date.day_of_year())
    };
    day(to) - day(from)
}

/// Members of staff: birth dates, abilities, attributes and ratings in range, and contracts that point back at them.
fn check_staff(session: &Session) -> CheckResult {
    let mut tally = Tally::default();
    let mut contracts = Tally::default();
    // Goalkeeping by goalkeeping coaches and by other coaches, physiotherapy by physios and by coaches, judging
    // potential by scouts and by physios.
    let (mut keeper_coaches, mut coaches_goalkeeping) = (Mean::default(), Mean::default());
    let (mut physios_physiotherapy, mut coaches_physiotherapy) = (Mean::default(), Mean::default());
    let (mut scouts_judging, mut physios_judging) = (Mean::default(), Mean::default());
    let (process, layout) = (&session.process, &session.layout);
    let s = &layout.staff;
    let objects = session
        .arrays
        .staff
        .as_ref()
        .and_then(|array| array.locate(process, &session.plugin).ok())
        .map(|(begin, len)| sampled_objects(process, begin, len))
        .unwrap_or_default();
    let mut shifts: HashMap<u64, u64> = HashMap::new();
    for object in objects {
        let Ok(head) = process.read_bytes(object, 8) else {
            continue;
        };
        let class = u64::from_le_bytes(head[..8].try_into().expect("8 bytes"));
        let shift = *shifts.entry(class).or_insert_with(|| crate::staff::person_shift(process, s, object));
        let Ok(bytes) = process.read_bytes(object, (s.end() + shift) as usize) else {
            continue;
        };
        let at = |offset: u64| s.at(offset, shift) as usize;
        let u16_at = |offset: u64| u16::from_le_bytes([bytes[at(offset)], bytes[at(offset) + 1]]);
        let born = FmDate::from_raw(u16_at(s.date_of_birth), u16_at(s.date_of_birth + 2));
        let born = born.is_none_or(|born| (1900..=2020).contains(&born.year));
        let ability = u16_at(s.current_ability) <= 200 && (-200..=200).contains(&(u16_at(s.potential_ability) as i16));
        let reputation = [s.home_reputation, s.current_reputation, s.world_reputation]
            .iter()
            .all(|&offset| u16_at(offset) <= 10_000);
        let attributes = s.attributes.values().all(|&offset| bytes[at(offset)] <= 100)
            && s.ratings.values().all(|&offset| bytes[at(offset)] <= 20)
            && (0..crate::PERSONALITY.len() as u64).all(|i| bytes[at(s.personality + i)] <= 20);
        tally.add(born && ability && reputation && attributes);

        let contract = u64::from_le_bytes(bytes[at(s.contract)..at(s.contract) + 8].try_into().expect("8 bytes"));
        if !is_user_pointer(contract) {
            continue;
        }
        let fits = contract_fits(process, layout, contract, object + s.identity() + shift).is_some();
        contracts.add(fits);
        // What his job makes him good at.
        let Some(job) = fits.then(|| process.read_bytes(contract + layout.contract.job, 1).ok()).flatten() else {
            continue;
        };
        let job = if job[0] > 1 && job[0] % 2 == 1 { job[0] - 1 } else { job[0] };
        let attribute = |key: &str| s.attributes.get(key).map(|&offset| f64::from(bytes[at(offset)]));
        let (Some(goalkeeping), Some(physiotherapy), Some(judging)) =
            (attribute("goalkeeping"), attribute("physiotherapy"), attribute("judging_potential"))
        else {
            continue;
        };
        match job {
            GOALKEEPING_COACH => keeper_coaches.add(goalkeeping),
            COACH | ASSISTANT => {
                coaches_goalkeeping.add(goalkeeping);
                coaches_physiotherapy.add(physiotherapy);
            }
            PHYSIO | HEAD_PHYSIO => {
                physios_physiotherapy.add(physiotherapy);
                physios_judging.add(judging);
            }
            SCOUT | CHIEF_SCOUT => scouts_judging.add(judging),
            _ => {}
        }
    }
    let gap = |high: Mean, low: Mean| high.value().zip(low.value()).map(|(high, low)| high - low);
    let gaps = [
        gap(keeper_coaches, coaches_goalkeeping),
        gap(physios_physiotherapy, coaches_physiotherapy),
        gap(scouts_judging, physios_judging),
    ];
    let shown = |gap: Option<f64>| gap.map_or_else(|| "-".to_owned(), |gap| format!("{gap:.0}"));
    let mut result = tally.result(Check::Staff, 0.97, String::new());
    result.passed &= contracts.holds(0.95) && gaps.iter().all(|gap| gap.is_some_and(|gap| gap >= GAP));
    result.note = format!(
        "{} of {} contracts point back; goalkeeping gap {}, physiotherapy gap {}, judging gap {} (at least {GAP:.0})",
        contracts.fit,
        contracts.sampled,
        shown(gaps[0]),
        shown(gaps[1]),
        shown(gaps[2])
    );
    result
}

/// Job codes of contracts (see [`crate::job_name`]), whose members of staff are better at some things than others.
const COACH: u8 = 2;
const PHYSIO: u8 = 12;
const SCOUT: u8 = 14;
const ASSISTANT: u8 = 20;
const GOALKEEPING_COACH: u8 = 34;
const CHIEF_SCOUT: u8 = 44;
const HEAD_PHYSIO: u8 = 50;

/// Clubs whose senior team points back at them, with a reputation in range.
fn check_clubs(session: &Session) -> CheckResult {
    let mut tally = Tally::default();
    let (process, layout) = (&session.process, &session.layout);
    let objects = session
        .arrays
        .clubs
        .as_ref()
        .and_then(|array| array.locate(process, &session.plugin).ok())
        .map(|(begin, len)| sampled_objects(process, begin, len))
        .unwrap_or_default();
    for club in objects {
        let teams = process.read_u64(club + layout.club.teams).unwrap_or(0);
        if !is_user_pointer(teams) {
            continue;
        }
        let senior = process.read_u64(teams).unwrap_or(0);
        let belongs = is_user_pointer(senior) && process.read_u64(senior + layout.team.club).ok() == Some(club);
        let reputation = process
            .read_bytes(senior + layout.team.reputation, 2)
            .is_ok_and(|rep| u16::from_le_bytes([rep[0], rep[1]]) <= 10_000);
        tally.add(belongs && reputation);
    }
    tally.result(Check::Clubs, 0.95, String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_spread_over_the_array() {
        assert_eq!(sample(5).collect::<Vec<_>>(), [0, 1, 2, 3, 4]);
        let picked: Vec<u64> = sample(10_000).collect();
        assert_eq!(picked.len(), SAMPLES as usize);
        assert_eq!((picked[0], picked[1], picked[SAMPLES as usize - 1]), (0, 5, 9_995));
        assert_eq!(sample(0).count(), 0);
    }

    #[test]
    fn a_check_needs_enough_objects() {
        let tally = |fit, sampled| Tally { fit, sampled };
        assert!(tally(97, 100).holds(0.97));
        assert!(!tally(96, 100).holds(0.97));
        assert!(!tally(10, 10).holds(0.5));
        assert!(tally(LEAST_SAMPLED, LEAST_SAMPLED).holds(1.0));
    }

    fn date(year: u16, month: u8, day: u8) -> FmDate {
        FmDate { year, month, day }
    }

    #[test]
    fn the_date_must_come_after_the_contracts() {
        // Contracts signed over the year before 9 September 2026, as on the test save.
        let today = date(2026, 9, 9);
        let signed: Vec<FmDate> = (0..300).map(|k| today.plus_days(-k)).collect();
        assert!(date_fits(Some(today), &signed).0);
        // The date unset, a date from before most contracts, and one long after the last.
        assert!(!date_fits(None, &signed).0);
        assert!(!date_fits(Some(date(2026, 7, 1)), &signed).0);
        assert!(!date_fits(Some(date(2031, 1, 1)), &signed).0);
        // A few contracts dated after it are tolerated, many are not.
        let mut early = signed.clone();
        early.extend((1..=3).map(|k| today.plus_days(k)));
        assert!(date_fits(Some(today), &early).0);
        early.extend((1..=10).map(|k| today.plus_days(k)));
        assert!(!date_fits(Some(today), &early).0);
        // Too few contracts tell nothing.
        assert!(!date_fits(Some(today), &signed[..10]).0);
    }

    #[test]
    fn fields_map_to_their_checks() {
        let layout = crate::profile::layout_for(27).expect("FM27 layout");
        let check = |entity, key: &str| {
            let field = crate::edit::fields(&layout, entity).into_iter().find(|f| f.key == key).expect(key);
            Check::of_field(&field)
        };
        assert_eq!(check(Entity::Player, "attribute.finishing"), Check::Attributes);
        assert_eq!(check(Entity::Player, "position.st"), Check::Positions);
        assert_eq!(check(Entity::Player, "personality.ambition"), Check::Personality);
        assert_eq!(check(Entity::Player, "contract.wage"), Check::Contracts);
        assert_eq!(check(Entity::Player, "morale"), Check::LiveValues);
        assert_eq!(check(Entity::Player, "date_of_birth"), Check::Players);
        assert_eq!(check(Entity::Player, "trait.49"), Check::Players);
        assert_eq!(check(Entity::Staff, "contract.wage"), Check::Staff);
        assert_eq!(check(Entity::Club, "finance.balance"), Check::Clubs);
    }
}
