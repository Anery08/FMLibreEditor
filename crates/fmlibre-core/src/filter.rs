use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::clubs::ClubSummary;
use crate::date::FmDate;
use crate::details::{ATTRIBUTE_GROUPS, POSITIONS};
use crate::players::{PLAYABLE_RATING, PlayerSummary};
use crate::staff::{STAFF_ATTRIBUTE_GROUPS, StaffSummary};
use crate::text::fold;

/// The attribute keys of `groups`, group after group: the order of the summaries' `attributes`.
pub(crate) fn attribute_keys(
    groups: &'static [(&'static str, &'static [&'static str])],
) -> impl Iterator<Item = &'static str> {
    groups.iter().flat_map(|(_, keys)| keys.iter().copied())
}

/// Where each attribute sits in [`PlayerSummary::attributes`] and in [`StaffSummary::attributes`].
static PLAYER_ATTRIBUTES: LazyLock<HashMap<&'static str, usize>> =
    LazyLock::new(|| attribute_keys(ATTRIBUTE_GROUPS).enumerate().map(|(i, key)| (key, i)).collect());
static STAFF_ATTRIBUTES: LazyLock<HashMap<&'static str, usize>> =
    LazyLock::new(|| attribute_keys(STAFF_ATTRIBUTE_GROUPS).enumerate().map(|(i, key)| (key, i)).collect());

/// Where the attribute `key` sits in [`PlayerSummary::attributes`].
pub(crate) fn player_attribute(key: &str) -> Option<usize> {
    PLAYER_ATTRIBUTES.get(key).copied()
}

/// Where the attribute `key` sits in [`StaffSummary::attributes`].
pub(crate) fn staff_attribute(key: &str) -> Option<usize> {
    STAFF_ATTRIBUTES.get(key).copied()
}

/// A bound on one attribute as FM shows it (1–20): at least `min` and at most `max`, either of which may be unset.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttributeBound {
    /// An attribute key of the list's entity, e.g. "finishing" for players or "tactical" for staff.
    pub key: String,
    pub min: Option<u8>,
    pub max: Option<u8>,
}

impl AttributeBound {
    /// Whether `values`, a summary's attributes, keep to the bound. An attribute the entity does not have, or one the
    /// game's layout does not place (0), keeps to no bound: a mass edit must never widen to everyone over it.
    fn holds(&self, index: &HashMap<&'static str, usize>, values: &[u8]) -> bool {
        match index.get(self.key.as_str()).and_then(|&i| values.get(i)) {
            Some(&value) if value > 0 => {
                self.min.is_none_or(|min| value >= min) && self.max.is_none_or(|max| value <= max)
            }
            _ => false,
        }
    }
}

/// Filters the player list applies on top of a name search. Unset fields match everyone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerFilter {
    /// A [`POSITIONS`] key; matches players rated [`PLAYABLE_RATING`] or more there.
    pub position: Option<String>,
    pub min_age: Option<u16>,
    pub max_age: Option<u16>,
    pub min_current_ability: Option<u16>,
    pub min_potential_ability: Option<i16>,
    /// Part of the nation's name, accents and case ignored.
    pub nation: Option<String>,
    /// Part of the club's name, accents and case ignored.
    pub club: Option<String>,
    /// Only players of the club with this UID, e.g. those a player can swap with.
    pub club_uid: Option<u32>,
    /// Only players without a club.
    pub free_agents: bool,
    /// Only players whose contract ends on or before this date.
    pub contract_expires_by: Option<FmDate>,
    /// Only players their club has put on the transfer list, and on the loan list.
    pub transfer_listed: bool,
    pub loan_listed: bool,
    /// `Some(true)` for women only, `Some(false)` for men only. Whom the layout cannot tell apart matches neither.
    pub women: Option<bool>,
    /// Bounds on attributes, every one of which must hold.
    pub attributes: Vec<AttributeBound>,
}

