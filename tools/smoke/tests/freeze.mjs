// Freezing a player's attributes: the probe lowers one as the game would, and the app puts it back within its 2 s
// hold; unfrozen, a lower value stays lower. Everything the probe lowered is written back.
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
}
