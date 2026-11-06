// Editing a player: fields written through the app's commands, read back by the probe, and undone from the change
// log; then one attribute through his profile's Edit mode, undone from the Changes tab.
import { SHOWN, VIS } from "../lib/app.mjs";
import { clubPlayers, topClubs } from "../lib/witness.mjs";

export const name = "edit";
export const writes = true;

const FIELDS = ["attribute.finishing", "attribute.passing", "contract.wage"];

export async function run({ app, report, probe }) {
  const [, club] = await topClubs(app, 2);
  const [player] = await clubPlayers(app, club, 1);
  const uid = player.uid;
  report.note(`witness: ${player.name} (${uid}) of ${club.name}`);
  const before = await app.must("read_values", { entity: "player", uid });
  const seen = probe.get("player", uid, FIELDS);
  report.check("the probe reads what the app reads", FIELDS.every((field) => seen[field] === before[field]), JSON.stringify(seen));

  const nudge = (value, step, top) => (value + step <= top ? value + step : value - step);
  const edits = [
    { field: "attribute.finishing", value: nudge(before["attribute.finishing"], 5, 100) },
    { field: "attribute.passing", value: nudge(before["attribute.passing"], 5, 100) },
    { field: "contract.wage", value: before["contract.wage"] + 1000 },
  ];
  const applied = await app.must("apply_edits", { entity: "player", uid, edits });
  report.check("applies three edits", applied.applied.length === 3 && applied.failed.length === 0, JSON.stringify(applied.failed));
  const written = probe.get("player", uid, FIELDS);
  report.check("the probe reads the new values", edits.every((edit) => written[edit.field] === edit.value), JSON.stringify(written));

  for (const change of [...applied.applied].reverse()) {
    const undone = await app.must("undo_change", { id: change.id });
    report.check(`undoes ${change.field}`, undone.undoneAt != null);
  }
  const twice = await app.invoke("undo_change", { id: applied.applied[0].id });
  report.check("refuses to undo twice", !twice.ok);
  const restored = probe.get("player", uid, FIELDS);
  report.check("the probe reads the old values again", FIELDS.every((field) => restored[field] === seen[field]), JSON.stringify(restored));

  // The same through his profile.
  await app.openTab("Players");
  await app.setInput(`${VIS}(".search input")`, String(uid));
  const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
  await app.waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes(${JSON.stringify(player.name)})`, "his row");
  await app.click(`${rows}[0]`, "his row");
  const profile = `${VIS}(".profile:not(.popup)")`;
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  await app.click(`${profile}.querySelector("button.edit-toggle")`, "Edit");
  const input = `${profile}.querySelector('.edit-input[data-field="attribute.finishing"]')`;
  await app.waitFor(input, "the Finishing input");
  const shown = Number(await app.js(`${input}.value`));
  await app.setInput(input, shown < 20 ? shown + 1 : shown - 1);
  await app.waitFor(`${profile}.querySelector(".edit-count.pending")`, "one change to apply");
  await app.click(`${profile}.querySelector(".edit-footer button.primary")`, "Apply");
  await app.waitFor(`!${profile}.classList.contains("editing") && ${profile}.querySelector(".edit-report")?.textContent`, "the report");
  const viaProfile = probe.get("player", uid, ["attribute.finishing"])["attribute.finishing"];
  report.check("Edit mode writes the attribute", viaProfile !== seen["attribute.finishing"], `${seen["attribute.finishing"]} → ${viaProfile}`);
  await app.shot("edit-applied");

  await app.openTab("Changes");
  const undo = `document.querySelector("table.changes-grid tbody tr td.col-status button")`;
  await app.waitFor(undo, "the change in the Changes tab");
  await app.click(undo, "Undo");
  await app.waitFor(`/Undone/.test(document.querySelector("table.changes-grid tbody tr td.col-status")?.textContent ?? "")`, "Undone");
  const back = probe.get("player", uid, ["attribute.finishing"])["attribute.finishing"];
  report.check("the Changes tab undoes it", back === seen["attribute.finishing"], `back to ${back}`);
  await app.openTab("Players");
  await app.press("Escape");
}
