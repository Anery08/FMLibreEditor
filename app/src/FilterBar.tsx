// The filter bar of the player and staff lists: a button that shows or hides the filters, with how many are in effect,
// and Clear. Under it, the filters the two lists share (whom to show, age, abilities, nation, club, contract end and
// attributes), between which each list puts its own (see PlayerFilters.tsx and StaffFilters.tsx).

import { useId, useRef, useState, type ReactNode } from "react";
import { readAttributeRows, toAttributeBounds, type AttributeChoices, type AttributeRow } from "./AttributeFilters";
import { playerListText } from "./labels";
import type { FmDate, PersonFilter } from "./types";

const text = playerListText.filters;

/** What the number inputs hold, at most: ability is 1–200; the ages only keep absurd numbers out of the request. */
const AGE_RANGE = { min: 0, max: 99 };
const ABILITY_RANGE = { min: 1, max: 200 };

/** Whom the list shows: everyone (""), only men, or only women. */
export type Gender = "" | "men" | "women";

/** The filters both lists have, as their inputs hold them: an empty string is no filter. */
export interface PersonFilterFields {
  gender: Gender;
  minAge: string;
  maxAge: string;
  minCurrentAbility: string;
  minPotentialAbility: string;
  nation: string;
  club: string;
  /** `YYYY-MM-DD`, as a date input holds it. */
  contractExpiresBy: string;
  attributes: AttributeRow[];
}

export const NO_PERSON_FILTERS: PersonFilterFields = {
  gender: "",
  minAge: "",
  maxAge: "",
  minCurrentAbility: "",
  minPotentialAbility: "",
  nation: "",
  club: "",
  contractExpiresBy: "",
  attributes: [],
};

/** A whole number within `range`; nothing for an empty or unreadable input. */
function whole(input: string, range: { min: number; max: number }): number | undefined {
  if (input.trim() === "") {
    return undefined;
  }
  const value = Number(input);
  return Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value))) : undefined;
}

/** A date input's `YYYY-MM-DD` as the game's date; nothing until the whole date is there. */
function toFmDate(input: string): FmDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : undefined;
}

/** What the shared inputs ask for; a field with nothing in it is left out. */
export function toPersonFilter(fields: PersonFilterFields): PersonFilter {
  return {
    women: fields.gender === "" ? undefined : fields.gender === "women",
    minAge: whole(fields.minAge, AGE_RANGE),
    maxAge: whole(fields.maxAge, AGE_RANGE),
    minCurrentAbility: whole(fields.minCurrentAbility, ABILITY_RANGE),
    minPotentialAbility: whole(fields.minPotentialAbility, ABILITY_RANGE),
    nation: fields.nation.trim() || undefined,
    club: fields.club.trim() || undefined,
    contractExpiresBy: toFmDate(fields.contractExpiresBy),
    attributes: toAttributeBounds(fields.attributes),
  };
}

/**
 * How many of the shared filters are in effect; the two ends of the age range count as one, and each attribute bound
 * as one.
 */
export function countPersonFilters(filter: PersonFilter): number {
  const single = [
    filter.women,
    filter.minAge ?? filter.maxAge,
    filter.minCurrentAbility,
    filter.minPotentialAbility,
    filter.nation,
    filter.club,
    filter.contractExpiresBy,
  ].filter((value) => value !== undefined).length;
  return single + (filter.attributes?.length ?? 0);
}

/** What the filter inputs can hold at the most, however a stored value got there. */
const MAX_TEXT_LENGTH = 200;

/** A date input's `YYYY-MM-DD`. */
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** A number as a number input holds it: empty, or something `Number` reads. */
const isNumberText = (text: string) => text.trim() === "" || Number.isFinite(Number(text));

/** `value` when it is a text that `fits`, `fallback` otherwise. */
export function textOr(value: unknown, fallback: string, fits: (text: string) => boolean = () => true): string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH && fits(value) ? value : fallback;
}

/**
 * The shared fields from a stored value (a saved filter, or the bar before the language was switched); a field that
 * is missing or is not what the bar holds is empty. `choices` are the attributes of the list's people.
 */
