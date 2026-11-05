//! What a club's senior squad looks like line by line, and which of its players a scout would let go.
//!
//! The squad is the senior team's list as the game keeps it (see [`crate::Session::club_teams`]): the players who
//! play for it, on loan there too, and not those it has lent out. Each player belongs to the line of the position he
//! plays best; a line counts its players against how many a squad usually carries there. Only reads memory.

use serde::Serialize;

use crate::clubs::ClubSummary;
use crate::details::{POSITIONS, read_player_details};
use crate::players::{PLAYABLE_RATING, PlayerIndex, PlayerSummary};
use crate::scouting::{NOT_FOR_SALE, ScoutError, Standing, days_between, known_value};
use crate::session::Session;
use crate::squad::Loan;

/// The lines of a squad: key, the positions it holds (keys of [`POSITIONS`], the one recommendations start from
/// first), and how many players a squad usually carries there.
const LINES: &[(&str, &[&str], usize)] = &[
    ("gk", &["gk"], 2),
    ("dc", &["dc"], 4),
    ("rightBack", &["dr", "wbr"], 2),
    ("leftBack", &["dl", "wbl"], 2),
    ("dm", &["dm"], 2),
    ("mc", &["mc"], 3),
    ("rightWing", &["amr", "mr"], 2),
    ("leftWing", &["aml", "ml"], 2),
    ("amc", &["amc"], 2),
    ("st", &["st"], 3),
];

/// How a line's numbers look.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DepthStatus {
    /// Nobody plays there.
    Missing,
    /// Fewer than a squad usually carries, even counting the players who can cover.
    Thin,
    Fine,
    /// Two or more players beyond what a squad usually carries.
    Crowded,
}

/// A player of a line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthPlayer {
    pub player: PlayerSummary,
    /// His best rating (1–20) among the line's positions.
    pub rating: u8,
    /// Here on loan from another club.
    pub on_loan: bool,
}

/// One line of the squad.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthLine {
    /// `gk`, `dc`, `rightBack`, `leftBack`, `dm`, `mc`, `rightWing`, `leftWing`, `amc` or `st`.
    pub key: &'static str,
    /// Its positions, the one to ask recommendations for first.
    pub positions: &'static [&'static str],
    /// How many players a squad usually carries there.
    pub target: usize,
    /// The players whose best position is here, best first.
    pub players: Vec<DepthPlayer>,
    /// Players who play here well (rated 15 or more) but best elsewhere, best first.
    pub cover: Vec<DepthPlayer>,
    pub status: DepthStatus,
    /// Its best player is well below the squad's level.
    pub weak: bool,
    /// All its players are 31 or older.
    pub ageing: bool,
}

/// What a scout would do with a player he would let go.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DepartureAction {
    Sell,
    /// Lend him out, to play and grow.
    Loan,
    /// Let him go for nothing: no club would pay much for him.
    Release,
}

/// Why a player could go, with the value it is about.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepartureReason {
    /// `surplus` (the players of his line), `belowLevel` (his ability), `ageing` (his age), `expiring` (days left),
    /// `highWage` (pounds a week), `unhappy` (his reasons to be), `lowMorale` (1–20), `blocked` (his potential),
    /// `listed`.
    pub code: &'static str,
    pub value: Option<i64>,
}

/// A player a scout would let go.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Departure {
    pub player: PlayerSummary,
    pub action: DepartureAction,
    pub reasons: Vec<DepartureReason>,
    /// The more reasons and the stronger, the higher.
    pub priority: u8,
    /// Pounds; a week for the wage. The value is none where the game keeps none or he is not for sale.
    pub value: Option<i32>,
    pub not_for_sale: bool,
    pub wage: Option<i32>,
    /// His line, and where he stands in it (1 is its best).
    pub line: &'static str,
    pub rank: usize,
}

/// The senior squad line by line, and the players a scout would let go.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadReport {
    pub lines: Vec<DepthLine>,
    pub departures: Vec<Departure>,
    /// The average current ability of the squad's best eleven, which "below the squad's level" measures against.
    pub level: u16,
    pub size: usize,
    pub average_age: Option<f32>,
}

/// How a player stands in the squad.
struct Member<'a> {
    player: &'a PlayerSummary,
    on_loan: bool,
    /// His line (index into [`LINES`]) and his rating there.
    line: usize,
    rating: u8,
}

/// The line of the position a player plays best; on a tie, the one listed first.
fn line_of(ratings: &[u8; 15]) -> (usize, u8) {
    let rating = |key: &str| POSITIONS.iter().position(|&p| p == key).map_or(0, |i| ratings[i]);
    let mut best = (0, 0);
    for (i, (_, positions, _)) in LINES.iter().enumerate() {
        let here = positions.iter().map(|&key| rating(key)).max().unwrap_or(0);
        if here > best.1 {
            best = (i, here);
        }
    }
    best
}

