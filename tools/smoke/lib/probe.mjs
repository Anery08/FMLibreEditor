// The command-line probe, as a second pair of eyes: it reads the game on its own, so what the app wrote and undid can
// be checked apart from the app. Writes only stand in for the game changing a value (see freeze.mjs).
import { execFileSync } from "node:child_process";

export class Probe {
  constructor(path) {
    this.path = path;
  }

  /** Runs the probe with `args` and returns what it printed. */
  run(args) {
    return execFileSync(this.path, args.map(String), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }

  /** The values `fmlibre-probe get` reads for fields of a player, member of staff or club, as stored. */
  get(entity, uid, fields) {
    const values = {};
    for (const line of this.run(["get", entity, uid, ...fields]).split(/\r?\n/)) {
      const match = line.match(/^\s+(\S+)\s+(-?\d+)/);
      if (match) values[match[1]] = Number(match[2]);
    }
    return values;
  }

  /** Writes a value as the game would, behind the app's back. */
  set(entity, uid, field, value) {
    this.run(["set", entity, uid, field, value]);
  }

  /** The build line, profile, date and arrays, as `calibrate` prints them. */
  calibrate() {
    return this.run(["calibrate"]).trim();
  }
}
