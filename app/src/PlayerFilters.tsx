import type { ReactNode } from "react";
import { AttributeFilters, PLAYER_ATTRIBUTES } from "./AttributeFilters";
import {
  AbilityInput,
  AgeInputs,
  CheckInput,
  ContractEndInput,
  countPersonFilters,
  FilterBar,
  GenderInput,
  NO_PERSON_FILTERS,
  TextInput,
  toPersonFilter,
  type PersonFilterFields,
} from "./FilterBar";
import { playerListText, POSITION_LABELS, type PositionKey } from "./labels";
import type { PlayerFilter } from "./types";

const text = playerListText.filters;

/** The positions in the select, from the goal to the front; their labels are in `POSITION_LABELS`. */
export const POSITION_ORDER: readonly PositionKey[] = [
  "gk", "sw", "dl", "dc", "dr", "wbl", "wbr", "dm", "ml", "mc", "mr", "aml", "amc", "amr", "st",
];

/** What the filter inputs hold, as typed: an empty string, or `false`, is no filter. */
export interface PlayerFilterFields extends PersonFilterFields {
  /** A position key. */
  position: string;
  freeAgents: boolean;
  transferListed: boolean;
  loanListed: boolean;
}

export const NO_PLAYER_FILTERS: PlayerFilterFields = {
  ...NO_PERSON_FILTERS,
  position: "",
  freeAgents: false,
  transferListed: false,
  loanListed: false,
};

/** The filter the inputs ask for, or `undefined` while none is in effect. */
export function toPlayerFilter(fields: PlayerFilterFields): PlayerFilter | undefined {
  const filter: PlayerFilter = {
    ...toPersonFilter(fields),
    position: fields.position || undefined,
    freeAgents: fields.freeAgents || undefined,
    transferListed: fields.transferListed || undefined,
    loanListed: fields.loanListed || undefined,
  };
  return countFilters(filter) > 0 ? filter : undefined;
}

/** How many filters are in effect; the two ends of the age range count as one, and each attribute bound as one. */
export function countFilters(filter: PlayerFilter | undefined): number {
  if (!filter) {
    return 0;
  }
  const single = [filter.position, filter.freeAgents, filter.transferListed, filter.loanListed].filter(
    (value) => value !== undefined,
  ).length;
  return single + countPersonFilters(filter);
}

interface PlayerFilterBarProps {
  fields: PlayerFilterFields;
  onChange: (fields: PlayerFilterFields) => void;
  /** How many filters are in effect, from `countFilters`. */
  active: number;
  /** Whether the game's layout tells women from men: only then is there a choice between them. */
  genderKnown: boolean;
  /** More controls after Clear in the head of the bar, e.g. those of the saved filters. */
  actions?: ReactNode;
}

/** The filter bar of the player list: a button with the number of filters in effect, and the inputs behind it. */
export function PlayerFilterBar({ fields, onChange, active, genderKnown, actions }: PlayerFilterBarProps) {
  const set = <K extends keyof PlayerFilterFields>(key: K, value: PlayerFilterFields[K]) =>
    onChange({ ...fields, [key]: value });
  const input = <K extends keyof PlayerFilterFields>(key: K) => ({
    value: fields[key],
    onChange: (value: PlayerFilterFields[K]) => set(key, value),
  });

  return (
    <FilterBar active={active} onClear={() => onChange(NO_PLAYER_FILTERS)} actions={actions}>
      <label className="filter-field">
        <span>{text.position}</span>
        <select value={fields.position} onChange={(e) => set("position", e.currentTarget.value)}>
          <option value="">{text.any}</option>
          {POSITION_ORDER.map((key) => (
            <option key={key} value={key}>
              {POSITION_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      {genderKnown && <GenderInput {...input("gender")} />}
      <AgeInputs min={input("minAge")} max={input("maxAge")} />
      <AbilityInput label={text.minCurrentAbility} title={text.minCurrentAbilityTitle} {...input("minCurrentAbility")} />
      <AbilityInput
        label={text.minPotentialAbility}
        title={text.minPotentialAbilityTitle}
        {...input("minPotentialAbility")}
      />
      <TextInput label={text.nation} {...input("nation")} />
      <TextInput label={text.club} {...input("club")} />
      <CheckInput label={text.freeAgentsOnly} {...input("freeAgents")} />
      <ContractEndInput {...input("contractExpiresBy")} />
      <CheckInput label={text.transferListedOnly} {...input("transferListed")} />
      <CheckInput label={text.loanListedOnly} {...input("loanListed")} />
      <AttributeFilters
        rows={fields.attributes}
        choices={PLAYER_ATTRIBUTES}
        onChange={(rows) => set("attributes", rows)}
      />
    </FilterBar>
  );
}