impl PlayerFilter {
    pub fn matches(&self, p: &PlayerSummary) -> bool {
        let position = match self.position.as_deref() {
            Some(key) => {
                POSITIONS.iter().position(|&k| k == key).is_some_and(|i| p.position_ratings[i] >= PLAYABLE_RATING)
            }
            None => true,
        };
        position
            && self.min_age.is_none_or(|min| p.age.is_some_and(|age| age >= min))
            && self.max_age.is_none_or(|max| p.age.is_some_and(|age| age <= max))
            && self.min_current_ability.is_none_or(|min| p.current_ability >= min)
            && self.min_potential_ability.is_none_or(|min| p.potential_ability >= min)
            && contains(p.nation.as_deref(), self.nation.as_deref())
            && contains(p.club.as_deref(), self.club.as_deref())
            && self.club_uid.is_none_or(|uid| p.club_uid == Some(uid))
            && (!self.free_agents || p.club.is_none())
            && self.contract_expires_by.is_none_or(|by| p.contract_expires.is_some_and(|end| end <= by))
            && (!self.transfer_listed || p.transfer_listed)
            && (!self.loan_listed || p.loan_listed)
            && self.women.is_none_or(|women| p.woman == Some(women))
            && self.attributes.iter().all(|bound| bound.holds(&PLAYER_ATTRIBUTES, &p.attributes))
    }
}

/// Whether `text` contains `needle`, ignoring accents and case; an empty needle matches anything.
fn contains(text: Option<&str>, needle: Option<&str>) -> bool {
    match needle.map(str::trim).filter(|n| !n.is_empty()) {
        Some(needle) => text.is_some_and(|text| fold(text).contains(&fold(needle))),
        None => true,
    }
}

/// Columns the player list can be sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayerSort {
    #[default]
    CurrentAbility,
    PotentialAbility,
    Age,
    Name,
    Nation,
    Club,
    ContractExpires,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerOrder {
    pub by: PlayerSort,
    pub ascending: bool,
}

/// Sorts `players` by `order`; unknown values go last either way. Text compares without
/// accents or case. The sort is stable: equal players keep their order, which after a
/// search is best first.
pub fn sort_players(players: &mut [&PlayerSummary], order: PlayerOrder) {
    sort_rows(players, order.ascending, |p| match order.by {
        PlayerSort::CurrentAbility => Some(SortKey::Number(p.current_ability.into())),
        PlayerSort::PotentialAbility => Some(SortKey::Number(p.potential_ability.into())),
        PlayerSort::Age => p.age.map(|age| SortKey::Number(age.into())),
        PlayerSort::Name => Some(SortKey::Text(&p.name)),
        PlayerSort::Nation => p.nation.as_deref().map(SortKey::Text),
        PlayerSort::Club => p.club.as_deref().map(SortKey::Text),
        PlayerSort::ContractExpires => p.contract_expires.map(|end| SortKey::Number(end.to_number())),
    });
}

/// What a row of a list is sorted by: a number, or a text, which compares without accents or case.
enum SortKey<'a> {
    Number(i64),
    Text(&'a str),
}

/// Sorts `rows` by what `key` gives each, the lowest first when `ascending`; the rows it gives nothing for go last
/// either way. The sort is stable: equal rows keep their order.
fn sort_rows<'a, T>(rows: &mut [&'a T], ascending: bool, key: impl Fn(&'a T) -> Option<SortKey<'a>>) {
    /// A key as it is compared.
    #[derive(PartialEq, Eq, PartialOrd, Ord)]
    enum Compared {
        Number(i64),
        Text(String),
    }
    // Fold each distinct text once rather than on every comparison.
    let mut folded: HashMap<&str, String> = HashMap::new();
    let mut keyed: Vec<(Option<Compared>, &'a T)> = rows
        .iter()
        .map(|&row| {
            let compared = key(row).map(|key| match key {
                SortKey::Number(number) => Compared::Number(number),
                SortKey::Text(text) => Compared::Text(folded.entry(text).or_insert_with(|| fold(text)).clone()),
            });
            (compared, row)
        })
        .collect();
    keyed.sort_by(|(a, _), (b, _)| match (a, b) {
        (Some(a), Some(b)) if ascending => a.cmp(b),
        (Some(a), Some(b)) => b.cmp(a),
        _ => b.is_some().cmp(&a.is_some()),
    });
    for (slot, (_, row)) in rows.iter_mut().zip(keyed) {
        *slot = row;
    }
}

/// Filters for the staff list, the player list's where they apply to staff. Unset fields match everyone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StaffFilter {
    /// FM job code; a player-coach variant (code + 1) matches too.
    pub job: Option<u8>,
    pub min_age: Option<u16>,
    pub max_age: Option<u16>,
    pub min_current_ability: Option<u16>,
    pub min_potential_ability: Option<i16>,
    /// Part of the nation's name, accents and case ignored.
    pub nation: Option<String>,
    /// Part of the employer's name, accents and case ignored.
    pub club: Option<String>,
    /// Only staff without a contract.
    pub unemployed: bool,
    /// Only contracts ending on or before this date.
    pub contract_expires_by: Option<FmDate>,
    /// `Some(true)` for women only, `Some(false)` for men only. Whom the layout cannot tell apart matches neither.
    pub women: Option<bool>,
    /// Bounds on attributes, every one of which must hold.
    pub attributes: Vec<AttributeBound>,
}

