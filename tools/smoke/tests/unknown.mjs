// The day of an update, rehearsed: the app started with FMLIBRE_IGNORE_PROFILES=1, so that the build is one it has no
// profile for. It must find the in-game date and the planned retirements by itself, say that the build is new to it,
// and write nothing until Edit anyway. The edits it tries write the value already there: refused while the build is
// locked, and a change of nothing once it is not.
import { sleep } from "../lib/app.mjs";
import { retiringPlayers } from "../lib/witness.mjs";

export const name = "unknown";
export const writes = false;
export const ignoreProfiles = true;

export async function run({ app, report, probe, connection: c, known }) {
  report.check("treats the build as new", !c.knownBuild && c.profile == null, c.profile ?? "no profile");
  report.check("writes nothing until allowed", c.writable && !c.editable);
  const failed = c.health.results.filter((result) => !result.passed).map((result) => result.check);
  report.check("every check passes", failed.length === 0, failed.length ? `failed: ${failed.join(", ")}` : "");
  const date = c.health.results.find((result) => result.check === "gameDate");
  report.check("finds the in-game date by itself", c.gameDate != null, JSON.stringify(c.gameDate));
  if (known?.gameDate) {
    report.check("the same date as with the profile", JSON.stringify(c.gameDate) === JSON.stringify(known.gameDate),
      `${JSON.stringify(c.gameDate)} and ${JSON.stringify(known.gameDate)}`);
  }
  const page = await app.must("search_players", { query: "", limit: 200 });
  const aged = page.rows.filter((player) => player.age != null).length;
  report.check("the players have ages", aged === page.rows.length, `${aged} of ${page.rows.length}`);

  const [retiring] = retiringPlayers(probe);
  if (retiring == null) {
    report.skip("finds the planned retirements by itself", "the game plans no player's retirement on this save");
  } else {
    const details = await app.must("player_details", { uid: retiring });
    report.check("finds the planned retirements by itself", details.retirementKnown && details.retires != null,
      `${details.name}: ${JSON.stringify(details.retires)}`);
  }

  const notice = `document.querySelector(".compatibility-notice")`;
  await app.waitFor(notice, "the notice about the build");
  const text = await app.js(`${notice}.textContent`);
  report.check("says the build is new, and offers Edit anyway", await app.js(`!!${notice}.querySelector("button.primary")`),
    text.replace(/\s+/g, " ").slice(0, 160));
  await app.shot("unknown-notice");

  // An edit of nothing: the value already there, which the probe reads (the app reads no field it may not write).
  const uid = page.rows[0].uid;
  const value = probe.get("player", uid, ["attribute.finishing"])["attribute.finishing"];
  const same = [{ field: "attribute.finishing", value }];
  const locked = await app.must("apply_edits", { entity: "player", uid, edits: same });
  report.check("refuses edits while locked", locked.applied.length === 0 && locked.failed.length === 1,
    JSON.stringify(locked.failed[0]?.error?.code ?? locked.failed[0]?.error ?? ""));

  await app.click(`${notice}.querySelector("button.primary")`, "Edit anyway");
  await sleep(500);
  const allowed = await app.must("current_connection");
  report.check("Edit anyway allows editing", allowed.editable);
  const read = await app.must("read_values", { entity: "player", uid });
  report.check("then reads the fields", read["attribute.finishing"] === value, `finishing ${read["attribute.finishing"]}`);
  const open = await app.must("apply_edits", { entity: "player", uid, edits: same });
  report.check("then takes edits", open.failed.length === 0 && open.applied.length === 0, JSON.stringify(open.failed));
  report.check("still nothing written", (await app.must("change_log")).length === 0);
  report.note(`gameDate check: ${date?.passed ? "pass" : "FAIL"} ${date?.fit} of ${date?.sampled}`);
}
