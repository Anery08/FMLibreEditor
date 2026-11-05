// Recalling a player from his loan: the game's date becomes the loan's last day, which the probe reads back, the
// profile says his return is pending, and the undo puts the old end back. When the day is over the game would end the
// loan itself; the test undoes it before.
import { findPlayer } from "../lib/witness.mjs";

export const name = "loan";
export const writes = true;

const FIELD = "loan.expires";

/** A date as the editor writes it: 20270630. */
const numberOf = (date) => date.year * 10000 + date.month * 100 + date.day;

/** The day before `date`. */
function dayBefore(date) {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day - 1));
  return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() };
}

export async function run({ app, report, probe, connection }) {
  if (!connection.gameDate) {
    report.skip("recalls a player from his loan", "the in-game date is not known");
    return;
  }
  const found = await findPlayer(app, (details) => details.loan?.ends === "later");
  if (!found) {
    report.skip("recalls a player from his loan", "no player on loan among the best players of the best known clubs");
    return;
  }
  const { player } = found;
  const { loan } = player;
  report.note(`witness: ${player.name} (${player.uid}), on loan from ${loan.parent} to ${loan.club} until ${numberOf(loan.until)}`);
  const before = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the probe reads the loan's end the app shows", before === numberOf(loan.until), String(before));

  const today = numberOf(connection.gameDate);
  const recalled = await app.must("recall_loan", { uid: player.uid });
  const written = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the loan's last day is now the game's date", recalled != null && written === today, `${written}, today ${today}`);
  const after = await app.must("player_details", { uid: player.uid });
  report.check(
    "his profile says his return is pending",
    after.loan != null && numberOf(after.loan.until) === today && after.loan.ends === "today" && after.loan.recalled,
    JSON.stringify(after.loan && { ends: after.loan.ends, recalled: after.loan.recalled }),
  );
  const again = await app.must("recall_loan", { uid: player.uid });
  report.check("a second recall writes nothing", again === null);
  const yesterday = numberOf(dayBefore(connection.gameDate));
  const past = await app.must("apply_edits", { entity: "player", uid: player.uid, edits: [{ field: FIELD, value: yesterday }] });
  report.check("refuses a day the game has finished", past.failed.length === 1 && past.failed[0].error.code === "edit.outOfRange");

  const undone = await app.must("undo_change", { id: recalled.id });
  const restored = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the undo puts the old end back", undone.undoneAt != null && restored === before, String(restored));
  const later = await app.must("player_details", { uid: player.uid });
  report.check("and his profile offers the recall again", later.loan?.ends === "later" && !later.loan.recalled);
}
