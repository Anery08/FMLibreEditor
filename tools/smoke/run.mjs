// Smoke tests for FMLibreEditor: start the built app, drive it against the running game, and report what passed.
// See README.md. Usage:
//   node tools/smoke/run.mjs [--exe PATH] [--probe PATH] [--writes] [--only a,b] [--port N] [--out DIR]
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { App } from "./lib/app.mjs";
import { Probe } from "./lib/probe.mjs";
import { Report } from "./lib/report.mjs";
import * as connect from "./tests/connect.mjs";
import * as dialog from "./tests/dialog.mjs";
import * as edit from "./tests/edit.mjs";
import * as freeze from "./tests/freeze.mjs";
import * as mass from "./tests/mass.mjs";
import * as medical from "./tests/medical.mjs";
import * as move from "./tests/move.mjs";
import * as unknown from "./tests/unknown.mjs";

/** In the order they run: the ones that only read first. */
const TESTS = [connect, dialog, edit, mass, move, medical, freeze, unknown];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values: options } = parseArgs({
  options: {
    exe: { type: "string", default: join(root, "target", "release", "FMLibreEditor.exe") },
    probe: { type: "string" },
    writes: { type: "boolean", default: false },
    only: { type: "string" },
    port: { type: "string", default: "9341" },
    out: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (options.help) {
  console.log(`node tools/smoke/run.mjs [--exe PATH] [--probe PATH] [--writes] [--only ${TESTS.map((t) => t.name).join(",")}]
                         [--port N] [--out DIR]
--writes also runs the tests that write to the game, each undone: only on a save you can lose.`);
  process.exit(0);
}

const probePath =
  options.probe ??
  [join(root, "target", "release", "fmlibre-probe.exe"), join(root, "target", "debug", "fmlibre-probe.exe")].find(existsSync);
for (const [what, path] of [["app", options.exe], ["probe", probePath]]) {
  if (!path || !existsSync(path)) {
    console.error(`no ${what} at ${path ?? "target\\{release,debug}"}: build it first (see README.md)`);
    process.exit(2);
  }
}
const wanted = options.only ? options.only.split(",").map((name) => name.trim()) : null;
const unknownNames = wanted?.filter((name) => !TESTS.some((test) => test.name === name)) ?? [];
if (unknownNames.length) {
  console.error(`no such test: ${unknownNames.join(", ")}`);
  process.exit(2);
}
const selected = TESTS.filter((test) => !wanted || wanted.includes(test.name));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const folder = resolve(options.out ?? join(root, "tools", "smoke", "out", stamp));
mkdirSync(folder, { recursive: true });
const port = Number(options.port);

const probe = new Probe(probePath);
const report = new Report(folder);
let game;
try {
  game = probe.calibrate();
} catch (err) {
  console.error(`the probe could not read the game; start FM27 and load a save first.\n${err.stderr ?? err.message}`);
  process.exit(2);
}
console.log(`${game}\n\napp: ${options.exe}\nprobe: ${probePath}\nout: ${folder}`);
if (!options.writes && selected.some((test) => test.writes)) {
  console.log("Tests that write to the game are skipped; --writes runs them, on a save you can lose.");
}

/** Runs `tests` in one copy of the app, connected; `env` and `known` as for the unknown build's copy. */
async function session(tests, { name, env = {}, known } = {}) {
  let app;
  let connection;
  try {
    app = await App.start({ exe: options.exe, port, folder: join(folder, name), env });
    connection = await app.connect();
  } catch (err) {
    report.begin(name);
    report.check("the app starts and connects", false, err.message);
    app?.close();
    return null;
  }
  try {
    for (const test of tests) {
      report.begin(test.name);
      if (test.writes && !options.writes) {
        report.skip(test.name, "writes to the game: run with --writes, on a save you can lose");
        continue;
      }
      try {
        await test.run({ app, report, probe, connection, known });
      } catch (err) {
        report.check(`${test.name} runs to the end`, false, err.stack ?? String(err));
        await app.shot(`${test.name}-error`).catch(() => {});
        await app.press("Escape").catch(() => {});
      }
    }
    report.begin(`${name}: afterwards`);
    await leaveNothingChanged(app);
    report.check("no errors in the page's console", app.consoleProblems.length === 0, app.consoleProblems.slice(0, 5).join(" || "));
    if (app.networkErrors.length) report.note(`${app.networkErrors.length} failed requests, e.g. ${app.networkErrors[0]}`);
  } finally {
    app.close();
  }
  return connection;
}

/** Undoes every change still in the log, newest first, and unfreezes everything: whatever a failed test left. */
async function leaveNothingChanged(app) {
  const left = (await app.must("change_log")).filter((change) => change.undoneAt == null);
  const failed = [];
  for (const change of left) {
    const undone = await app.invoke("undo_change", { id: change.id });
    if (!undone.ok) failed.push(`${change.name} ${change.field}: ${JSON.stringify(undone.error)}`);
  }
  if (left.length) report.note(`undid ${left.length - failed.length} changes a test left`);
  report.check("every change is undone", failed.length === 0, failed.join("; "));
  for (const uid of await app.must("frozen_players")) await app.invoke("freeze_attributes", { uid, frozen: false });
  for (const uid of await app.must("frozen_fitness")) await app.invoke("freeze_fitness", { uid, frozen: false });
  for (const club of await app.must("frozen_clubs")) await app.invoke("freeze_money", { club, frozen: false });
  const stillFrozen = [
    ...(await app.must("frozen_players")),
    ...(await app.must("frozen_fitness")),
    ...(await app.must("frozen_clubs")),
  ];
  report.check("nothing stays frozen", stillFrozen.length === 0, stillFrozen.join(", "));
}

const withProfiles = selected.filter((test) => !test.ignoreProfiles);
const rehearsal = selected.filter((test) => test.ignoreProfiles);
const connection = withProfiles.length ? await session(withProfiles, { name: "known" }) : null;
if (rehearsal.length) {
  await session(rehearsal, { name: "unknown", env: { FMLIBRE_IGNORE_PROFILES: "1" }, known: connection });
}
const ok = report.finish({ game, app: options.exe, writes: options.writes, storefront: connection?.game?.storefront });
process.exit(ok ? 0 : 1);
