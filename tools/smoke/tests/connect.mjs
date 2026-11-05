// Connecting and reading: the build, the checks, the in-game date, the lists and the profiles. Writes nothing.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "connect";
export const writes = false;

export async function run({ app, report, connection: c }) {
  report.check("reads the game", c.players > 1000 && c.staff > 1000 && c.clubs > 100,
    `${c.players} players, ${c.staff} staff, ${c.clubs} clubs in ${c.loadMs} ms`);
  report.check("knows this build", c.knownBuild, c.profile ?? "no profile for it");
  report.check("can write to the game", c.writable && c.editable);
  const failed = c.health.results.filter((result) => !result.passed).map((result) => result.check);
  report.check("every check passes", failed.length === 0, failed.length ? `failed: ${failed.join(", ")}` : "");
  report.check("has the in-game date", c.gameDate != null, JSON.stringify(c.gameDate));

  const page = await app.must("search_players", { query: "", limit: 200 });
  const aged = page.rows.filter((player) => player.age != null).length;
  report.check("the best players have ages", aged === page.rows.length, `${aged} of ${page.rows.length}`);

  const year = c.gameDate ? String(c.gameDate.year) : "-";
  const masthead = await app.js(`document.querySelector(".masthead")?.textContent ?? ""`);
  report.check("the masthead shows the date", masthead.includes(year), masthead.replace(/\s+/g, " ").slice(0, 120));
  report.check("no notice about the build or the checks", !(await app.js(`!!document.querySelector(".compatibility-notice")`)));

  // The players' list and a profile.
  await app.openTab(0);
  const rows = `[...document.querySelectorAll("table.grid tbody tr")].filter(${SHOWN})`;
  await app.waitFor(`${rows}.length > 0`, "the players' rows");
  await app.click(`${rows}[0]`, "the first player");
  const profile = `${VIS}(".profile:not(.popup)")`;
  await app.waitFor(`${profile} && ${profile}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  const first = page.rows[0];
  const heading = await app.js(`${profile}.querySelector("h2")?.textContent ?? ""`);
  report.check("a player's profile opens", heading.includes(first.name), `${heading} (expected ${first.name})`);
  await app.shot("connect-player");
  await app.press("Escape");
  await sleep(300);

  // Staff and clubs.
  await app.openTab(1);
  await app.waitFor(`${rows}.length > 0`, "the staff's rows");
  report.check("the staff list fills", true, `${await app.js(`${rows}.length`)} rows shown`);
  const [club] = await topClubs(app, 1);
  await app.openClub(club.name);
  const opened = await app.js(`${VIS}(".profile:not(.popup) h2")?.textContent ?? ""`);
  report.check("a club's profile opens", opened.includes(club.name), opened);
  await app.click(`[...document.querySelectorAll(".profile-tabs [role=tab]")].filter(${SHOWN})[1]`, "the Squad tab");
  await app.waitFor(`${VIS}(".squad-tab tbody tr")`, "the squad", 30000);
  report.check("the club's squad fills", true, `${await app.js(`document.querySelectorAll(".squad-tab tbody tr").length`)} players`);
  await app.shot("connect-club");

  // Nothing written yet.
  const log = await app.must("change_log");
  report.check("the change log starts empty", log.length === 0, `${log.length} changes`);
}
