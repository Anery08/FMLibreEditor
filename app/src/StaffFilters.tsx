import type { ReactNode } from "react";
import { AttributeFilters, STAFF_ATTRIBUTES } from "./AttributeFilters";
import {
  AbilityInput,
  AgeInputs,
  CheckInput,
  ContractEndInput,
  countPersonFilters,
  FilterBar,
  GenderInput,
  NO_PERSON_FILTERS,
  readPersonFields,
  TextInput,
  toPersonFilter,
  type PersonFilterFields,
} from "./FilterBar";
import { JOB_FILTER_OPTIONS, playerListText, staffListText } from "./labels";
import { isRecord } from "./restore";
import type { StaffFilter } from "./types";

const text = playerListText.filters;
const staffText = staffListText.filters;

/** What the filter inputs of the staff list hold, as typed: an empty string, or `false`, is no filter. */
export interface StaffFilterFields extends PersonFilterFields {
  /** A job code as the select holds it, or "" for any. */
  job: string;
  unemployed: boolean;
}

export const NO_STAFF_FILTERS: StaffFilterFields = { ...NO_PERSON_FILTERS, job: "", unemployed: false };

/** The filter the inputs ask for, or `undefined` while none is in effect. */
export function toStaffFilter(fields: StaffFilterFields): StaffFilter | undefined {
  const filter: StaffFilter = {
    ...toPersonFilter(fields),
    job: fields.job === "" ? undefined : Number(fields.job),
    unemployed: fields.unemployed || undefined,
  };
  return countStaffFilters(filter) > 0 ? filter : undefined;
}

/** How many filters are in effect, counted as the player list counts them. */
export function countStaffFilters(filter: StaffFilter | undefined): number {
  if (!filter) {
    return 0;
  }
  return [filter.job, filter.unemployed].filter((value) => value !== undefined).length + countPersonFilters(filter);
}

/**
 * The inputs as they were before the language was switched (see `restore.ts`); a field that is missing or is not what
 * the bar holds is empty.
 */
export function readStaffFields(value: unknown): StaffFilterFields {
  const given = isRecord(value) ? value : {};
  return {
    ...readPersonFields(given, STAFF_ATTRIBUTES),
    job:
      typeof given.job === "string" && JOB_FILTER_OPTIONS.some(({ code }) => String(code) === given.job)
        ? given.job
        : NO_STAFF_FILTERS.job,
    unemployed: given.unemployed === true,
  };
}

interface StaffFilterBarProps {
  fields: StaffFilterFields;
  onChange: (fields: StaffFilterFields) => void;
  /** How many filters are in effect, from `countStaffFilters`. */
  active: number;
  /** Whether the game's layout tells women from men: only then is there a choice between them. */
  genderKnown: boolean;
  /** More controls after Clear in the head of the bar: those of the saved filters. */
  actions?: ReactNode;
}

/** The filter bar of the staff list: the player list's, with the job instead of the position. */
export function StaffFilterBar({ fields, onChange, active, genderKnown, actions }: StaffFilterBarProps) {
  const set = <K extends keyof StaffFilterFields>(key: K, value: StaffFilterFields[K]) =>
    onChange({ ...fields, [key]: value });
  const input = <K extends keyof StaffFilterFields>(key: K) => ({
    value: fields[key],
    onChange: (value: StaffFilterFields[K]) => set(key, value),
  });

  return (
    <FilterBar active={active} onClear={() => onChange(NO_STAFF_FILTERS)} actions={actions}>
      <label className="filter-field">
        <span>{staffText.job}</span>
        <select value={fields.job} onChange={(e) => set("job", e.currentTarget.value)}>
          <option value="">{staffText.anyJob}</option>
          {JOB_FILTER_OPTIONS.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {genderKnown && <GenderInput {...input("gender")} />}
      <AgeInputs min={input("minAge")} max={input("maxAge")} />
      <AbilityInput
        label={text.minCurrentAbility}
        title={text.minCurrentAbilityTitle}
        {...input("minCurrentAbility")}
      />
      <AbilityInput
        label={text.minPotentialAbility}
        title={text.minPotentialAbilityTitle}
        {...input("minPotentialAbility")}
      />
      <TextInput label={text.nation} {...input("nation")} />
      <TextInput label={text.club} {...input("club")} />
      <CheckInput label={staffText.unemployedOnly} {...input("unemployed")} />
      <ContractEndInput {...input("contractExpiresBy")} />
      <AttributeFilters
        rows={fields.attributes}
        choices={STAFF_ATTRIBUTES}
        onChange={(rows) => set("attributes", rows)}
      />
    </FilterBar>
  );
}