impl StaffFilter {
    pub fn matches(&self, s: &StaffSummary) -> bool {
        self.job.is_none_or(|job| s.job.is_some_and(|code| code == job || code == job + 1))
            && self.min_age.is_none_or(|min| s.age.is_some_and(|age| age >= min))
            && self.max_age.is_none_or(|max| s.age.is_some_and(|age| age <= max))
            && self.min_current_ability.is_none_or(|min| s.current_ability >= min)
            && self.min_potential_ability.is_none_or(|min| s.potential_ability >= min)
            && contains(s.nation.as_deref(), self.nation.as_deref())
            && contains(s.club.as_deref(), self.club.as_deref())
            && (!self.unemployed || s.job.is_none())
            && self.contract_expires_by.is_none_or(|by| s.contract_expires.is_some_and(|end| end <= by))
            && self.women.is_none_or(|women| s.woman == Some(women))
            && self.attributes.iter().all(|bound| bound.holds(&STAFF_ATTRIBUTES, &s.attributes))
    }
}

/// Columns the staff list can be sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StaffSort {
    #[default]
    CurrentAbility,
    PotentialAbility,
    Age,
    Name,
    Nation,
    Club,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StaffOrder {
    pub by: StaffSort,
    pub ascending: bool,
}

/// Sorts `staff` by `order` as [`sort_players`] sorts players. Unlike the search's own order, it does not put the
/// human manager first.
pub fn sort_staff(staff: &mut [&StaffSummary], order: StaffOrder) {
    sort_rows(staff, order.ascending, |s| match order.by {
        StaffSort::CurrentAbility => Some(SortKey::Number(s.current_ability.into())),
        StaffSort::PotentialAbility => Some(SortKey::Number(s.potential_ability.into())),
        StaffSort::Age => s.age.map(|age| SortKey::Number(age.into())),
        StaffSort::Name => Some(SortKey::Text(&s.name)),
        StaffSort::Nation => s.nation.as_deref().map(SortKey::Text),
        StaffSort::Club => s.club.as_deref().map(SortKey::Text),
    });
}

/// Filters for the club list.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClubFilter {
    /// `Some(true)` for women's clubs only, `Some(false)` for men's clubs only.
    pub women: Option<bool>,
}

