// Recalling a player from his loan: the game's date becomes the loan's last day, which the probe reads back, the
// profile says his return is pending, and the undo puts the old end back. When the day is over the game would end the
// loan itself; the test undoes it before.
import { SHOWN, VIS } from "../lib/app.mjs";
import { findPlayer } from "../lib/witness.mjs";

export const name = "loan";
export const writes = true;

const FIELD = "loan.expires";
const OPTION = "loan.option_fee";

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

  // The loan's terms, as the game's Loan Club tab shows them: the probe reads them on its own.
  const { terms } = loan;
  const probed = probe.run(["loans", player.uid]).match(/recall (yes|no), terminate (yes|no),.*option fee (-|\d+)/);
  report.check(
    "the probe reads the loan's terms the app shows",
    terms != null &&
      probed != null &&
      (probed[1] === "yes") === terms.canBeRecalled &&
      (probed[2] === "yes") === terms.canBeTerminated &&
      (probed[3] === "-" ? null : Number(probed[3])) === terms.optionFee,
    terms && `recall ${terms.canBeRecalled}, terminate ${terms.canBeTerminated}, option fee ${terms.optionFee}`,
  );
  const limited = terms != null && (!terms.canBeRecalled || !terms.canBeTerminated);

  const today = numberOf(connection.gameDate);
  const optionBefore = terms ? probe.get("player", player.uid, [OPTION])[OPTION] : undefined;
  const recalled = await app.must("recall_loan", { uid: player.uid });
  const written = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the loan's last day is now the game's date", recalled != null && written === today, `${written}, today ${today}`);
  // A loan with an option to buy loses it, or the game might sell him to the club he is on loan at when it ends.
  if (optionBefore !== undefined) {
    const optionNow = probe.get("player", player.uid, [OPTION])[OPTION];
    report.check(
      "the recall takes the option to buy away, and notes it",
      optionBefore >= 0 ? optionNow === -1 && recalled?.recall?.optionFee === optionBefore : optionNow === optionBefore && !recalled?.recall,
      `${optionBefore} → ${optionNow}`,
    );
  }
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
  if (optionBefore !== undefined) {
    const optionBack = probe.get("player", player.uid, [OPTION])[OPTION];
    report.check("and the option to buy", optionBack === optionBefore, String(optionBack));
  }
  const later = await app.must("player_details", { uid: player.uid });
  report.check("and his profile offers the recall again", later.loan?.ends === "later" && !later.loan.recalled);

  // The same through his profile: the button asks first, Cancel writes nothing, Recall writes and the status replaces
  // the button.
  await app.openTab("Players");
  await app.setInput(`${VIS}(".search input")`, String(player.uid));
  const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
  await app.waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes(${JSON.stringify(player.name)})`, "his row");
  await app.click(`${rows}[0]`, "his row");
  const profile = `${VIS}(".profile:not(.popup)")`;
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  const button = `${profile}.querySelector(".clauses.loan button.recall-toggle")`;
  const dialog = `document.querySelector(".recall-dialog")`;
  await app.click(button, "Recall from loan");
  await app.waitFor(dialog, "the recall dialog");
  const asked = await app.js(`${dialog}.contains(document.activeElement) && document.activeElement.textContent`);
  const says = await app.js(`${dialog}.querySelector(".recall-terms")?.textContent ?? ""`);
  report.check("the dialog says what the loan's terms would not allow in the game", !!says === limited, says || "nothing");
  if (terms?.optionFee != null && terms.optionFee > 0) {
    const does = await app.js(`${dialog}.querySelector(".move-facts:not(.recall-terms .move-facts)")?.textContent ?? ""`);
    const lists = await app.js(`[...${dialog}.querySelectorAll(".move-section")].map((s) => s.textContent).join(" ")`);
    report.check("and that the recall takes the option to buy away", /option to buy him/.test(lists), does.slice(0, 160));
  }
  await app.shot("loan-recall-dialog");
  await app.press("Escape");
  await app.waitFor(`!${dialog}`, "the dialog to close");
  const kept = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("the dialog asks first: Cancel or Escape writes nothing", kept === before, `focus on ${JSON.stringify(asked)}`);
  await app.click(button, "Recall from loan");
  await app.waitFor(dialog, "the recall dialog");
  await app.click(`${dialog}.querySelector(".modal-foot button.primary")`, "Recall");
  await app.waitFor(`!${dialog} && ${profile}.querySelector(".clauses.loan .loan-status")`, "the pending status");
  const viaDialog = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("Recall in the dialog makes today the last day", viaDialog === today, String(viaDialog));
  const status = await app.js(`${profile}.querySelector(".clauses.loan .loan-status").textContent`);
  const gone = await app.js(`!${button}`);
  report.check("the status takes the button's place", gone, status);
  await app.shot("loan-recalled");
  const log = await app.must("change_log");
  const logged = log.find((change) => change.uid === player.uid && change.field === FIELD && change.undoneAt == null);
  if (logged) await app.must("undo_change", { id: logged.id });
  const back = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check("undone again", back === before, String(back));
  // That undo went behind the profile's back (the Changes tab's tells it): open it again, to read the loan anew.
  await app.press("Escape");
  await app.click(`${rows}[0]`, "his row");
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false" && ${button}`, "his profile again", 30000);

  // Made permanent: the dialog plans it, then the command makes it, which the probe reads as no loan, and one undo puts
  // the loan back.
  await app.click(`${profile}.querySelector(".clauses.loan button.permanent-toggle")`, "Make permanent");
  const permanent = `document.querySelector(".permanent-dialog")`;
  await app.waitFor(`${permanent}?.querySelector(".move-plan.ok, .move-plan.refused")`, "the plan in the dialog", 20000);
  const planLine = await app.js(`${permanent}.querySelector(".move-plan").textContent`);
  const planned = await app.js(`!!${permanent}.querySelector(".move-plan.ok")`);
  report.check("the dialog plans making the loan permanent", planned, planLine);
  // The fee is the first amount the dialog asks for: the loan's option to buy, where it has one.
  const feeShown = await app.js(`${permanent}.querySelector("input[type=number]")?.value ?? null`);
  const option = terms?.optionFee ?? null;
  report.check(
    "the fee starts as the loan's option to buy",
    option !== null && option > 0 ? feeShown !== "" && feeShown !== null : feeShown === "",
    `${feeShown || "empty"}, option ${option}`,
  );
  await app.shot("loan-permanent-dialog");
  await app.press("Escape");
  await app.waitFor(`!${permanent}`, "the dialog to close");
  const made = await app.must("make_loan_permanent", { uid: player.uid, terms: {} });
  const afterMade = await app.must("player_details", { uid: player.uid });
  const loansNow = probe.run(["loans", player.uid]);
  report.check(
    "made permanent: no loan, at the club he was on loan to",
    afterMade.loan === null && afterMade.clubUid === loan.clubUid && /^0 loan contract/m.test(loansNow),
    `${made.moved?.from} → ${made.moved?.to}`,
  );
  const unmade = await app.must("undo_change", { id: made.id });
  const restoredLoan = await app.must("player_details", { uid: player.uid });
  const loanEnd = probe.get("player", player.uid, [FIELD])[FIELD];
  report.check(
    "the undo puts the loan back",
    unmade.undoneAt != null && restoredLoan.loan?.parentUid === loan.parentUid && loanEnd === before,
    String(loanEnd),
  );
  await app.press("Escape");
}
