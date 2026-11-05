// Recalling a player from his loan: the loan's end moves to the day after the game's date, which the probe reads back,
// and the undo puts the old end back. On that day the game would end the loan itself; the test undoes it before.
import { findPlayer } from "../lib/witness.mjs";

export const name = "loan";
export const writes = true;

const FIELD = "loan.expires";

/** A date as the editor writes it: 20270630. */
const numberOf = (date) => date.year * 10000 + date.month * 100 + date.day;

/** The day after `date`. */
function nextDay(date) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export async function run({ app, report, probe, connection }) {
  if (!connection.gameDate) {
    report.skip("recalls a player from his loan", "the in-game date is not known");
    return;
  }
  const found = await findPlayer(app, (details) => details.loan?.until != null);
  if (!found) {
    report.skip("recalls a player from his loan", "no player on loan among the best players of the best known clubs");
    return;
  }
  const { player } = found;
  const { loan } = player;
  report.note(`witness: ${player.name} (${player.uid}), on loan from ${loan.parent} to ${loan.club} until ${numberOf(loan.until)}`);
  const before = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the probe reads the loan's end the app shows", before === numberOf(loan.until), String(before));

  const tomorrow = numberOf(nextDay(connection.gameDate));
  const recalled = await app.must("recall_loan", { uid: player.uid });
  const written = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the loan now ends the day after the game's date", recalled != null && written === tomorrow, `${written}, tomorrow ${tomorrow}`);
  const after = await app.must("player_details", { uid: player.uid });
  report.check("his profile shows the new end", after.loan != null && numberOf(after.loan.until) === tomorrow);
  const again = await app.must("recall_loan", { uid: player.uid });
  report.check("a second recall writes nothing", again === null);
  const today = numberOf(connection.gameDate);
  const past = await app.must("apply_edits", { entity: "player", uid: player.uid, edits: [{ field: FIELD, value: today }] });
  report.check("refuses to end it on the game's date", past.failed.length === 1 && past.failed[0].error.code === "edit.outOfRange");

  const undone = await app.must("undo_change", { id: recalled.id });
  const restored = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the undo puts the old end back", undone.undoneAt != null && restored === before, String(restored));
}
