// Renaming a stadium: in the block the game gave its name, so only to a name of the lengths that keep that block,
// read back by the probe and undone; then the same through the club's Stadium tab.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "stadium";
export const writes = true;

/** Bytes of UTF-8, as the game keeps a name. */
const bytes = (text) => Buffer.byteLength(text, "utf8");

/** Names to try, shortest first: the first that fits a stadium's lengths is the one written. */
const CANDIDATES = [
  "FML Ground",
  "FML Test Stadium",
  "FMLibreEditor Test Stadium",
  "FMLibreEditor Test Stadium Ground",
  "FMLibreEditor Test Stadium Ground Of The Club",
];

/** The stadium's name as the probe reads it in its `club` report. */
function probedName(probe, uid) {
  return probe.run(["club", uid]).match(/^\s+stadium\s+(.+?): capacity/m)?.[1] ?? null;
}

export async function run({ app, report, probe }) {
  // The best known club whose stadium the editor can rename: the stadium alone holds its name.
  let club = null;
  let room = null;
  for (const candidate of await topClubs(app, 10)) {
    const found = await app.invoke("stadium_name", { club: candidate.uid });
    if (found.ok && found.value.holders === 1) {
      [club, room] = [candidate, found.value];
      break;
    }
  }
  if (!club) {
    report.skip("renames a stadium", "no stadium among the best known clubs that the editor can rename");
    return;
  }
  const fresh = CANDIDATES.find((n) => bytes(n) >= room.minBytes && bytes(n) <= room.maxBytes && n !== room.name);
  report.note(`witness: ${club.name} (${club.uid}), ${room.name} (${bytes(room.name)} bytes, ${room.minBytes} to ${room.maxBytes})`);
  report.check("the probe reads the name the app reads", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));

  // Names that do not fit, or are not names, are refused, and nothing is written.
  const long = await app.invoke("rename_stadium", { club: club.uid, name: "X".repeat(room.maxBytes + 1) });
  report.check("refuses a name too long for its block", !long.ok && long.error.code === "stadium.nameLength", long.ok ? "written" : long.error.code);
  const spaced = await app.invoke("rename_stadium", { club: club.uid, name: ` ${fresh}`.slice(0, room.maxBytes) });
  report.check("refuses a name that starts with a space", !spaced.ok && spaced.error.code === "stadium.badName", spaced.ok ? "written" : spaced.error.code);
  report.check("and writes nothing", probedName(probe, club.uid) === room.name);

  const renamed = await app.must("rename_stadium", { club: club.uid, name: fresh });
  report.check(
    "renames the stadium, as the probe reads it",
    probedName(probe, club.uid) === fresh && renamed.stadium?.from === room.name && renamed.stadium?.to === fresh,
    `${room.name} → ${probedName(probe, club.uid)}`,
  );
  const details = await app.must("club_details", { uid: club.uid });
  report.check("the club's profile has the new name", details.stadium?.name === fresh, details.stadium?.name);
  await app.must("undo_change", { id: renamed.id });
  report.check("the undo puts the old name back", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));

  // The same through the Stadium tab: Rename, the length as it is typed, Save, the new name in place.
  await app.openClub(club.name);
  const profile = `${VIS}(".profile:not(.popup)")`;
  const tab = `[...document.querySelectorAll(".profile-tabs [role=tab]")].filter(${SHOWN}).find((t) => t.textContent.trim() === "Stadium")`;
  await app.click(tab, "the Stadium tab");
  const rename = `${profile}.querySelector(".stadium-name button")`;
  await app.waitFor(rename, "the Rename button", 20000);
  await app.click(rename, "Rename");
  const input = `${profile}.querySelector(".stadium-name-input")`;
  await app.waitFor(input, "the name's input");
  await app.setInput(input, fresh);
  await sleep(200);
  const note = await app.js(`${profile}.querySelector(".stadium-rename .move-note")?.textContent ?? ""`);
  report.check("the note counts the name's length as it is typed", note.includes(String(bytes(fresh))), note);
  await app.shot("stadium-rename");
  await app.click(`[...${profile}.querySelectorAll(".stadium-rename button")].find((b) => b.textContent.trim() === "Save")`, "Save");
  await app.waitFor(`!${input} && ${profile}.querySelector(".stadium-name")?.textContent.includes(${JSON.stringify(fresh)})`, "the new name", 20000);
  report.check("Save in the tab renames it", probedName(probe, club.uid) === fresh, probedName(probe, club.uid));
  await app.shot("stadium-renamed");
  const logged = (await app.must("change_log")).find((c) => c.uid === club.uid && c.field === "stadium.name" && c.undoneAt == null);
  if (logged) await app.must("undo_change", { id: logged.id });
  report.check("undone again", probedName(probe, club.uid) === room.name, probedName(probe, club.uid));
  await app.press("Escape");
}
