// The player filters the user saved under a name: what is kept, how it is read back, and the hook the filter bar uses.
// They are kept in `localStorage`, which anyone can edit and which can be unavailable (a private window, blocked site
// data): every access is guarded, and every entry is checked field by field, with a default for what is wrong.

import { useState } from "react";
import { PLAYER_ATTRIBUTES } from "./AttributeFilters";
import { readPersonFields, textOr } from "./FilterBar";
import { intlLocale } from "./i18n";
import { NO_PLAYER_FILTERS, POSITION_ORDER, type PlayerFilterFields } from "./PlayerFilters";
import { isRecord } from "./restore";
import type { PlayerOrder, PlayerSort } from "./types";

/** Where the saved filters are kept: a JSON array of `SavedPlayerFilter`. */
export const STORAGE_KEY = "fmlibre.savedPlayerFilters";

/** The most filters that are kept, and the longest name one has. */
export const MAX_SAVED = 20;
export const MAX_NAME_LENGTH = 50;

/** A filter the user saved: what the filter bar held and how the list was sorted, under a name of the user's own. */
export interface SavedPlayerFilter {
  /** As the user typed it. */
  name: string;
  fields: PlayerFilterFields;
  /** The sort a column header was clicked for; null for the order the list starts in (best current ability first). */
  order: PlayerOrder | null;
}

/** Every sort there is; the type makes the table fail to compile when a sort is added without being listed here. */
const SORTS: Record<PlayerSort, true> = {
  currentAbility: true,
  potentialAbility: true,
  age: true,
  name: true,
  nation: true,
  club: true,
  contractExpires: true,
};

const POSITION_KEYS: ReadonlySet<string> = new Set(POSITION_ORDER);

/**
 * The fields of the filter bar from a stored value; a field that is missing or is not what the bar holds is empty. It
 * also brings the bar back after the language was switched (see `restore.ts`).
 */
export function readFields(value: unknown): PlayerFilterFields {
  const given = isRecord(value) ? value : {};
  const none = NO_PLAYER_FILTERS;
  return {
    ...readPersonFields(given, PLAYER_ATTRIBUTES),
    position: textOr(given.position, none.position, (text) => text === "" || POSITION_KEYS.has(text)),
    freeAgents: typeof given.freeAgents === "boolean" ? given.freeAgents : none.freeAgents,
    transferListed: typeof given.transferListed === "boolean" ? given.transferListed : none.transferListed,
    loanListed: typeof given.loanListed === "boolean" ? given.loanListed : none.loanListed,
  };
}

/**
 * The sort from a stored value; the list's own order when it is missing or is not a sort. It also brings the sort back
 * after the language was switched.
 */
export function readOrder(value: unknown): PlayerOrder | null {
  if (
    isRecord(value) &&
    typeof value.by === "string" &&
    Object.prototype.hasOwnProperty.call(SORTS, value.by) &&
    typeof value.ascending === "boolean"
  ) {
    return { by: value.by as PlayerSort, ascending: value.ascending };
  }
  return null;
}

/** A name as it is kept: without the spaces around it, and no longer than a name may be. */
export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** Whether two names are the same one: names differing in case only are. */
const sameName = (a: string, b: string) => a.toLocaleLowerCase(intlLocale) === b.toLocaleLowerCase(intlLocale);

/**
 * The saved filters in a stored value. An entry without a name is left out, and so is a second one with a name that is
 * taken; so are the entries after the first `MAX_SAVED`. What is wrong in the rest of an entry is replaced by the
 * defaults, field by field.
 */
export function readSaved(value: unknown): SavedPlayerFilter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const saved: SavedPlayerFilter[] = [];
  for (const entry of value) {
    if (saved.length >= MAX_SAVED) {
      break;
    }
    if (!isRecord(entry) || typeof entry.name !== "string") {
      continue;
    }
    const name = cleanName(entry.name);
    if (name === "" || saved.some((other) => sameName(other.name, name))) {
      continue;
    }
    saved.push({ name, fields: readFields(entry.fields), order: readOrder(entry.order) });
  }
  return saved;
}

/** Whether the filter bar and the sort are as `saved` has them. */
export function isInEffect(saved: SavedPlayerFilter, fields: PlayerFilterFields, order: PlayerOrder | null): boolean {
  const keys = Object.keys(NO_PLAYER_FILTERS) as (keyof PlayerFilterFields)[];
  const sameOrder =
    saved.order === null || order === null
      ? saved.order === order
      : saved.order.by === order.by && saved.order.ascending === order.ascending;
  return sameOrder && keys.every((key) => saved.fields[key] === fields[key]);
}

/** The filters kept from earlier; none when nothing is kept or it cannot be read. */
function readStored(): SavedPlayerFilter[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? [] : readSaved(JSON.parse(stored));
  } catch {
    return [];
  }
}

function writeStored(saved: readonly SavedPlayerFilter[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Without storage the filters last until the window is closed.
  }
}

/** The saved filters, and what can be done to them. */
export interface SavedFilterList {
  /** In the order they were saved. */
  saved: readonly SavedPlayerFilter[];
  /** Whether a saved filter has this name (as `save` and `remove` take it: case aside). */
  has: (name: string) => boolean;
  /**
   * Keeps the filter under `name`, in place of the one that has the name already. False, and nothing kept, when the
   * name is a new one and `MAX_SAVED` filters are kept.
   */
  save: (name: string, fields: PlayerFilterFields, order: PlayerOrder | null) => boolean;
  remove: (name: string) => void;
}

/** The saved filters: read once, when the filter bar is first shown, and written back at every change. */
export function useSavedFilters(): SavedFilterList {
  const [saved, setSaved] = useState<readonly SavedPlayerFilter[]>(readStored);

  const change = (next: readonly SavedPlayerFilter[]) => {
    setSaved(next);
    writeStored(next);
  };

  return {
    saved,
    has: (name) => saved.some((entry) => sameName(entry.name, name)),
    save: (name, fields, order) => {
      const kept = cleanName(name);
      const index = saved.findIndex((entry) => sameName(entry.name, kept));
      if (kept === "" || (index < 0 && saved.length >= MAX_SAVED)) {
        return false;
      }
      const entry: SavedPlayerFilter = { name: kept, fields: { ...fields }, order: order && { ...order } };
      change(index < 0 ? [...saved, entry] : saved.map((old, at) => (at === index ? entry : old)));
      return true;
    },
    remove: (name) => change(saved.filter((entry) => !sameName(entry.name, name))),
  };
}
