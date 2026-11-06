// Freezing a player's attributes: the probe changes one as the game would, and the app puts it back within its 2 s
// hold; unfrozen, a changed value stays. What the probe changed is written back.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "../lib/app.mjs";
import { clubPlayers, topClubs } from "../lib/witness.mjs";

export const name = "freeze";
export const writes = true;

export async function run({ app, report, probe }) {
  const [, , , club] = await topClubs(app, 4);
  const [player] = await clubPlayers(app, club, 1);
  const field = "attribute.finishing";
  const original = probe.get("player", player.uid, [field])[field];
  const lowered = original > 20 ? original - 10 : original + 10;
  report.note(`witness: ${player.name} (${player.uid}), finishing ${original}`);
  try {
    const frozen = await app.must("freeze_attributes", { uid: player.uid, frozen: true });
    report.check("freezes his attributes", frozen.includes(player.uid));
    const file = join(app.folder, "data", "frozen.json");
    report.check("remembers it in frozen.json", existsSync(file) && readFileSync(file, "utf8").includes(String(player.uid)));
    probe.set("player", player.uid, field, lowered);
    await sleep(4500);
    const held = probe.get("player", player.uid, [field])[field];
    report.check("puts back what the game changed", held === original, `changed to ${lowered}, reads ${held}`);

    const unfrozen = await app.must("freeze_attributes", { uid: player.uid, frozen: false });
    report.check("unfreezes them", !unfrozen.includes(player.uid));
    probe.set("player", player.uid, field, lowered);
    await sleep(4500);
    const free = probe.get("player", player.uid, [field])[field];
    report.check("then leaves a changed value alone", free === lowered, `reads ${free}`);
  } finally {
    await app.invoke("freeze_attributes", { uid: player.uid, frozen: false });
    probe.set("player", player.uid, field, original);
    report.check("finishing written back", probe.get("player", player.uid, [field])[field] === original);
  }

  // The same for a member of staff: the best known coach of the clubs no human manages.
  const human = new Set((await app.must("search_staff", { query: "", limit: 20 })).rows.filter((m) => m.isHuman).map((m) => m.uid));
  const coaches = (await app.must("search_staff", { query: "", limit: 60 })).rows;
  const member = coaches.find((m) => !human.has(m.uid) && m.clubUid != null);
  if (!member) {
    report.skip("freezes a member of staff's attributes", "no member of staff at a club");
    return;
  }
  const key = "attribute.tactical";
  const was = probe.get("staff", member.uid, [key])[key];
  const worse = was > 20 ? was - 10 : was + 10;
  report.note(`witness: ${member.name} (${member.uid}), tactical ${was}`);
  try {
    const frozen = await app.must("freeze_staff_attributes", { id: member.uid, frozen: true });
    report.check("freezes a member of staff's attributes", frozen.includes(member.uid));
    probe.set("staff", member.uid, key, worse);
    await sleep(4500);
    const held = probe.get("staff", member.uid, [key])[key];
    report.check("puts back what the game changed for him", held === was, `changed to ${worse}, reads ${held}`);
    const unfrozen = await app.must("freeze_staff_attributes", { id: member.uid, frozen: false });
    report.check("unfreezes his attributes", !unfrozen.includes(member.uid));
  } finally {
    await app.invoke("freeze_staff_attributes", { id: member.uid, frozen: false });
    probe.set("staff", member.uid, key, was);
    report.check("his tactical written back", probe.get("staff", member.uid, [key])[key] === was);
  }

  // Max attributes for him, read back by the probe, and its batch undone.
  const fields = (await app.must("edit_fields", { entity: "staff" })).filter((f) => f.key.startsWith("attribute."));
  const keys = fields.map((f) => f.key);
  const before = probe.get("staff", member.uid, keys);
  const maxed = await app.must("max_staff_attributes", { id: member.uid });
  const best = probe.get("staff", member.uid, keys);
  const atBest = fields.every((f) => best[f.key] === (f.scale === "attribute" ? 100 : 20) || best[f.key] === before[f.key]);
  report.check("Max attributes sets his attributes to their best", maxed.failed.length === 0 && atBest, `${maxed.applied} written`);
  const batch = (await app.must("change_log")).find((c) => c.uid === member.uid && c.batch != null && c.undoneAt == null)?.batch;
  if (batch != null) await app.must("undo_batch", { batch });
  const after = probe.get("staff", member.uid, keys);
  report.check("its undo puts them back", keys.every((k) => after[k] === before[k]));
}
