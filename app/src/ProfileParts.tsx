import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Ability } from "./Ability";
import { call } from "./api";
import { EditableValue, EditBar, EditButton, EditInput } from "./EditControls";
import { converts } from "./currency";
import { formatDate, formatMoney, formatNumber } from "./format";
import { PERSONALITY_LABELS, profileText, type PersonalityKey } from "./labels";
import { PanelResizer, usePanelWidth } from "./PanelResizer";
import type { Attribute, FmDate, Reputation } from "./types";
import { useModal } from "./useModal";
import { SessionContext, useEditableField, type ProfileEditing } from "./useProfileEditing";

// What the player, staff and club profiles have in common: the panel frame, loading, rating rows and
// the label/value blocks. The frame also holds what editing adds to a profile (see EditControls).

/** Reputation is stored on a 0–10000 scale. */
const REPUTATION_MAX = 10000;

export type Loaded<T> = { details: T; error?: undefined } | { details?: undefined; error: string };

/** What ties a tab to its panel for assistive technology: the panel's own id, and the id of the tab that names it. */
export interface PanelIds {
  id: string;
  labelledBy: string;
}

/** Loads a profile with `command`, and again when `version` changes: the game data was read again. */
export function useProfileDetails<T>(command: string, uid: number, version: number): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const details = await call<T>(command, { uid });
        if (!cancelled) {
          setLoaded({ details });
        }
      } catch (e) {
        if (!cancelled) {
          setLoaded({ error: String(e) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [command, uid, version]);

  return loaded;
}

interface ProfileFrameProps {
  /** Left of the names: a person's face, or a club's logo. */
  picture?: ReactNode;
  name: string;
  /** A second name under the name when it differs: a person's full name, a club's short name. */
  fullName: string | null;
  /** Sits beside the name. */
  badge?: ReactNode;
  /** The line under the names; a profile with nothing to say there leaves it out. */
  meta?: ReactNode;
  /**
   * The small print under that, e.g. the birth date: its parts, set apart by dots, each kept on one line. A part may
   * hold an input, which takes the place of its value while the profile is edited.
   */
  vitals: ReadonlyArray<ReactNode>;
  /** The abilities of a person, under the close button; inputs where they are while the person is edited. */
  currentAbility?: number;
  potentialAbility?: number;
  /** Under the close button instead of the abilities, e.g. the reputation of a club. */
  side?: ReactNode;
  /** Buttons before Edit in the header, e.g. the player's Compare button. */
  actions?: ReactNode;
  /** Between the header and the body, so that it stays in view while the body scrolls: the tabs of a club. */
  tabs?: ReactNode;
  /** For a body that holds a table, such as a club's squad: the panel takes more of the window than a profile does. */
  wide?: boolean;
  /**
   * A dialog over the window instead of a panel beside a list, as a player opened from a club's squad is: Tab and
   * Escape stay in it (see `useModal`), and it has no handle to resize it.
   */
  modal?: boolean;
  loaded: Loaded<unknown> | null;
  onClose: () => void;
  /**
   * The editing of a profile, from `useProfileEditing`: it adds the Edit button, the footer and the inputs (of the
   * body, and of the header too: see `side`), and makes closing the profile ask first while changes are pending.
   */
  editing?: ProfileEditing;
  /** The body, once the profile has loaded. */
  children?: ReactNode;
}

/**
 * The panel beside a list, or a dialog over the window (`modal`): header with the abilities (or another summary, as
 * `side`) and a close button, and a scrolling body that shows the loading state or error. Mount it with `key={uid}` so
 * a new person starts at the top.
 */
export function ProfileFrame(props: ProfileFrameProps) {
  const { picture, name, fullName, badge, meta, vitals, currentAbility, potentialAbility } = props;
  const { side, actions, tabs, wide, modal = false, loaded, onClose, editing, children } = props;
  const closeProfile = editing ? () => editing.guardClose(onClose) : onClose;
  const onEscape = editing ? () => editing.escape(onClose) : onClose;
  const panelWidth = usePanelWidth(wide ? "wide" : "profile");
  const section = useRef<HTMLElement>(null);

  // A dialog keeps Escape from the profile behind it, which would close too, and takes focus when it opens.
  useModal(section, true, onEscape, modal);
  useEffect(() => {
    if (modal) {
      section.current?.focus();
    }
  }, [modal]);

  useEffect(() => {
    if (modal) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        onEscape();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onEscape, modal]);

  // The inputs reach the whole panel, so `side` can hold one too (a club's reputation is in the header).
  return (
    <SessionContext.Provider value={editing?.session ?? null}>
      <section
        ref={section}
        className={["profile", editing?.stage === "edit" && "editing", wide && "wide", modal && "popup"]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={name}
        aria-busy={!loaded}
        tabIndex={modal ? -1 : undefined}
        style={modal ? undefined : panelWidth.style}
      >
        {!modal && <PanelResizer panelWidth={panelWidth} />}
        <header className="profile-head">
          {picture}
          <div className="profile-id">
            <h2>
              {name}
              {badge}
            </h2>
            {fullName && fullName !== name && <p className="profile-fullname">{fullName}</p>}
            {meta !== undefined && <p className="profile-meta">{meta}</p>}
            <p className="profile-vitals">
              {/* The dot stays at the end of a line, with the part before it. */}
              {vitals.filter(Boolean).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && " · "}
                  <span className="vital">{part}</span>
                </Fragment>
              ))}
            </p>
          </div>
          <div className="profile-side">
            <div className="profile-actions">
              {actions}
              {editing && <EditButton editing={editing} ready={loaded?.details !== undefined} />}
              <button
                className="icon-button"
                onClick={closeProfile}
                aria-label={profileText.close}
                title={profileText.close}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
            {side ??
              (currentAbility !== undefined && potentialAbility !== undefined && (
                <div className="profile-abilities">
                  <abbr title={profileText.currentAbility}>{profileText.currentAbilityShort}</abbr>
                  <EditableValue field="current_ability">
                    <Ability value={currentAbility} />
                  </EditableValue>
                  <abbr title={profileText.potentialAbility}>{profileText.potentialAbilityShort}</abbr>
                  <EditableValue field="potential_ability">
                    <Ability value={potentialAbility} />
                  </EditableValue>
                </div>
              ))}
          </div>
        </header>

        {tabs}

        <div className="profile-body">
          {!loaded && (
            <p className="profile-status" role="status">
              {profileText.loading}
            </p>
          )}
          {loaded?.error !== undefined && (
            <div className="banner" role="alert">
              {loaded.error}
            </div>
          )}
          {children}
        </div>

        {editing && <EditBar editing={editing} />}
      </section>
    </SessionContext.Provider>
  );
}

