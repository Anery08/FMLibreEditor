//! Finding the game's own variables in a build the editor has no profile for.
//!
//! Each build of the game moves its static data. A build profile ([`BuildProfile`]) places the entity arrays, the
//! in-game date and the static pointer to the retirement manager for each build the editor was checked with. For any
//! other build, or where a place a profile names does not check out, the editor looks for them:
//! - the entity arrays, by scanning the game plugin ([`crate::calibrate`]);
//! - the in-game date, among the values in the plugin's writable data that read as dates: the one the game's own data
//!   agrees with, which [`crate::health`] works out from contracts and injuries;
//! - the retirement manager's static, as far from the players' array as another build keeps it, or else by searching
//!   the plugin's writable data for a pointer to the one object of its class (see [`crate::rtti`]).
//!
//! Only reads memory.

use std::collections::{HashMap, HashSet};

use fmlibre_mem::{Region, is_user_pointer, regions};
use serde::Serialize;

use crate::date::FmDate;
use crate::profile::{BuildProfile, PluginFingerprint, built_in_profiles};
use crate::retirement::MANAGER_CLASS;
use crate::session::Session;

/// Bytes read at a time.
const CHUNK: u64 = 1 << 20;

/// The most of the plugin's writable data that is searched. The builds seen so far have about 1 MiB of it, besides
/// the large section that is writable and executable, which holds no such variables and is left out.
const MOST_SEARCHED: u64 = 64 << 20;

/// How the editor found a place in the game plugin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Found {
    /// Where the build profile puts it.
    Profile,
    /// Beside the entity arrays, where the layout puts the in-game date ([`crate::profile::ClusterLayout`]): its place
    /// in the builds before November 2026. Later builds keep the date there too, but only once the game has moved on
    /// a day after a save is loaded.
    BesideArrays,
    /// As far from the players' array as another build keeps it.
    Guessed,
    /// By searching the plugin's writable data.
    Searched,
}

impl Found {
    /// How it was found, in a few words, for the probe.
    pub fn describe(self) -> &'static str {
        match self {
            Found::Profile => "from the build profile",
            Found::BesideArrays => "beside the entity arrays",
            Found::Guessed => "as far from the players' array as in another build",
            Found::Searched => "found by searching",
        }
    }
}

/// A place in the game plugin, by its RVA, and how it was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place {
    pub rva: u64,
    pub found: Found,
}

/// A value in the game plugin that reads as a date the game could be on: where it is, the date it read, and how it
/// was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatePlace {
    pub rva: u64,
    pub date: FmDate,
    pub found: Found,
}

/// The date that 4 bytes hold as the game keeps its date (the day of the year in the low 9 bits of the first `u16`,
/// flags above them, then the year), when it is one a game could be on.
pub(crate) fn game_date_from(raw: u32) -> Option<FmDate> {
    FmDate::from_raw(raw as u16, (raw >> 16) as u16).filter(|date| (2000..=2200).contains(&date.year))
}

/// Calls `visit` with each stretch of the plugin's writable data, not its code, and where the stretch starts.
fn each_stretch(session: &Session, mut visit: impl FnMut(u64, &[u8])) {
    let plugin = &session.plugin;
    let data: Vec<Region> = regions(&session.process, plugin.base, plugin.end())
        .into_iter()
        .filter(|region| region.is_writable() && !region.is_executable())
        .collect();
    let mut searched = 0;
    for region in data {
        let mut offset = 0;
        while offset < region.size && searched < MOST_SEARCHED {
            let len = (region.size - offset).min(CHUNK);
            if let Ok(bytes) = session.process.read_bytes(region.base + offset, len as usize) {
                visit(region.base + offset, &bytes);
            }
            offset += len;
            searched += len;
        }
    }
}

/// Every value in the plugin's writable data, at a multiple of 4 bytes, that reads as a date the game could be on: the
/// in-game date among them, if the game keeps it there. The places the build profile (unless every place is searched
/// for) and the layout name for it are marked as such.
pub fn date_candidates(session: &Session) -> Vec<DatePlace> {
    let base = session.plugin.base;
    let beside = session.arrays.players.as_ref().map(|players| players.pair_rva + session.layout.cluster.current_date);
    let profiled = session.placed_date().filter(|&(_, found)| found == Found::Profile).map(|(rva, _)| rva);
    let mut found = Vec::new();
    each_stretch(session, |start, bytes| {
        for (i, word) in bytes.as_chunks::<4>().0.iter().enumerate() {
            let Some(date) = game_date_from(u32::from_le_bytes(*word)) else {
                continue;
            };
            let rva = start + 4 * i as u64 - base;
            let how = match Some(rva) {
                at if at == profiled => Found::Profile,
                at if at == beside => Found::BesideArrays,
                _ => Found::Searched,
            };
            found.push(DatePlace { rva, date, found: how });
        }
    });
    found
}