/// A player's best rating among a line's positions.
fn rating_in(ratings: &[u8; 15], line: usize) -> u8 {
    LINES[line]
        .1
        .iter()
        .filter_map(|&key| POSITIONS.iter().position(|&p| p == key))
        .map(|i| ratings[i])
        .max()
        .unwrap_or(0)
}

/// How a line's numbers look: its own players, and half of those who can cover it.
fn status(players: usize, cover: usize, target: usize) -> DepthStatus {
    if players == 0 && cover == 0 {
        DepthStatus::Missing
    } else if players + cover / 2 < target {
        DepthStatus::Thin
    } else if players >= target + 2 {
        DepthStatus::Crowded
    } else {
        DepthStatus::Fine
    }
}

/// How many of a line's players a team starts with.
fn starters(target: usize) -> usize {
    target.div_ceil(2)
}

impl Session {
    /// The senior squad of `club` line by line, and the players a scout would let go. Reads the players' contracts.
    pub fn squad_report(&self, club: &ClubSummary, players: &PlayerIndex) -> Result<SquadReport, ScoutError> {
        let teams = self.club_teams(club, players)?;
        let Some(senior) = teams.iter().find(|team| team.index == 0) else {
            return Ok(SquadReport { lines: Vec::new(), departures: Vec::new(), level: 0, size: 0, average_age: None });
        };
        let members: Vec<Member<'_>> = senior
            .players
            .iter()
            .filter(|member| member.plays_here)
            .filter_map(|member| {
                let player = players.get(member.uid)?;
                let (line, rating) = line_of(&player.position_ratings);
                Some(Member { player, on_loan: member.loan == Some(Loan::In), line, rating })
            })
            .collect();

        let mut abilities: Vec<u16> = members.iter().map(|m| m.player.current_ability).collect();
        abilities.sort_unstable_by(|a, b| b.cmp(a));
        let best = &abilities[..abilities.len().min(11)];
        let level = if best.is_empty() {
            0
        } else {
            (best.iter().map(|&a| u32::from(a)).sum::<u32>() / best.len() as u32) as u16
        };
        let ages: Vec<u16> = members.iter().filter_map(|m| m.player.age).collect();
        let average_age =
            (!ages.is_empty()).then(|| ages.iter().map(|&a| f32::from(a)).sum::<f32>() / ages.len() as f32);

        let by_ability = |a: &DepthPlayer, b: &DepthPlayer| {
            b.player.current_ability.cmp(&a.player.current_ability).then(b.rating.cmp(&a.rating))
        };
        let lines: Vec<DepthLine> = LINES
            .iter()
            .enumerate()
            .map(|(i, &(key, positions, target))| {
                let depth =
                    |m: &Member<'_>, rating: u8| DepthPlayer { player: m.player.clone(), rating, on_loan: m.on_loan };
                let mut own: Vec<DepthPlayer> =
                    members.iter().filter(|m| m.line == i).map(|m| depth(m, m.rating)).collect();
                own.sort_by(by_ability);
                let mut cover: Vec<DepthPlayer> = members
                    .iter()
                    .filter(|m| m.line != i)
                    .filter_map(|m| {
                        let rating = rating_in(&m.player.position_ratings, i);
                        (rating >= PLAYABLE_RATING).then(|| depth(m, rating))
                    })
                    .collect();
                cover.sort_by(by_ability);
                let weak = own.first().is_some_and(|best| best.player.current_ability + 15 < level);
                let ageing = !own.is_empty() && own.iter().all(|d| d.player.age.is_some_and(|age| age >= 31));
                DepthLine {
                    key,
                    positions,
                    target,
                    status: status(own.len(), cover.len(), target),
                    players: own,
                    cover,
                    weak,
                    ageing,
                }
            })
            .collect();

        let departures = self.departures(&members, &lines, level);
        Ok(SquadReport { lines, departures, level, size: members.len(), average_age })
    }

