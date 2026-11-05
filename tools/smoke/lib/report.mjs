// What a smoke run found: one line per check as it happens, and a summary and results.json at the end.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export class Report {
  constructor(folder) {
    this.folder = folder;
    this.test = "";
    this.results = [];
    this.notes = [];
  }

  /** Starts the checks of one test. */
  begin(test) {
    this.test = test;
    console.log(`\n== ${test}`);
  }

  /** Records a check; returns whether it passed. */
  check(name, ok, detail = "") {
    const passed = Boolean(ok);
    this.results.push({ test: this.test, name, ok: passed, detail: String(detail) });
    console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  | ${detail}` : ""}`);
    return passed;
  }

  /** Records a check that was not made, and why. */
  skip(name, why) {
    this.results.push({ test: this.test, name, skipped: true, detail: why });
    console.log(`SKIP  ${name}  | ${why}`);
  }

  note(text) {
    this.notes.push({ test: this.test, text });
    console.log(`      ${text}`);
  }

  get failed() {
    return this.results.filter((result) => result.ok === false);
  }

  /** Prints the summary, writes results.json, and returns whether every check passed. */
  finish(extra = {}) {
    const passed = this.results.filter((result) => result.ok).length;
    const skipped = this.results.filter((result) => result.skipped).length;
    writeFileSync(
      join(this.folder, "results.json"),
      JSON.stringify({ ...extra, passed, failed: this.failed.length, skipped, results: this.results, notes: this.notes }, null, 2),
    );
    console.log(`\n${passed} passed, ${this.failed.length} failed, ${skipped} skipped. Details: ${join(this.folder, "results.json")}`);
    for (const failure of this.failed) {
      console.log(`  FAILED [${failure.test}] ${failure.name}${failure.detail ? `: ${failure.detail}` : ""}`);
    }
    return this.failed.length === 0;
  }
}
