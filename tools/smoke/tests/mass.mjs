// A mass edit over one club's players: planned, applied, read back, and undone as one batch.
import { topClubs } from "../lib/witness.mjs";

export const name = "mass";
export const writes = true;

export async function run({ app, report, probe }) {
  const [, , club] = await topClubs(app, 3);
  const page = await app.must("search_players", { query: "", limit: 3, filter: { clubUid: club.uid } });
  const sample = page.rows;
  const before = sample.map((player) => probe.get("player", player.uid, ["attribute.crossing"])["attribute.crossing"]);
  const preview = await app.must("plan_mass_edit", {
    entity: "player",
    query: "",
    filters: { playerFilter: { clubUid: club.uid } },
    operations: [{ field: "attribute.crossing", operation: { op: "add", amount: 3 } }],
  });
  report.check(`plans +3 crossing for ${club.name}'s players`, preview.targets === page.total && preview.changes > 0,
    `${preview.targets} players, ${preview.changes} changes, ${preview.unchanged} unchanged`);
  const applied = await app.must("apply_mass_edit", { id: preview.id });
  report.check("applies it", applied.applied === preview.changes && applied.failed.length === 0, JSON.stringify(applied.failed.slice(0, 3)));
  const after = sample.map((player) => probe.get("player", player.uid, ["attribute.crossing"])["attribute.crossing"]);
  report.check("the probe reads the new values", after.every((value, i) => value === Math.min(100, before[i] + 3)),
    `${before.join(", ")} → ${after.join(", ")}`);
  const undone = await app.must("undo_batch", { batch: applied.batch });
  report.check("undoes the batch", undone.undone === applied.applied && undone.failed.length === 0, JSON.stringify(undone.failed.slice(0, 3)));
  const back = sample.map((player) => probe.get("player", player.uid, ["attribute.crossing"])["attribute.crossing"]);
  report.check("the probe reads the old values again", back.every((value, i) => value === before[i]), back.join(", "));
}