export function readPersonFields(given: Record<string, unknown>, choices: AttributeChoices): PersonFilterFields {
  const none = NO_PERSON_FILTERS;
  return {
    gender: given.gender === "men" || given.gender === "women" ? given.gender : none.gender,
    minAge: textOr(given.minAge, none.minAge, isNumberText),
    maxAge: textOr(given.maxAge, none.maxAge, isNumberText),
    minCurrentAbility: textOr(given.minCurrentAbility, none.minCurrentAbility, isNumberText),
    minPotentialAbility: textOr(given.minPotentialAbility, none.minPotentialAbility, isNumberText),
    nation: textOr(given.nation, none.nation),
    club: textOr(given.club, none.club),
    contractExpiresBy: textOr(
      given.contractExpiresBy,
      none.contractExpiresBy,
      (text) => text === "" || DATE_TEXT.test(text),
    ),
    attributes: readAttributeRows(given.attributes, choices),
  };
}

interface FilterBarProps {
  /** How many filters are in effect. */
  active: number;
  /** Takes every filter away. */
  onClear: () => void;
  /** More controls after Clear in the head of the bar, e.g. those of the saved filters. */
  actions?: ReactNode;
  /** The inputs, shown while the bar is open. */
  children: ReactNode;
}

/** The head of the bar, with the inputs under it while it is open. */
export function FilterBar({ active, onClear, actions, children }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <div className="filter-bar">
      <div className="filter-head">
        <button
          ref={toggle}
          type="button"
          className="filter-toggle"
          aria-expanded={open}
          aria-label={active > 0 ? text.toggleActive(active) : undefined}
          onClick={() => setOpen(!open)}
        >
          {text.toggle}
          {active > 0 && <span className="filter-count">{active}</span>}
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 8 5 5 5-5" />
          </svg>
        </button>
        {active > 0 && (
          <button
            type="button"
            className="filter-clear"
            onClick={() => {
              onClear();
              // This button goes away with the filters: keep keyboard focus on the bar.
              toggle.current?.focus();
            }}
          >
            {text.clear}
          </button>
        )}
        {actions}
      </div>

      {open && <div className="filter-fields">{children}</div>}
    </div>
  );
}

/** The inputs of one shared filter: what it holds now, and what to call with what was typed or picked. */
interface InputProps<T> {
  value: T;
  onChange: (value: T) => void;
}

/** Whom to show: everyone, men or women. */
export function GenderInput({ value, onChange }: InputProps<Gender>) {
  return (
    <label className="filter-field">
      <span>{text.gender}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value as Gender)}>
        <option value="">{text.any}</option>
        <option value="men">{text.men}</option>
        <option value="women">{text.women}</option>
      </select>
    </label>
  );
}

/** The youngest and the oldest, side by side under one label. */
export function AgeInputs({ min, max }: { min: InputProps<string>; max: InputProps<string> }) {
  const label = useId();
  return (
    <div className="filter-field" role="group" aria-labelledby={label}>
      <span id={label}>{text.age}</span>
      <input
        type="number"
        min={AGE_RANGE.min}
        max={AGE_RANGE.max}
        step={1}
        placeholder={text.minPlaceholder}
        aria-label={text.minAge}
        value={min.value}
        onChange={(e) => min.onChange(e.currentTarget.value)}
      />
      <span aria-hidden="true">–</span>
      <input
        type="number"
        min={AGE_RANGE.min}
        max={AGE_RANGE.max}
        step={1}
        placeholder={text.maxPlaceholder}
        aria-label={text.maxAge}
        value={max.value}
        onChange={(e) => max.onChange(e.currentTarget.value)}
      />
    </div>
  );
}

/** The least current or potential ability: its short name, the long one as hover text. */
export function AbilityInput({ label, title, value, onChange }: InputProps<string> & { label: string; title: string }) {
  return (
    <label className="filter-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        min={ABILITY_RANGE.min}
        max={ABILITY_RANGE.max}
        step={1}
        placeholder={text.abilityPlaceholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

/** Part of a name, e.g. the nation's or the club's. */
export function TextInput({ label, value, onChange }: InputProps<string> & { label: string }) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

/** The last day a contract may end on. */
export function ContractEndInput({ value, onChange }: InputProps<string>) {
  return (
    <label className="filter-field">
      <span>{text.contractEndsBy}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

/** A yes-or-no: the box and its words. */
export function CheckInput({ label, value, onChange }: InputProps<boolean> & { label: string }) {
  return (
    <label className="filter-field">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}
