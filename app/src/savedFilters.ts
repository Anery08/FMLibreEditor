// The filters the user saved under a name, in the player list and in the staff list: what is kept, how it is read back,
// and the hook the filter bars use. Each list keeps its own. They are kept in `localStorage`, which anyone can edit and
// which can be unavailable (a private window, blocked site data): every access is guarded, and every entry is checked
// field by field, with a default for what is wrong.

import { useState } from "react";
import { PLAYER_ATTRIBUTES } from "./AttributeFilters";
import { readPersonFields, textOr } from "./FilterBar";
import { intlLocale } from "./i18n";
import { NO_PLAYER_FILTERS, POSITION_ORDER, type PlayerFilterFields } from "./PlayerFilters";
import { isRecord } from "./restore";
import type { ColumnOrder } from "./SortHeader";
import { NO_STAFF_FILTERS, readStaffFields, type StaffFilterFields } from "./StaffFilters";
import type { PlayerOrder, PlayerSort, StaffOrder, StaffSort } from "./types";

/** The most filters a list keeps, and the longest name one has. */
export const MAX_SAVED = 20;
export const MAX_NAME_LENGTH = 50;

/** A filter the user saved: what the filter bar held and how the list was sorted, under a name of the user's own. */
export interface SavedFilter<Fields, Order> {
  /** As the user typed it. */
  name: string;
  fields: Fields;
  /** The sort a column header was clicked for; null for the order the list starts in. */
  order: Order | null;
}

/** What one list's saved filters are: where they are kept, and how what is kept there is read back. */
export interface SavedFilterKind<Fields, Order> {
  /** Where they are kept: a JSON array of `SavedFilter`. */
  storageKey: string;
  /** The bar with no filter in it, whose fields a saved filter is compared by. */
  none: Fields;
  readFields: (value: unknown) => Fields;
  readOrder: (value: unknown) => Order | null;
}

/** Every sort of each list; the types make the build fail when a sort is added without being listed here. */
const PLAYER_SORTS: Record<PlayerSort, true> = {
  currentAbility: true,
  potentialAbility: true,
  age: true,
  name: true,
  nation: true,
  club: true,
  contractExpires: true,
};
const STAFF_SORTS: Record<StaffSort, true> = {
  currentAbility: true,
  potentialAbility: true,
  age: true,
  name: true,
  nation: true,
  club: true,
};

const POSITION_KEYS: ReadonlySet<string> = new Set(POSITION_ORDER);

/**
 * The fields of the player filter bar from a stored value; a field that is missing or is not what the bar holds is
 * empty. It also brings the bar back after the language was switched (see `restore.ts`).
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

/** The sort from a stored value, if it is one of `sorts`; the list's own order when it is missing or is not a sort. */
function readSort<Sort extends string>(value: unknown, sorts: Record<Sort, true>): ColumnOrder<Sort> | null {
  if (
    isRecord(value) &&
    typeof value.by === "string" &&
    Object.prototype.hasOwnProperty.call(sorts, value.by) &&
    typeof value.ascending === "boolean"
  ) {
    return { by: value.by as Sort, ascending: value.ascending };
  }
  return null;
}

/** The sort of the player list from a stored value. It also brings the sort back after the language was switched. */
export const readOrder = (value: unknown): PlayerOrder | null => readSort(value, PLAYER_SORTS);

/** The sort of the staff list, likewise. */
export const readStaffOrder = (value: unknown): StaffOrder | null => readSort(value, STAFF_SORTS);

export const PLAYER_FILTERS: SavedFilterKind<PlayerFilterFields, PlayerOrder> = {
  storageKey: "fmlibre.savedPlayerFilters",
  none: NO_PLAYER_FILTERS,
  readFields,
  readOrder,
};

export const STAFF_FILTERS: SavedFilterKind<StaffFilterFields, StaffOrder> = {
  storageKey: "fmlibre.savedStaffFilters",
  none: NO_STAFF_FILTERS,
  readFields: readStaffFields,
  readOrder: readStaffOrder,
};

/** A name as it is kept: without the spaces around it, and no longer than a name may be. */
export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** Whether two names are the same one: names differing in case only are. */
const sameName = (a: string, b: string) => a.toLocaleLowerCase(intlLocale) === b.toLocaleLowerCase(intlLocale);

/**
 * The saved filters of a list in a stored value. An entry without a name is left out, and so is a second one with a
 * name that is taken; so are the entries after the first `MAX_SAVED`. What is wrong in the rest of an entry is
 * replaced by the defaults, field by field.
 */
export function readSaved<Fields, Order>(
  kind: SavedFilterKind<Fields, Order>,
  value: unknown,
): SavedFilter<Fields, Order>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const saved: SavedFilter<Fields, Order>[] = [];
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
    saved.push({ name, fields: kind.readFields(entry.fields), order: kind.readOrder(entry.order) });
  }
  return saved;
}

/** Whether the filter bar and the sort are as `saved` has them. */
export function isInEffect<Fields extends object, Order extends ColumnOrder<string>>(
  kind: SavedFilterKind<Fields, Order>,
  saved: SavedFilter<Fields, Order>,
  fields: Fields,
  order: Order | null,
): boolean {
  const keys = Object.keys(kind.none) as (keyof Fields)[];
  const sameOrder =
    saved.order === null || order === null
      ? saved.order === order
      : saved.order.by === order.by && saved.order.ascending === order.ascending;
  return sameOrder && keys.every((key) => saved.fields[key] === fields[key]);
}

/** The filters kept from earlier; none when nothing is kept or it cannot be read. */
function readStored<Fields, Order>(kind: SavedFilterKind<Fields, Order>): SavedFilter<Fields, Order>[] {
  try {
    const stored = window.localStorage.getItem(kind.storageKey);
    return stored === null ? [] : readSaved(kind, JSON.parse(stored));
  } catch {
    return [];
  }
}

function writeStored<Fields, Order>(
  kind: SavedFilterKind<Fields, Order>,
  saved: readonly SavedFilter<Fields, Order>[],
): void {
  try {
    window.localStorage.setItem(kind.storageKey, JSON.stringify(saved));
  } catch {
    // Without storage the filters last until the window is closed.
  }
}

/** The saved filters of a list, and what can be done to them. */
export interface SavedFilterList<Fields, Order> {
  /** In the order they were saved. */
  saved: readonly SavedFilter<Fields, Order>[];
  /** Whether a saved filter has this name (as `save` and `remove` take it: case aside). */
  has: (name: string) => boolean;
  /**
   * Keeps the filter under `name`, in place of the one that has the name already. False, and nothing kept, when the
   * name is a new one and `MAX_SAVED` filters are kept.
   */
  save: (name: string, fields: Fields, order: Order | null) => boolean;
  remove: (name: string) => void;
}

/**
 * The saved filters of the list `kind` is for: read once, when its filter bar is first shown, and written back at every
 * change.
 */
export function useSavedFilters<Fields extends object, Order extends object>(
  kind: SavedFilterKind<Fields, Order>,
): SavedFilterList<Fields, Order> {
  const [saved, setSaved] = useState<readonly SavedFilter<Fields, Order>[]>(() => readStored(kind));

  const change = (next: readonly SavedFilter<Fields, Order>[]) => {
    setSaved(next);
    writeStored(kind, next);
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
      const entry: SavedFilter<Fields, Order> = { name: kept, fields: { ...fields }, order: order && { ...order } };
      change(index < 0 ? [...saved, entry] : saved.map((old, at) => (at === index ? entry : old)));
      return true;
    },
    remove: (name) => change(saved.filter((entry) => !sameName(entry.name, name))),
  };
}