/**
 * "Born 26 Mar 1982 (age 44)", for a person whose birth date is known; the date is an input while it can be edited.
 */
export function Born({ dateOfBirth, age }: { dateOfBirth: FmDate; age: number | null }) {
  return (
    <>
      {profileText.born} <EditableValue field="date_of_birth">{formatDate(dateOfBirth)}</EditableValue>
      {age !== null && ` (${profileText.age(age)})`}
    </>
  );
}

export interface RatingRow {
  key: string;
  /** The key of the editable field behind the row, e.g. "attribute.finishing"; while editing, its value is an input. */
  field?: string;
  label: string;
  value: number | undefined;
  /** Hover text, e.g. the value as stored. */
  title?: string;
  /** A low value is the good one, so the colours run the other way. */
  lowerIsBetter?: boolean;
}

/** Ratings where a low value is the good one. */
export const LOWER_IS_BETTER = new Set<string>(["injury_proneness", "dirtiness", "controversy"]);

const PERSONALITY: PersonalityKey[] = [
  "adaptability", "ambition", "loyalty", "pressure", "professionalism", "sportsmanship", "temperament", "controversy",
];

/** An attribute as FM shows it (1–20), with the value as stored in the hover text. */
export function attributeRow(
  key: string,
  label: string,
  attribute: Attribute | undefined,
  options: { lowerIsBetter?: boolean; scale?: number } = {},
): RatingRow {
  const { lowerIsBetter = false, scale } = options;
  const notes = [attribute && profileText.raw(attribute.raw, scale), lowerIsBetter && profileText.lowerIsBetter];
  return {
    key,
    field: `attribute.${key}`,
    label,
    value: attribute?.value,
    title: notes.filter(Boolean).join(" · ") || undefined,
    lowerIsBetter,
  };
}

