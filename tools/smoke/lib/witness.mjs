// Players and clubs to test with, picked from the save on each run. Fixed ones go stale as a save moves on: a player
// heals, serves his ban, changes clubs, or the human manager takes over another club.

/** The clubs of the human managers, whose players the tests leave alone. */
export async function humanClubs(app) {
  const staff = (await app.must("search_staff", { query: "", limit: 20 })).rows;
  return staff.filter((member) => member.isHuman && member.clubUid != null).map((member) => member.clubUid);
}

/** The men's clubs no human manages, best known first, as the Clubs tab lists them. */
export async function topClubs(app, count = 20) {
  const human = await humanClubs(app);
  const clubs = (await app.must("search_clubs", { query: "", limit: count + human.length, filter: { women: false } })).rows;
  return clubs.filter((club) => !human.includes(club.uid)).slice(0, count);
}

/** The players of `club`, best first. */
export async function clubPlayers(app, club, limit = 40) {
  return (await app.must("search_players", { query: "", limit, filter: { clubUid: club.uid } })).rows;
}

/**
 * The first player whose details `wanted` accepts, among the best players of the best known clubs, with his club; null
 * when there is none.
 */
export async function findPlayer(app, wanted, { clubs = 30, perClub = 30 } = {}) {
  for (const club of await topClubs(app, clubs)) {
    for (const player of await clubPlayers(app, club, perClub)) {
      const details = await app.must("player_details", { uid: player.uid });
      if (wanted(details, club)) return { player: details, club };
    }
  }
  return null;
}

/** The players the game plans to retire, from the probe's list: UIDs, soonest first. */
export function retiringPlayers(probe) {
  const uids = [];
  for (const line of probe.run(["retirements"]).split(/\r?\n/)) {
    const match = line.match(/\(UID (\d+),/);
    if (match) uids.push(Number(match[1]));
  }
  return uids;
}
