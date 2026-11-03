// Whether a newer FMLibreEditor is out, and installing it. The app asks GitHub for the latest published release when it
// starts, and again when the Check for updates button at the foot of the window is pressed. A copy the Windows installer
// put in place, and the macOS app, update themselves: they download the new version, check its signature and install it
// (`installUpdate`). Any other copy (portable, or a macOS app run where it was downloaded) opens the release's page,
// where the installer, the portable zip and the macOS app are.

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check as checkForInstaller } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
import { call, inTauri } from "./api";

/** The latest published release (drafts and pre-releases are left out by GitHub). */
const LATEST_RELEASE = "https://api.github.com/repos/tozmoz/FMLibreEditor/releases/latest";

/** Where the releases are; the only pages the notice opens (the app may open no other, see capabilities/default.json). */
const RELEASES_PAGE = "https://github.com/tozmoz/FMLibreEditor/releases";

/** The version the browser preview pretends to be: an old one, so that the notice can be seen there. */
const PREVIEW_VERSION = "0.1.0";

/** Where the last answer is kept, so that the window reloading (to change the language) does not ask again. */
const STORAGE_KEY = "fmlibre.update";

/** How long the last answer stands before the app asks again at startup: GitHub answers 60 questions an hour. */
const FRESH_MS = 6 * 60 * 60 * 1000;

/** Where a notice put aside with Later is kept, for the rest of this run (a reload keeps it too). */
const LATER_KEY = "fmlibre.updateLater";

/** A release newer than the app: its version ("0.3.0") and its page. */
export interface Release {
  version: string;
  url: string;
}

/** The last answer: when it was given, and the release it found newer than the app, if any. */
interface Answer {
  checkedAt: number;
  current: string;
  newer: Release | null;
}

/**
 * What the app knows: still asking, the latest release is the app's own (or older), a newer one is out, or the
 * question could not be answered (offline, say).
 */
export type UpdateState =
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "newer"; release: Release }
  | { phase: "failed" };

