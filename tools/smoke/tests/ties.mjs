// Clubs a player was trained at: one pointed at another club, and one added in place of a club he favours or
// dislikes where his list has no room, each read back by the probe and undone. A tie cannot take the place of a
// relation that is not such a club. Then the same through his profile's dialog: Change club, the search, the club
// picked.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { findPlayer, topClubs } from "../lib/witness.mjs";

export const name = "ties";
export const writes = true;

/** The clubs he was trained at, and those he favours or dislikes, as the probe's `ties` lists them, by their place. */
function probedTies(probe, uid) {
  const ties = new Map();
  for (const line of probe.run(["ties", uid]).split(/\r?\n/)) {
    const match = line.match(/^\s+#(\d+)\s+(trained at club|favoured club|disliked club)\s+.*\(UID (\d+)\)(?:, homegrown rule (\d+))?/);
    if (match) {
      const [, index, kind, target, rule] = match;
      ties.set(Number(index), { kind, target: Number(target), rule: rule === undefined ? null : Number(rule) });
    }
  }
  return ties;
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

  // A club added in place of one he favours or dislikes, where his list has no room.
  const full = await findPlayer(app, (details) => details.tieRoom === 0 && details.clubOpinions.length > 0);
  if (!full) {
    report.skip("adds a club in place of an opinion", "no player with a full list and a club he favours or dislikes");
  } else {
    const { player } = full;
    const opinion = player.clubOpinions[0];
    const club = clubs.find((c) => !player.ties.some((t) => t.tie === "trainedAtClub" && t.targetUid === c.uid));
    report.note(`witness: ${player.name} (${player.uid}), #${opinion.index} ${opinion.opinion} ${opinion.name} (${opinion.targetUid})`);
    const was = at(probe, player.uid, opinion.index);
    report.check("the probe reads the opinion the app reads", was === `${opinion.opinion} club ${opinion.targetUid}`, was);
    const added = await app.invoke("add_tie", { uid: player.uid, tie: "trainedAtClub", target: club.uid, rule: 1 });
    report.check("adding is refused, the list being full", !added.ok && added.error.code === "relation.noRoom", added.ok ? "added" : added.error.code);
    const wrong = player.ties[0];
    if (wrong) {
      const refused = await app.invoke("replace_tie", { uid: player.uid, index: wrong.index, tie: "trainedAtClub", target: club.uid, rule: 1 });
      report.check(
        "a tie cannot take the place of a relation that is not a club he favours or dislikes",
        !refused.ok && refused.error.code === "relation.noOpinion",
        refused.ok ? "written" : refused.error.code,
      );
    }
    const replaced = await app.must("replace_tie", { uid: player.uid, index: opinion.index, tie: "trainedAtClub", target: club.uid, rule: 1 });
    report.check(
      "a club takes the opinion's place, as the probe reads it",
      at(probe, player.uid, opinion.index) === `trained at club ${club.uid} rule 1`,
      `${was} → ${at(probe, player.uid, opinion.index)}`,
    );
    report.check(
      "the change log says what it took the place of",
      replaced.tie?.replaced?.opinion === opinion.opinion && replaced.tie?.replaced?.name === opinion.name,
      JSON.stringify(replaced.tie?.replaced ?? null),
    );
    const after = await app.must("player_details", { uid: player.uid });
    report.check(
      "his profile lists the club, and the opinion no more",
      after.ties.some((t) => t.index === opinion.index && t.targetUid === club.uid) && !after.clubOpinions.some((o) => o.index === opinion.index),
    );
    await app.must("undo_change", { id: replaced.id });
    report.check("the undo gives the opinion back", at(probe, player.uid, opinion.index) === was, at(probe, player.uid, opinion.index));
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
