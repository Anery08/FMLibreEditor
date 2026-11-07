// Renaming a stadium: a name that keeps the size of the old one's block is written over it, any other goes into a
// string of the editor's own that the stadium is pointed at; each read back by the probe and undone. Then the same
// through the club's Stadium tab, and a stadium whose name other things share, where there is one among the best known
// clubs. The game keeps no stadium names in its saves and gives each its own back when it loads one: the probe does
// that in its place, and the app, which remembers the new name for the save, gives it again within its 2 s hold, until
// the rename is undone.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "stadium";
export const writes = true;

/** Bytes of UTF-8, as the game keeps a name. */
const bytes = (text) => Buffer.byteLength(text, "utf8");

/** The size of the block the game's allocator gives a name of `n` bytes. */
const block = (n) => Math.ceil((n + 17) / 16) * 16;

/** Names to try: the first of the wanted block size, other than the stadium's own, is the one written. */
const CANDIDATES = [
  "FML Ground",
  "FML Test Arena",
  "FML Test Stadium",
  "FMLibreEditor Test Stadium",
  "FMLibreEditor Test Stadium Ground",
  "FMLibreEditor Test Stadium Ground Of The Club",
];

/** The stadium's name as the probe reads it in its `club` report. */
function probedName(probe, uid) {
  return probe.run(["club", uid]).match(/^\s+stadium\s+(.+?): capacity/m)?.[1] ?? null;
}

/** Whether `test` comes true within `ms` milliseconds, asked every half second. */
async function eventually(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(500);
  }
  return test();
}

/** Renames the stadium of `club` to `to` through the command, checks it with the probe and the profile, and undoes it. */
async function renameAndUndo(app, report, probe, club, from, to, what) {
  const renamed = await app.must("rename_stadium", { club: club.uid, name: to });
  report.check(
    `${what}: renamed, as the probe reads it`,
    probedName(probe, club.uid) === to && renamed.stadium?.from === from && renamed.stadium?.to === to,
    `${from} → ${probedName(probe, club.uid)}`,
  );
  const details = await app.must("club_details", { uid: club.uid });
  report.check(`${what}: the club's profile has the new name`, details.stadium?.name === to, details.stadium?.name);
  await app.must("undo_change", { id: renamed.id });
  report.check(`${what}: the undo puts the old name back`, probedName(probe, club.uid) === from, probedName(probe, club.uid));
}

export async function run({ app, report, probe }) {
  // The best known clubs whose stadium the editor can rename, with what it reads of each.
  const found = [];
  for (const candidate of await topClubs(app, 30)) {
    const room = await app.invoke("stadium_name", { club: candidate.uid });
    if (room.ok && room.value.renamable) found.push({ club: candidate, room: room.value });
  }
  const own = found.find((f) => f.room.holders === 1);
  if (!own) {
    report.skip("renames a stadium", "no stadium among the best known clubs that the editor can rename");
    return;
  }
  const { club, room } = own;
  const size = block(bytes(room.name));
  const same = CANDIDATES.find((n) => block(bytes(n)) === size && n !== room.name);
  const other = CANDIDATES.find((n) => block(bytes(n)) !== size);
  report.note(`witness: ${club.name} (${club.uid}), ${room.name} (${bytes(room.name)} bytes, ${room.minBytes} to ${room.maxBytes})`);
  report.check("the probe reads the name the app reads", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));

  // Names that are too long, or are not names, are refused, and nothing is written.
  const long = await app.invoke("rename_stadium", { club: club.uid, name: "X".repeat(room.maxBytes + 1) });
  report.check("refuses a name longer than the most", !long.ok && long.error.code === "stadium.nameLength", long.ok ? "written" : long.error.code);
  const spaced = await app.invoke("rename_stadium", { club: club.uid, name: " FML Ground" });
  report.check("refuses a name that starts with a space", !spaced.ok && spaced.error.code === "stadium.badName", spaced.ok ? "written" : spaced.error.code);
  report.check("and writes nothing", probedName(probe, club.uid) === room.name);

  if (same) await renameAndUndo(app, report, probe, club, room.name, same, "a name of the same block's size");
  await renameAndUndo(app, report, probe, club, room.name, other, "a name of another size");

  // A name other things share: the stadium gets a string of its own, which leaves the shared one to them.
  const shared = found.find((f) => f.room.holders > 1);
  if (shared) {
    report.note(`shared: ${shared.club.name} (${shared.club.uid}), ${shared.room.name}, ${shared.room.holders} holders`);
    await renameAndUndo(app, report, probe, shared.club, shared.room.name, "FMLibreEditor Shared Test", "a shared name");
  } else {
    report.note("no stadium among the best known clubs has a shared name");
  }

  // The same through the Stadium tab: Rename, the length as it is typed, Save, the new name in place.
  await app.openClub(club.name, club.uid);
  const profile = `${VIS}(".profile:not(.popup)")`;
  const tab = `[...document.querySelectorAll(".profile-tabs [role=tab]")].filter(${SHOWN}).find((t) => t.textContent.trim() === "Stadium")`;
  await app.click(tab, "the Stadium tab");
  const rename = `${profile}.querySelector(".stadium-name button")`;
  await app.waitFor(rename, "the Rename button", 20000);
  await app.click(rename, "Rename");
  const input = `${profile}.querySelector(".stadium-name-input")`;
  await app.waitFor(input, "the name's input");
  await app.setInput(input, other);
  await sleep(200);
  const note = await app.js(`${profile}.querySelector(".stadium-rename .move-note")?.textContent ?? ""`);
  report.check("the note counts the name's length as it is typed", note.includes(String(bytes(other))), note);
  await app.shot("stadium-rename");
  await app.click(`[...${profile}.querySelectorAll(".stadium-rename button")].find((b) => b.textContent.trim() === "Save")`, "Save");
  await app.waitFor(`!${input} && ${profile}.querySelector(".stadium-name")?.textContent.includes(${JSON.stringify(other)})`, "the new name", 20000);
  report.check("Save in the tab renames it", probedName(probe, club.uid) === other, probedName(probe, club.uid));
  await app.shot("stadium-renamed");

  // The game gives the stadium its own name back, as it does when it loads the save; the app gives the new one again.
  const file = join(app.folder, "data", "frozen.json");
  const remembered = () => (existsSync(file) ? readFileSync(file, "utf8") : "");
  report.check("remembers the new name for this save", remembered().includes(JSON.stringify(other)), "not in frozen.json");
  probe.run(["stadium-name", club.uid, room.name]);
  report.check("the probe gives the stadium its old name, as the game does", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));
  const back = await eventually(() => probedName(probe, club.uid) === other, 8000);
  report.check("the app gives the new name back within seconds", back, probedName(probe, club.uid));

  // Undone, the old name stays, and the save no longer remembers the new one.
  const logged = (await app.must("change_log")).find((c) => c.uid === club.uid && c.field === "stadium.name" && c.undoneAt == null);
  if (logged) await app.must("undo_change", { id: logged.id });
  report.check("undone again", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));
  report.check("and forgotten", !remembered().includes(JSON.stringify(other)), "still in frozen.json");
  await sleep(4500);
  report.check("the app leaves the old name alone after the undo", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));
  await app.press("Escape");
}