/// Where the static pointer to the retirement manager is: where the build profile puts it, or as far from the
/// players' array as another build keeps it, or else wherever the plugin's writable data points at the manager.
/// `None` when the layout does not place the manager's lists, or nothing checks out.
pub(crate) fn find_retirement_manager(session: &Session) -> Option<Place> {
    session.layout.retirement.as_ref()?;
    let profiled = session.placed_retirement_manager();
    if let Some(rva) = profiled.filter(|&rva| holds_retirement_manager(session, rva)) {
        return Some(Place { rva, found: Found::Profile });
    }
    let guessed = retirement_guesses(session).into_iter().find(|&rva| holds_retirement_manager(session, rva));
    if let Some(rva) = guessed {
        return Some(Place { rva, found: Found::Guessed });
    }
    let found = search_retirement_manager(session);
    // Each pointer the search found leads to the manager; there has only ever been one.
    found.first().map(|&rva| Place { rva, found: Found::Searched })
}

/// Where other builds would have the static pointer to the retirement manager: as far from the players' array as each
/// built-in profile of the same kind of plugin keeps it, those of the same storefront first. This build's own profile
/// is left out, so that a build the editor knows can stand in for a new one.
pub fn retirement_guesses(session: &Session) -> Vec<u64> {
    let Some(players) = session.arrays.players.as_ref() else {
        return Vec::new();
    };
    let same_kind = |profile: &BuildProfile| {
        matches!(
            (profile.plugin, session.fingerprint),
            (PluginFingerprint::Pe { .. }, PluginFingerprint::Pe { .. })
                | (PluginFingerprint::MachO { .. }, PluginFingerprint::MachO { .. })
        )
    };
    let mut others: Vec<BuildProfile> =
        built_in_profiles().filter(|profile| profile.plugin != session.fingerprint && same_kind(profile)).collect();
    others.sort_by_key(|profile| profile.storefront != session.game.storefront);
    let mut guesses = Vec::new();
    for profile in others {
        let Some(manager) = profile.retirement_manager else {
            continue;
        };
        let distance = profile.arrays.players.wrapping_sub(manager);
        let guess = players.pair_rva.wrapping_sub(distance);
        if guess < session.plugin.size && !guesses.contains(&guess) {
            guesses.push(guess);
        }
    }
    guesses
}

/// Whether the 8 bytes at `rva` in the plugin point at the retirement manager.
pub fn holds_retirement_manager(session: &Session, rva: u64) -> bool {
    session
        .process
        .read_u64(session.plugin.base + rva)
        .is_ok_and(|object| is_user_pointer(object) && session.is_retirement_manager(object))
}

/// Every place in the plugin's writable data that points at an object of the retirement manager's class, by RVA. Its
/// vtables are found from the class's name, which takes a second or so.
pub fn search_retirement_manager(session: &Session) -> Vec<u64> {
    let vtables: HashSet<u64> =
        crate::rtti::vtables(&session.process, &session.plugin, MANAGER_CLASS).into_iter().collect();
    if vtables.is_empty() {
        return Vec::new();
    }
    // The heap pointers the data holds, by RVA; each object they point at is read once.
    let mut pointers: Vec<(u64, u64)> = Vec::new();
    each_stretch(session, |start, bytes| {
        for (i, word) in bytes.as_chunks::<8>().0.iter().enumerate() {
            let pointer = u64::from_le_bytes(*word);
            if is_user_pointer(pointer) && !session.plugin.contains(pointer) {
                pointers.push((start + 8 * i as u64 - session.plugin.base, pointer));
            }
        }
    });
    let mut classes: HashMap<u64, bool> = HashMap::new();
    pointers
        .into_iter()
        .filter(|&(_, pointer)| {
            *classes
                .entry(pointer)
                .or_insert_with(|| session.process.read_u64(pointer).is_ok_and(|vtable| vtables.contains(&vtable)))
        })
        .map(|(rva, _)| rva)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_read_as_the_game_keeps_them() {
        // The in-game date on the Game Pass test save, flags and all, and on the Steam one.
        assert_eq!(game_date_from(u32::from_le_bytes([0xFC, 0x3A, 0xEA, 0x07])), FmDate::from_number(20260909));
        assert_eq!(game_date_from(u32::from_le_bytes([0xE1, 0x00, 0xEB, 0x07])), FmDate::from_number(20270813));
        // Unset (1900), out of the years a game is on, and no day.
        assert_eq!(game_date_from(u32::from_le_bytes([0x01, 0x00, 0x6C, 0x07])), None);
        assert_eq!(game_date_from(u32::from_le_bytes([0x01, 0x00, 0xCF, 0x07])), None);
        assert_eq!(game_date_from(u32::from_le_bytes([0x00, 0x02, 0xEA, 0x07])), None);
    }
}
