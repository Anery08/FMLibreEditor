// Signing a free agent: the best free agent the app agrees to sign goes to one of the best known clubs, whose squad
// list is full once a save is loaded (the app grows it), under a contract the app makes in a slot of the game's own pool
// of contracts. The probe reads him at the club with that contract, one more player in the squad and one slot fewer
// free; the undo makes him a free agent again and gives the slot back. Then the same through his profile's Transfer
// dialog: no fee and no swap, the club picked, the contract the plan shows, Sign, and the undo from the Changes tab.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "sign";
export const writes = true;

/** The game's pool of contracts as the probe reads it: how many slots are free and used. */
function contractPool(probe) {
  const line = probe.run(["pools"]).split(/\r?\n/).find((l) => l.includes("FULL_CONTRACT"));
  const match = line?.match(/(\d+) free\s+(\d+) used/);
  return match ? { free: Number(match[1]), used: Number(match[2]) } : null;
}

/** The club the probe reads the player at ("-" for none), and his contract ("none" for none). */
function probedPlayer(probe, uid) {
  const text = probe.run(["player", uid]);
  return {
    club: text.match(/^\s+club\s+(.*)$/m)?.[1]?.trim() ?? "?",
    contract: text.match(/^\s+contract\s+(.*)$/m)?.[1]?.trim() ?? "?",
  };
}

/** How many players the probe reads in the club's senior squad list. */
function squadSize(probe, uid) {
  const match = probe.run(["room", uid]).match(/lists (\d+) players/);
  return match ? Number(match[1]) : null;
}

const pounds = (wage) => `£${wage} per week`;

export async function run({ app, report, probe }) {
  const clubs = await topClubs(app, 6);
  const agents = (await app.must("search_players", { query: "", limit: 30, filter: { freeAgents: true, women: false } }))
    .rows;
  // The first the app agrees to sign for the best known club: player-coaches are left out.
  let found = null;
  for (const player of agents) {
    const plan = await app.invoke("plan_club_move", { uid: player.uid, club: clubs[0].uid, terms: {}, fee: null, release: null });
    if (plan.ok) {
      found = { player, plan: plan.value };
      break;
    }
  }
  if (!found) {
    report.check("finds a free agent the app agrees to sign", false, `${agents.length} free agents refused`);
    return;
  }
  const { player, plan } = found;
  const club = clubs[0];
  report.note(`witness: ${player.name} (${player.uid}), a free agent, → ${club.name}`);
  report.check(
    "the plan has no club to leave, and the contract it makes",
    plan.from === undefined && plan.to.uid === club.uid && plan.contract?.wage > 0 && plan.contract?.expires > 0,
    JSON.stringify(plan.contract),
  );

  const pool = contractPool(probe);
  const squad = squadSize(probe, club.uid);
  report.check("the probe reads the game's pool of contracts", pool !== null, JSON.stringify(pool));
  report.check("the probe reads him with no club and no contract", probedPlayer(probe, player.uid).club === "-");

  const signed = await app.must("move_player", { uid: player.uid, club: club.uid, terms: {}, fee: null, release: null });
  const now = probedPlayer(probe, player.uid);
  report.check(
    "signs him, logged from no club",
    signed.field === "club" && signed.moved?.from === undefined && signed.moved?.to === club.name,
    `${signed.moved?.from ?? "-"} → ${signed.moved?.to}`,
  );
  report.check("the probe reads him at the club", now.club.startsWith(club.name.slice(0, 20)), now.club);
  report.check(
    "under the contract the plan said",
    now.contract.startsWith(pounds(plan.contract.wage)) && now.contract.includes(String(plan.contract.expires).slice(0, 4)),
    now.contract,
  );
  const poolNow = contractPool(probe);
  report.check(
    "in a slot of the game's pool",
    pool && poolNow && poolNow.free === pool.free - 1 && poolNow.used === pool.used + 1,
    `${JSON.stringify(pool)} → ${JSON.stringify(poolNow)}`,
  );
  report.check("one more player in the squad list", squad !== null && squadSize(probe, club.uid) === squad + 1, `${squad} → ${squadSize(probe, club.uid)}`);

  await app.must("undo_change", { id: signed.id });
  const back = probedPlayer(probe, player.uid);
  report.check("the undo makes him a free agent again", back.club === "-" && back.contract === "none", `${back.club}; ${back.contract}`);
  report.check("and gives the slot back", JSON.stringify(contractPool(probe)) === JSON.stringify(pool), JSON.stringify(contractPool(probe)));
  report.check("and the squad list its old length", squadSize(probe, club.uid) === squad, `${squadSize(probe, club.uid)}`);

  // The same through his profile's Transfer dialog, to the second best known club.
  const other = clubs[1];
  await app.openTab("Players");
  await app.setInput(`${VIS}(".search input")`, String(player.uid));
  const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
  await app.waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes(${JSON.stringify(player.name)})`, "his row");
  await app.click(`${rows}[0]`, "his row");
  const profile = `${VIS}(".profile:not(.popup)")`;
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  const button = `${profile}.querySelector(".move-toggle")`;
  await app.waitFor(`${button} && !${button}.disabled`, "the Transfer button");
  report.check("a free agent's profile offers Transfer, and not Release", await app.js(`!${profile}.querySelector(".release-toggle")`));
  await app.click(button, "Transfer");
  const dialog = `document.querySelector(".move-dialog")`;
  await app.waitFor(dialog, "the dialog");
  report.check(
    "the dialog signs him: no fee and no swap",
    await app.js(`!${dialog}.querySelector(".move-mode") && !${dialog}.querySelector('input[id$="-fee"]')`),
  );
  const search = `${dialog}.querySelector(".move-search input")`;
  await app.setInput(search, String(other.uid));
  const option = `${dialog}.querySelector(".move-option")`;
  await app.waitFor(`${option}?.textContent.includes(${JSON.stringify(other.name)})`, "the club found", 20000);
  await sleep(300);
  await app.press("Enter");
  const planLine = `${dialog}.querySelector(".move-plan.ok")`;
  await app.waitFor(planLine, "the plan", 20000);
  report.check("the plan shows the new contract", await app.js(`${planLine}.textContent.includes(${JSON.stringify(other.name)}) && /£/.test(${planLine}.textContent)`), await app.js(`${planLine}.textContent`));
  await app.shot("sign-dialog");
  await app.click(`${dialog}.querySelector(".modal-foot .primary")`, "Sign");
  await app.waitFor(`!${dialog}`, "the dialog to close", 30000);
  report.check("Sign signs him, as the probe reads it", probedPlayer(probe, player.uid).club.startsWith(other.name.slice(0, 20)), probedPlayer(probe, player.uid).club);
  const logged = (await app.must("change_log")).find((c) => c.uid === player.uid && c.field === "club" && c.undoneAt == null);
  await app.openTab("Changes");
  await app.shot("sign-changes");
  if (logged) await app.must("undo_change", { id: logged.id });
  report.check("undone again", probedPlayer(probe, player.uid).club === "-", probedPlayer(probe, player.uid).club);
  report.check("the pool as it was", JSON.stringify(contractPool(probe)) === JSON.stringify(pool), JSON.stringify(contractPool(probe)));
}