/** The numbers of a version ("v0.10.2" is [0, 10, 2]); anything after a hyphen, as in "0.3.0-beta", is left out. */
function versionNumbers(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `version` comes after `than`, comparing their numbers in order. */
export function isNewer(version: string, than: string): boolean {
  const a = versionNumbers(version);
  const b = versionNumbers(than);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

/** The app's version, from its configuration (tauri.conf.json). */
export const appVersion = (): Promise<string> => (inTauri ? getVersion() : Promise.resolve(PREVIEW_VERSION));

/** The page to open for a release: the one GitHub names, if it is one of the releases' pages. */
const releasePage = (url: unknown): string =>
  typeof url === "string" && url.startsWith(`${RELEASES_PAGE}/`) ? url : `${RELEASES_PAGE}/latest`;

/** Asks GitHub for the latest release and compares it with `current`. Throws when there is no usable answer. */
async function askGitHub(current: string): Promise<Answer> {
  const response = await fetch(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}`);
  }
  const latest: { tag_name?: unknown; html_url?: unknown } = await response.json();
  if (typeof latest.tag_name !== "string") {
    throw new Error("GitHub's answer has no version");
  }
  const version = latest.tag_name.replace(/^v/i, "");
  const newer = isNewer(version, current) ? { version, url: releasePage(latest.html_url) } : null;
  return { checkedAt: Date.now(), current, newer };
}

/** The last answer, if it is about this version of the app and recent; null otherwise, or when it cannot be read. */
function freshAnswer(current: string): Answer | null {
  let saved: Partial<Answer> | null;
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
  if (saved?.current !== current || typeof saved.checkedAt !== "number" || Date.now() - saved.checkedAt >= FRESH_MS) {
    return null;
  }
  const { checkedAt, newer } = saved;
  if (newer === null) {
    return { checkedAt, current, newer };
  }
  // Anyone can edit the storage: the page is checked again before it is kept.
  return typeof newer?.version === "string"
    ? { checkedAt, current, newer: { version: newer.version, url: releasePage(newer.url) } }
    : null;
}

function keep(answer: Answer): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(answer));
  } catch {
    // Not kept: the next start asks GitHub again, which is all that is lost.
  }
}

/** The version whose notice was put aside with Later in this run; null when none was. */
function laterVersion(): string | null {
  try {
    return window.sessionStorage.getItem(LATER_KEY);
  } catch {
    return null;
  }
}

/** Opens a release's page in the browser. */
export function openRelease(release: Release): void {
  if (inTauri) {
    void openUrl(release.url);
  } else {
    window.open(release.url, "_blank", "noopener");
  }
}

/**
 * Whether this copy can update itself (see `can_self_update`): an installed Windows copy or the macOS app, never the
 * browser preview.
 */
const canSelfUpdate = (): Promise<boolean> => (inTauri ? call<boolean>("can_self_update") : Promise.resolve(false));

/** How far installing an update has got. */
export type InstallProgress =
  | { phase: "preparing" }
  /** `percent` is null while the size of the download is not known. */
  | { phase: "downloading"; percent: number | null }
  | { phase: "installing" };

/** The latest release offers nothing this copy can install: no newer version, or no installer for it. */
export class NothingToInstall extends Error {}

/**
 * Downloads the latest release, checks it against the signing key the app was built with, and installs it. On Windows
 * the installer runs: the app closes, and the installer opens the new version once it is in place. On macOS the new app
 * takes the place of this one (macOS asks for an administrator's password where the user may not change it), and then
 * the app starts again as the new version. What the release offers is read from its `latest.json`; `onProgress` hears
 * how far it has got. Throws `NothingToInstall`, or why a step failed.
 */
export async function installUpdate(onProgress: (progress: InstallProgress) => void): Promise<void> {
  onProgress({ phase: "preparing" });
  const update = await checkForInstaller();
  if (update === null) {
    throw new NothingToInstall();
  }
  let total: number | null = null;
  let done = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress({ phase: "downloading", percent: total ? 0 : null });
        break;
      case "Progress":
        done += event.data.chunkLength;
        onProgress({ phase: "downloading", percent: total ? Math.min(100, Math.floor((done * 100) / total)) : null });
        break;
      case "Finished":
        onProgress({ phase: "installing" });
        break;
    }
  });
  // Only macOS gets here: on Windows the app has closed for the installer.
  await call("restart_app");
}

/**
 * Whether a newer version is out. It asks once when the app starts (an answer from the last six hours stands in for
 * that), and again whenever `check` is called. `notice` is the release to tell the user about: a newer one, unless its
 * notice was put aside with `later`; asking by hand brings a put-aside notice back.
 */
export function useUpdateCheck() {
  const [current, setCurrent] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ phase: "checking" });
  const [later, setLater] = useState<string | null>(laterVersion);
  // Whether the notice offers Update rather than Download.
  const [selfUpdate, setSelfUpdate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    canSelfUpdate()
      .then((can) => !cancelled && setSelfUpdate(can))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = useCallback(async (version: string) => {
    setState({ phase: "checking" });
    try {
      const answer = await askGitHub(version);
      keep(answer);
      setState(answer.newer ? { phase: "newer", release: answer.newer } : { phase: "current" });
    } catch {
      setState({ phase: "failed" });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void appVersion()
      .then((version) => {
        if (cancelled) {
          return;
        }
        setCurrent(version);
        const answer = freshAnswer(version);
        if (answer) {
          setState(answer.newer ? { phase: "newer", release: answer.newer } : { phase: "current" });
        } else {
          void ask(version);
        }
      })
      .catch(() => setState({ phase: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [ask]);

  const check = useCallback(() => {
    if (current !== null) {
      setLater(null);
      try {
        window.sessionStorage.removeItem(LATER_KEY);
      } catch {
        // Nothing was kept, or nothing can be: either way the notice shows again.
      }
      void ask(current);
    }
  }, [ask, current]);

  const putAside = useCallback((release: Release) => {
    setLater(release.version);
    try {
      window.sessionStorage.setItem(LATER_KEY, release.version);
    } catch {
      // Put aside until the window reloads only.
    }
  }, []);

  const notice = state.phase === "newer" && state.release.version !== later ? state.release : null;
  return { current, state, notice, selfUpdate, check, later: putAside };
}