    /// The players a scout would let go, most pressing first.
    fn departures(&self, members: &[Member<'_>], lines: &[DepthLine], level: u16) -> Vec<Departure> {
        let today = self.game_date();
        let details: Vec<_> =
            members.iter().map(|m| read_player_details(&self.process, &self.layout, m.player).ok().flatten()).collect();
        // What the best paid quarter of the squad earns at least.
        let mut wages: Vec<i32> =
            details.iter().flatten().filter_map(|d| d.contract.as_ref().map(|c| c.wage)).collect();
        wages.sort_unstable_by(|a, b| b.cmp(a));
        let high_wage = wages.get(wages.len() / 4).copied();

        let mut out = Vec::new();
        for (m, details) in members.iter().zip(&details) {
            if m.on_loan {
                continue;
            }
            let p = m.player;
            let line = &lines[m.line];
            let rank =
                line.players.iter().position(|d| d.player.uid == p.uid).map_or(line.players.len() + 1, |i| i + 1);
            let age = p.age.unwrap_or(25);
            let ability = p.current_ability;
            let room = i32::from(p.potential_ability) - i32::from(ability);
            let contract = details.as_ref().and_then(|d| d.contract.as_ref());
            let wage = contract.map(|c| c.wage);
            // Among the first of his line, or a regular by his contract: a star, an important player, the first-choice
            // goalkeeper or a regular starter (see `Standing`).
            let standing = contract.and_then(|c| Standing::of(c.squad_status));
            let first_choice =
                rank <= starters(line.target) || matches!(standing, Some(Standing::Key | Standing::Regular));

            let mut reasons = Vec::new();
            let mut priority = 0u8;
            let mut add = |code: &'static str, weight: u8, value: Option<i64>| {
                reasons.push(DepartureReason { code, value });
                priority += weight;
            };
            if line.status == DepthStatus::Crowded && rank > line.target {
                add("surplus", 3, Some(line.players.len() as i64));
            }
            let below = ability + 25 < level && age >= 23;
            if below {
                add("belowLevel", 3, Some(i64::from(ability)));
            }
            let ageing = (age >= 32 && !first_choice) || age >= 34;
            if ageing {
                add("ageing", 2, Some(i64::from(age)));
            }
            if let Some(days) = today.zip(p.contract_expires).map(|(today, expires)| days_between(today, expires))
                && days <= 365
                && !first_choice
            {
                add("expiring", 2, Some(days));
            }
            if let (Some(wage), Some(high)) = (wage, high_wage)
                && wage >= high
                && !first_choice
                && ability < level
            {
                add("highWage", 2, Some(i64::from(wage)));
            }
            let unhappy = contract.map_or(0, |c| c.concerns.iter().filter(|concern| concern.ended.is_none()).count());
            if unhappy > 0 {
                add("unhappy", 2, Some(unhappy as i64));
            }
            if let Some(morale) = details.as_ref().map(|d| d.morale)
                && morale <= 6
            {
                add("lowMorale", 1, Some(i64::from(morale)));
            }
            // Young, with room to grow, and beyond the players his line usually carries: he needs games elsewhere.
            let blocked = age <= 21 && room >= 15 && !first_choice && rank > line.target;
            if blocked {
                add("blocked", 2, Some(i64::from(p.potential_ability)));
            }
            // His contract says the club has no use for him: surplus to requirements.
            if standing == Some(Standing::Surplus) {
                add("unwanted", 3, None);
            }
            if p.transfer_listed {
                add("listed", 1, None);
            }
            // A player's mood is for the manager to talk over, not a reason to let him go: unhappiness and low morale
            // only add to the reasons his line, ability, age, contract, wage or listing give. A whole squad can be
            // concerned for a day about one teammate.
            if reasons.iter().all(|reason| matches!(reason.code, "unhappy" | "lowMorale")) {
                continue;
            }
            let worth_little = p.transfer_value.is_none_or(|value| value < 250_000);
            let action = if blocked && !below {
                DepartureAction::Loan
            } else if worth_little && age >= 28 && (below || ageing) {
                DepartureAction::Release
            } else {
                DepartureAction::Sell
            };
            out.push(Departure {
                player: p.clone(),
                action,
                reasons,
                priority,
                value: known_value(p.transfer_value),
                not_for_sale: p.transfer_value == Some(NOT_FOR_SALE),
                wage,
                line: line.key,
                rank,
            });
        }
        out.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.player.current_ability.cmp(&b.player.current_ability)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ratings(pairs: &[(&str, u8)]) -> [u8; 15] {
        let mut out = [1u8; 15];
        for &(key, rating) in pairs {
            out[POSITIONS.iter().position(|&p| p == key).expect("position")] = rating;
        }
        out
    }

    #[test]
    fn a_player_belongs_to_his_best_line() {
        assert_eq!(line_of(&ratings(&[("dr", 20), ("dc", 15)])).0, 2);
        assert_eq!(line_of(&ratings(&[("wbl", 19), ("aml", 14)])).0, 3);
        // On a tie, the line listed first.
        assert_eq!(line_of(&ratings(&[("dc", 20), ("dm", 20)])).0, 1);
        assert_eq!(line_of(&ratings(&[("gk", 20)])), (0, 20));
    }

    #[test]
    fn statuses() {
        assert_eq!(status(0, 0, 2), DepthStatus::Missing);
        assert_eq!(status(1, 1, 2), DepthStatus::Thin);
        assert_eq!(status(1, 2, 2), DepthStatus::Fine);
        assert_eq!(status(4, 0, 2), DepthStatus::Crowded);
        assert_eq!(status(5, 0, 4), DepthStatus::Fine);
    }

    #[test]
    fn every_line_names_real_positions() {
        for (key, positions, target) in LINES {
            assert!(*target > 0, "{key}");
            for position in *positions {
                assert!(POSITIONS.contains(position), "{key}: {position}");
            }
        }
        assert_eq!(starters(3), 2);
        assert_eq!(starters(2), 1);
    }
}