impl ClubFilter {
    pub fn matches(&self, c: &ClubSummary) -> bool {
        self.women.is_none_or(|women| c.women == women)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(name: &str, age: Option<u16>, ca: u16, club: Option<&str>, st: u8) -> PlayerSummary {
        let mut position_ratings = [1u8; 15];
        position_ratings[12] = st;
        PlayerSummary {
            uid: 1,
            name: name.to_owned(),
            full_name: None,
            date_of_birth: None,
            age,
            nation: Some("Türkiye".to_owned()),
            nation_uid: None,
            club: club.map(str::to_owned),
            club_uid: None,
            positions: Vec::new(),
            contract_expires: Some(FmDate { year: 2027, month: 6, day: 30 }),
            current_ability: ca,
            potential_ability: ca as i16 + 10,
            position_ratings,
            nation_address: 0,
            attributes: vec![10; PLAYER_ATTRIBUTES.len()],
            transfer_listed: false,
            loan_listed: false,
            woman: Some(false),
            address: 0,
            shift: 0,
        }
    }

    fn staff(name: &str, age: Option<u16>, ca: u16, club: Option<&str>, job: Option<u8>) -> StaffSummary {
        StaffSummary {
            uid: 1,
            name: name.to_owned(),
            full_name: None,
            date_of_birth: None,
            age,
            nation: Some("Nederland".to_owned()),
            nation_uid: None,
            nation_address: 0,
            club: club.map(str::to_owned),
            club_uid: None,
            job,
            current_ability: ca,
            potential_ability: ca as i16 + 5,
            is_human: false,
            attributes: vec![10; STAFF_ATTRIBUTES.len()],
            contract_expires: club.map(|_| FmDate { year: 2027, month: 7, day: 31 }),
            woman: Some(false),
            address: 0,
            shift: 0,
        }
    }

    fn bound(key: &str, min: Option<u8>, max: Option<u8>) -> AttributeBound {
        AttributeBound { key: key.to_owned(), min, max }
    }

    #[test]
    fn women_and_men() {
        let mut player = player("Bonmatí", Some(28), 170, Some("Barcelona"), 1);
        let women = PlayerFilter { women: Some(true), ..PlayerFilter::default() };
        let men = PlayerFilter { women: Some(false), ..PlayerFilter::default() };
        assert!(men.matches(&player) && !women.matches(&player));
        player.woman = Some(true);
        assert!(women.matches(&player) && !men.matches(&player));
        // Where the layout cannot tell, the player is neither, and only a list without the filter shows him.
        player.woman = None;
        assert!(!women.matches(&player) && !men.matches(&player));
        assert!(PlayerFilter::default().matches(&player));
    }

    #[test]
    fn staff_filters_combine() {
        let mut coach = staff("Wiegman", Some(56), 160, Some("England Women"), Some(16));
        coach.woman = Some(true);
        let filter = StaffFilter {
            job: Some(16),
            min_age: Some(50),
            max_age: Some(60),
            min_current_ability: Some(150),
            min_potential_ability: Some(160),
            nation: Some("nederland".to_owned()),
            club: Some("england".to_owned()),
            contract_expires_by: Some(FmDate { year: 2027, month: 12, day: 31 }),
            women: Some(true),
            ..StaffFilter::default()
        };
        assert!(filter.matches(&coach));
        assert!(!StaffFilter { women: Some(false), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { max_age: Some(55), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { min_potential_ability: Some(170), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { club: Some("arsenal".to_owned()), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { unemployed: true, ..StaffFilter::default() }.matches(&coach));
        let by = |year| StaffFilter {
            contract_expires_by: Some(FmDate { year, month: 1, day: 1 }),
            ..StaffFilter::default()
        };
        assert!(!by(2027).matches(&coach) && by(2028).matches(&coach));

        // Without a contract: no club and no end, so only the unemployed filter takes him.
        let free = staff("Ten Hag", None, 150, None, None);
        assert!(StaffFilter { unemployed: true, ..StaffFilter::default() }.matches(&free));
        assert!(!by(2030).matches(&free));
        assert!(!StaffFilter { min_age: Some(30), ..StaffFilter::default() }.matches(&free));
        assert!(!StaffFilter { nation: Some("türk".to_owned()), ..StaffFilter::default() }.matches(&free));
    }

    #[test]
    fn attribute_bounds_and_listings() {
        let mut striker = player("Arda", Some(19), 140, Some("Fenerbahçe"), 18);
        striker.attributes[PLAYER_ATTRIBUTES["finishing"]] = 17;
        striker.attributes[PLAYER_ATTRIBUTES["injury_proneness"]] = 4;
        let with = |attributes| PlayerFilter { attributes, ..PlayerFilter::default() };
        assert!(with(vec![bound("finishing", Some(15), None)]).matches(&striker));
        assert!(
            with(vec![bound("finishing", Some(15), None), bound("injury_proneness", None, Some(5))]).matches(&striker)
        );
        assert!(!with(vec![bound("finishing", Some(18), None)]).matches(&striker));
        assert!(!with(vec![bound("injury_proneness", None, Some(3))]).matches(&striker));
        // A key players do not have, or an attribute the layout does not place, matches no one.
        assert!(!with(vec![bound("tactical", None, None)]).matches(&striker));
        striker.attributes[PLAYER_ATTRIBUTES["flair"]] = 0;
        assert!(!with(vec![bound("flair", None, Some(20))]).matches(&striker));

        assert!(!PlayerFilter { transfer_listed: true, ..PlayerFilter::default() }.matches(&striker));
        striker.transfer_listed = true;
        assert!(PlayerFilter { transfer_listed: true, ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { loan_listed: true, ..PlayerFilter::default() }.matches(&striker));
    }

    #[test]
    fn filters_combine() {
        let striker = player("Arda", Some(19), 140, Some("Fenerbahçe"), 18);
        let filter = PlayerFilter {
            position: Some("st".to_owned()),
            max_age: Some(21),
            min_current_ability: Some(120),
            nation: Some("turkiye".to_owned()),
            club: Some("fenerbahce".to_owned()),
            contract_expires_by: Some(FmDate { year: 2027, month: 12, day: 31 }),
            ..PlayerFilter::default()
        };
        assert!(filter.matches(&striker));
        assert!(!PlayerFilter { position: Some("gk".to_owned()), ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { free_agents: true, ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { min_age: Some(20), ..PlayerFilter::default() }.matches(&striker));
        let no_age = player("Unknown", None, 100, None, 1);
        assert!(!PlayerFilter { max_age: Some(30), ..PlayerFilter::default() }.matches(&no_age));
        assert!(PlayerFilter { free_agents: true, ..PlayerFilter::default() }.matches(&no_age));
    }

    #[test]
    fn sorting_puts_unknowns_last() {
        let a = player("A", Some(30), 100, Some("X"), 1);
        let b = player("B", None, 120, Some("Y"), 1);
        let c = player("C", Some(20), 110, None, 1);
        let mut list = vec![&a, &b, &c];
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["C", "A", "B"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: false });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["A", "C", "B"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::CurrentAbility, ascending: false });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["B", "C", "A"]);
    }

    #[test]
    fn staff_sorting() {
        let mut human = staff("Zeki", Some(40), 120, Some("Arsenal"), Some(16));
        human.is_human = true;
        let free = staff("Ünal", None, 160, None, None);
        let coach = staff("Ali", Some(55), 140, Some("Beşiktaş"), Some(2));
        let mut list = vec![&human, &free, &coach];
        let by = |by, ascending| StaffOrder { by, ascending };
        let names = |list: &[&StaffSummary]| list.iter().map(|s| s.name.clone()).collect::<Vec<_>>();
        sort_staff(&mut list, by(StaffSort::Name, true));
        assert_eq!(names(&list), ["Ali", "Ünal", "Zeki"]);
        sort_staff(&mut list, by(StaffSort::CurrentAbility, false));
        assert_eq!(names(&list), ["Ünal", "Ali", "Zeki"]);
        // No age and no club go last, whichever way.
        sort_staff(&mut list, by(StaffSort::Age, false));
        assert_eq!(names(&list), ["Ali", "Zeki", "Ünal"]);
        sort_staff(&mut list, by(StaffSort::Club, true));
        assert_eq!(names(&list), ["Zeki", "Ali", "Ünal"]);
        sort_staff(&mut list, by(StaffSort::Club, false));
        assert_eq!(names(&list), ["Ali", "Zeki", "Ünal"]);
    }

    #[test]
    fn text_sorts_ignore_accents_and_keep_ties_in_order() {
        let ozil = player("Özil", Some(30), 150, Some("Fenerbahçe"), 1);
        let pele = player("pelé", Some(30), 160, Some("Santos"), 1);
        let zico = player("Zico", Some(30), 140, Some("Flamengo"), 1);
        let mut list = vec![&zico, &pele, &ozil];
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Name, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "pelé", "Zico"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Club, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "Zico", "pelé"]);
        // Same age: the incoming order (here by club) decides.
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "Zico", "pelé"]);
    }
}