export function personalityRows(personality: Record<string, number>): RatingRow[] {
  return PERSONALITY.map((key) => {
    const lowerIsBetter = LOWER_IS_BETTER.has(key);
    return {
      key,
      field: `personality.${key}`,
      label: PERSONALITY_LABELS[key],
      value: personality[key],
      title: lowerIsBetter ? profileText.lowerIsBetter : undefined,
      lowerIsBetter,
    };
  });
}

/** FM's colour bands for a 1–20 rating: 1–5, 6–10, 11–15 and 16–20. */
export function tierClass(value: number, lowerIsBetter = false): string {
  const score = lowerIsBetter ? 21 - value : value;
  return `tier-${score <= 5 ? 1 : score <= 10 ? 2 : score <= 15 ? 3 : 4}`;
}

/** The rows of a rating group: a label and the value on a chip coloured by band, or an input while editing. */
export function RatingList({ rows }: { rows: RatingRow[] }) {
  return (
    <dl className="stats ratings">
      {rows.map((row) => (
        <RatingItem key={row.key} row={row} />
      ))}
    </dl>
  );
}

function RatingItem({ row }: { row: RatingRow }) {
  const editing = useEditableField(row.field);
  return (
    <div className="stat" title={row.title}>
      <dt>{row.label}</dt>
      {editing && row.field ? (
        <dd className="edit-cell">
          <EditInput field={row.field} />
        </dd>
      ) : (
        <dd className={row.value === undefined ? "value" : `value ${tierClass(row.value, row.lowerIsBetter)}`}>
          {row.value ?? profileText.none}
        </dd>
      )}
    </div>
  );
}

export function RatingGroup({ title, rows }: { title: string; rows: RatingRow[] }) {
  return (
    <section className="profile-group">
      <h3>{title}</h3>
      <RatingList rows={rows} />
    </section>
  );
}

export function Fact({ label, title, children }: { label: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="stat" title={title}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The weekly wage, with the note that the game stores it in pounds; an input while the wage can be edited. */
export function WageFact({ wage }: { wage: number }) {
  return (
    <>
      <dl className="stats">
        <Fact label={profileText.wage}>
          <EditableValue field="contract.wage">{formatMoney(wage)}</EditableValue>
        </Fact>
      </dl>
      <p className="note">{profileText.wageNote(converts)}</p>
    </>
  );
}

/** When the contract was signed, ends and began; the end is a date input while it can be edited. */
export function ContractDates({
  contract,
}: {
  contract: { signed: FmDate | null; expires: FmDate | null; joined: FmDate | null };
}) {
  const date = (value: FmDate | null) => formatDate(value) || profileText.none;
  return (
    <dl className="stats">
      <Fact label={profileText.signed}>{date(contract.signed)}</Fact>
      <Fact label={profileText.expires}>
        <EditableValue field="contract.expires">{date(contract.expires)}</EditableValue>
      </Fact>
      <Fact label={profileText.joined}>{date(contract.joined)}</Fact>
    </dl>
  );
}

/** Home, current and world reputation as bars; the figures are inputs while the person is edited. */
export function ReputationBars({ reputation }: { reputation: Reputation }) {
  return (
    <dl className="stats">
      <ReputationBar label={profileText.reputationHome} value={reputation.home} field="reputation.home" />
      <ReputationBar label={profileText.reputationCurrent} value={reputation.current} field="reputation.current" />
      <ReputationBar label={profileText.reputationWorld} value={reputation.world} field="reputation.world" />
    </dl>
  );
}

function ReputationBar({ label, value, field }: { label: string; value: number; field: string }) {
  const style = { "--fill": reputationFill(value) } as CSSProperties;
  return (
    <div className="stat bar-stat">
      <dt>{label}</dt>
      <dd>
        <span className="bar" style={style} aria-hidden="true" />
        <EditableValue field={field}>
          <span className="figure">{formatNumber(value)}</span>
        </EditableValue>
      </dd>
    </div>
  );
}

/** How much of a bar a reputation fills, as a CSS length. */
function reputationFill(value: number): string {
  return `${Math.min(100, (value * 100) / REPUTATION_MAX)}%`;
}

/**
 * One reputation as a compact bar with the number on it, in the style of the abilities; a dash
 * when the reputation is unknown. For the club list and the club header.
 */
export function ReputationMeter({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="muted">{profileText.none}</span>;
  }
  const style = { "--fill": reputationFill(value) } as CSSProperties;
  return (
    <span className="ability rep" style={style}>
      {formatNumber(value)}
    </span>
  );
}
