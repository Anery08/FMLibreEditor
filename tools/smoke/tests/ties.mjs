// Clubs a player was trained at: one pointed at another club, and one added to a list with no room, which the app
// grows into memory of its own, each read back by the probe and undone (the grown list points back at its old buffer).
// Then the same through his profile's dialog: Change club, the search, the club picked.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { findPlayer, topClubs } from "../lib/witness.mjs";

export const name = "ties";
export const writes = true;

/** The clubs he was trained at, as the probe's `ties` lists them, by their place. */
function probedTies(probe, uid) {
  const ties = new Map();
  for (const line of probe.run(["ties", uid]).split(/\r?\n/)) {
    const match = line.match(/^\s+#(\d+)\s+(trained at club)\s+.*\(UID (\d+)\)(?:, homegrown rule (\d+))?/);
    if (match) {
      const [, index, kind, target, rule] = match;
      ties.set(Number(index), { kind, target: Number(target), rule: rule === undefined ? null : Number(rule) });
    }
  }
  return ties;
}

/** How many ties the probe reads, and how many more his list has room for. */
function probedRoom(probe, uid) {
  const match = probe.run(["ties", uid]).match(/: (\d+) tie\(s\), room for (\d+) more/);
  return match ? { ties: Number(match[1]), room: Number(match[2]) } : null;
}

/** What the probe reads at `index` in his list, as one line for a report. */
const at = (probe, uid, index) => {
  const tie = probedTies(probe, uid).get(index);
  return tie ? `${tie.kind} ${tie.target}${tie.rule === null ? "" : ` rule ${tie.rule}`}` : "nothing";
};

export async function run({ app, report, probe }) {
  const clubs = await topClubs(app, 6);

  // A club he was trained at, pointed at another one.
  const trained = await findPlayer(app, (details) => details.ties.some((tie) => tie.tie === "trainedAtClub"));
  if (!trained) {
    report.skip("points a club he was trained at at another", "no player trained at a club among the best known clubs");
  } else {
    const { player } = trained;
    const tie = player.ties.find((t) => t.tie === "trainedAtClub");
    const other = clubs.find((club) => !player.ties.some((t) => t.tie === "trainedAtClub" && t.targetUid === club.uid));
    report.note(`witness: ${player.name} (${player.uid}), #${tie.index} ${tie.name} (${tie.targetUid}), rule ${tie.rule}`);
    report.check("the probe reads the club the app reads", at(probe, player.uid, tie.index) === `trained at club ${tie.targetUid} rule ${tie.rule}`, at(probe, player.uid, tie.index));
    const changed = await app.must("change_tie", { uid: player.uid, index: tie.index, club: other.uid });
    report.check(
      "points it at another club, as the probe reads it",
      at(probe, player.uid, tie.index) === `trained at club ${other.uid} rule ${tie.rule}` && changed.tie?.to?.name === other.name,
      `${tie.name} → ${at(probe, player.uid, tie.index)}`,
    );
    await app.must("undo_change", { id: changed.id });
    report.check("the undo puts his club back", at(probe, player.uid, tie.index) === `trained at club ${tie.targetUid} rule ${tie.rule}`, at(probe, player.uid, tie.index));
  }

  // A club added to a list with no room: the app grows it.
  const full = await findPlayer(app, (details) => details.tieRoom === 0 && details.tiesGrow);
  if (!full) {
    report.skip("adds a club to a full list", "no player with a full list among the best known clubs");
  } else {
    const { player } = full;
    const club = clubs.find((c) => !player.ties.some((t) => t.tie === "trainedAtClub" && t.targetUid === c.uid));
    const was = probedRoom(probe, player.uid);
    report.note(`witness: ${player.name} (${player.uid}), ${was?.ties} ties, room for ${was?.room}`);
    const added = await app.must("add_tie", { uid: player.uid, tie: "trainedAtClub", target: club.uid, rule: 1 });
    const ties = (await app.must("player_details", { uid: player.uid })).ties;
    const index = ties.find((t) => t.tie === "trainedAtClub" && t.targetUid === club.uid)?.index;
    const now = probedRoom(probe, player.uid);
    report.check(
      "adds a club to his full list, as the probe reads it",
      index != null && at(probe, player.uid, index) === `trained at club ${club.uid} rule 1`,
      index == null ? "not in his profile" : at(probe, player.uid, index),
    );
    report.check(
      "the list grew, with room for a few more",
      was !== null && now !== null && now.ties === was.ties + 1 && now.room > 0,
      `${JSON.stringify(was)} → ${JSON.stringify(now)}`,
    );
    await app.must("undo_change", { id: added.id });
    const back = probedRoom(probe, player.uid);
    report.check("the undo gives him his list as it was", JSON.stringify(back) === JSON.stringify(was), JSON.stringify(back));
  }

  // A nation he needs no work permit in: England, given for as many days as the save's players of the EU have left.
  const ENGLAND = 765;
  const outsider = await findPlayer(
    app,
    (details) => details.nationUid !== ENGLAND && !details.ties.some((t) => t.tie === "workPermit" || t.targetUid === ENGLAND),
  );
  if (!outsider) {
    report.skip("gives a player no work permit needed in England", "no player from outside England among the best known clubs");
  } else {
    const { player } = outsider;
    report.note(`witness: ${player.name} (${player.uid}), ${player.nation}`);
    const permits = () =>
      [...probe.run(["ties", player.uid]).matchAll(/no work permit in\s+(.+?) \(UID (\d+)\), (\d+) days left/g)].map((m) => ({
        nation: Number(m[2]),
        days: Number(m[3]),
      }));
    const given = await app.must("add_tie", { uid: player.uid, tie: "workPermit", target: ENGLAND });
    const read = permits();
    report.check(
      "gives him no work permit needed in England, as the probe reads it",
      read.length === 1 && read[0].nation === ENGLAND && read[0].days > 0,
      JSON.stringify(read),
    );
    const own = (await app.invoke("add_tie", { uid: player.uid, tie: "workPermit", target: ENGLAND }));
    report.check("refuses it twice", !own.ok && own.error.code === "relation.same", own.ok ? "added" : own.error.code);
    await app.must("undo_change", { id: given.id });
    report.check("the undo takes it away", permits().length === 0, JSON.stringify(permits()));
  }

  // The same through the dialog: Change club, the search, Enter on the club found.
  if (!trained) return;
  const { player } = trained;
  const tie = player.ties.find((t) => t.tie === "trainedAtClub");
  const other = clubs.find((club) => !player.ties.some((t) => t.tie === "trainedAtClub" && t.targetUid === club.uid));
  await app.openTab("Players");
  await app.setInput(`${VIS}(".search input")`, String(player.uid));
  const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
  await app.waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes(${JSON.stringify(player.name)})`, "his row");
  await app.click(`${rows}[0]`, "his row");
  const profile = `${VIS}(".profile:not(.popup)")`;
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  await app.click(`${profile}.querySelector(".ties-foot button")`, "Change in Nationality and homegrown");
  const dialog = `document.querySelector(".ties-dialog")`;
  await app.waitFor(dialog, "the dialog");
  await app.click(`${dialog}.querySelector('[data-change-club="${tie.index}"]')`, "Change club");
  const search = `${dialog}.querySelector(".club-search input")`;
  await app.waitFor(`${search} && document.activeElement === ${search}`, "the club search, with the focus");
  await app.setInput(search, String(other.uid));
  const option = `${dialog}.querySelector(".club-search .move-option")`;
  await app.waitFor(`${option}?.textContent.includes(${JSON.stringify(other.name)})`, "the club found", 20000);
  await app.shot("ties-change-club");
  await app.press("Escape");
  await app.waitFor(`!${search}`, "the search to close");
  report.check("Escape gives up the search and keeps the dialog", await app.js(`!!${dialog}`));
  await app.click(`${dialog}.querySelector('[data-change-club="${tie.index}"]')`, "Change club");
  await app.waitFor(`${search} && document.activeElement === ${search}`, "the club search again");
  await app.setInput(search, String(other.uid));
  await app.waitFor(`${option}?.textContent.includes(${JSON.stringify(other.name)})`, "the club found", 20000);
  await sleep(300);
  await app.press("Enter");
  await app.waitFor(`!${search} && ${dialog}.textContent.includes(${JSON.stringify(other.name)}) && !${dialog}.getAttribute("aria-busy")`, "the new club in the dialog", 20000);
  report.check("picking the club in the dialog writes it", at(probe, player.uid, tie.index) === `trained at club ${other.uid} rule ${tie.rule}`, at(probe, player.uid, tie.index));
  await app.shot("ties-club-changed");
  const logged = (await app.must("change_log")).find((c) => c.uid === player.uid && c.field === "tie.trainedAtClub" && c.undoneAt == null);
  if (logged) await app.must("undo_change", { id: logged.id });
  report.check("undone again", at(probe, player.uid, tie.index) === `trained at club ${tie.targetUid} rule ${tie.rule}`, at(probe, player.uid, tie.index));
  await app.press("Escape");
  await app.press("Escape");
}
