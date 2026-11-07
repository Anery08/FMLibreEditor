// A transfer: a player moved to another club's senior team through the app's commands, then moved back with an undo.
// The pair is the first the app itself agrees to (no loans or human clubs; a full list the app grows on Windows).
import { clubPlayers, topClubs } from "../lib/witness.mjs";

export const name = "move";
export const writes = true;

export async function run({ app, report, probe }) {
  const clubs = await topClubs(app, 12);
  let found = null;
  let refusals = 0;
  search: for (const from of clubs.slice(3)) {
    for (const player of (await clubPlayers(app, from, 6)).slice(2)) {
      for (const to of clubs.slice(0, 8).filter((club) => club.uid !== from.uid)) {
        const plan = await app.invoke("plan_club_move", { uid: player.uid, club: to.uid, terms: {}, fee: null, release: null });
        if (plan.ok) {
          found = { player, from, to };
          break search;
        }
        refusals++;
      }
    }
  }
  if (!found) {
    report.check("finds a move the app agrees to", false, `${refusals} refused`);
    return;
  }
  const { player, from, to } = found;
  report.note(`${player.name} (${player.uid}): ${from.name} → ${to.name}, after ${refusals} refused`);
  const clubOf = async () => (await app.must("player_details", { uid: player.uid })).clubUid;

  const moved = await app.must("move_player", { uid: player.uid, club: to.uid, terms: {}, fee: null, release: null });
  report.check("moves him", (await clubOf()) === to.uid, `logged as ${moved.field}: ${moved.moved?.from} → ${moved.moved?.to}`);
  report.check("the probe sees him at the new club", probe.run(["player", player.uid]).includes(to.name));
  const undone = await app.must("undo_change", { id: moved.id });
  report.check("the undo moves him back", undone.undoneAt != null && (await clubOf()) === from.uid);
  report.check("the probe sees him back", probe.run(["player", player.uid]).includes(from.name));
}
