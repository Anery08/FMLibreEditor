// "Transfer advice": the brief (a position, roles, a purpose, filters) and what the scout recommends for it. The
// tactic is only a shortcut to a position and its roles.

import { useEffect, useMemo, useRef, useState } from "react";
import { toPounds } from "./currency";
import { scoutingSuggest, scoutingTactics } from "./editing";
import { currencySymbol, describeError, formatMoney, formatPercent } from "./format";
import { positionLabel, scoutingText as text } from "./labels";
import { PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import {
  ClubLine,
  familiarity,
  FitBar,
  LINE_OF_POSITION,
  PlayerName,
  ProbabilityHeader,
  reasonText,
  roleAbbreviation,
  RoleAbbreviations,
  roleName,
  signed,
  StatusDot,
  depthLineName,
  shortMoney,
} from "./ScoutParts";
import type {
  DepthLine,
  DepthStatus,
  Fitting,
  Line,
  PlayerSummary,
  Purpose,
  Role,
  ScoutOrder,
  Scouted,
  ScoutingOverview,
  ScoutingTactics,
  ScoutPosition,
  ScoutRequest,
  Suggestion,
  Phase,
} from "./types";

/** What the user asks the scout for; the fields typed into are kept as typed. */
export interface Brief {
  position: string;
  /** A role key; empty for any. */
  inPossession: string;
  outOfPossession: string;
  purpose: Purpose;
  minAge: string;
  maxAge: string;
  /** In the shown currency. */
  maxFee: string;
  minProbability: string;
  noFreeAgents: boolean;
  order: ScoutOrder;
}

export const PURPOSES: Purpose[] = ["firstTeam", "rotation", "future", "any"];
export const ORDERS: ScoutOrder[] = ["score", "fit", "probability", "fee"];
const PROBABILITIES = ["30", "50", "70"];

export const DEFAULT_BRIEF: Brief = {
  position: "",
  inPossession: "",
  outOfPossession: "",
  purpose: "firstTeam",
  minAge: "",
  maxAge: "",
  maxFee: "",
  minProbability: "",
  noFreeAgents: false,
  order: "score",
};

/** The positions in the order of the pitch, attack at the top: [key, column, row]. */
const PITCH: readonly (readonly [string, number, number])[] = [
  ["st", 2, 1],
  ["aml", 1, 2],
  ["amc", 2, 2],
  ["amr", 3, 2],
  ["ml", 1, 3],
  ["mc", 2, 3],
  ["mr", 3, 3],
  ["wbl", 1, 4],
  ["dm", 2, 4],
  ["wbr", 3, 4],
  ["dl", 1, 5],
  ["dc", 2, 5],
  ["dr", 3, 5],
  ["gk", 2, 6],
];

const LINES: Line[] = [
  "goalkeeper",
  "centreBack",
  "fullBack",
  "wingBack",
  "defensiveMidfield",
  "centralMidfield",
  "attackingMidfield",
  "wide",
  "striker",
];

const DEBOUNCE_MS = 300;

/** A whole number from what was typed, or null when it is empty or not a number. */
function wholeNumber(typed: string): number | null {
  const number = typed.trim() === "" ? NaN : Number(typed);
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** The position to start with: the first line that is missing or thin, else the strikers. */
export function defaultPosition(overview: ScoutingOverview): string {
  const needy = overview.report.lines.find((line) => line.status === "missing" || line.status === "thin");
  const wanted = needy?.positions[0] ?? "st";
  return overview.positions.some((p) => p.key === wanted) ? wanted : (overview.positions[0]?.key ?? "st");
}

/** The roles of one phase that are played at a position, grouped by line, the position's own line first. */
function rolesAt(roles: Role[], position: ScoutPosition | undefined, phase: Phase): { line: Line; roles: Role[] }[] {
  const lines = position?.lines ?? LINES;
  return lines
    .map((line) => ({ line, roles: roles.filter((role) => role.phase === phase && role.line === line) }))
    .filter((group) => group.roles.length > 0);
}

const roleAvailable = (roles: Role[], position: ScoutPosition | undefined, phase: Phase, key: string) =>
  rolesAt(roles, position, phase).some((group) => group.roles.some((role) => role.key === key));

interface Props {
  overview: ScoutingOverview;
  /** The data version: the advice is asked for again when it changes. */
  version: number;
  brief: Brief;
  onBrief: (patch: Partial<Brief>) => void;
  onOpen: (player: PlayerSummary) => void;
  hidden: boolean;
}

export function ScoutRecommendations({ overview, version, brief, onBrief, onOpen, hidden }: Props) {
  const position = overview.positions.find((p) => p.key === brief.position);
  const statusOf = useMemo(() => new Map(overview.report.lines.map((line) => [line.key, line])), [overview]);

  const choosePosition = (key: string) => {
    const next = overview.positions.find((p) => p.key === key);
    onBrief({
      position: key,
      inPossession: roleAvailable(overview.roles, next, "inPossession", brief.inPossession) ? brief.inPossession : "",
      outOfPossession: roleAvailable(overview.roles, next, "outOfPossession", brief.outOfPossession)
        ? brief.outOfPossession
        : "",
    });
  };

  // What to ask for, as the scout's request.
  const request: ScoutRequest = useMemo(() => {
    const fee = wholeNumber(brief.maxFee);
    return {
      position: brief.position,
      inPossession: brief.inPossession || null,
      outOfPossession: brief.outOfPossession || null,
      purpose: brief.purpose,
      minAge: wholeNumber(brief.minAge),
      maxAge: wholeNumber(brief.maxAge),
      maxFee: fee === null ? null : toPounds(Math.max(0, fee)),
      minProbability: wholeNumber(brief.minProbability),
      noFreeAgents: brief.noFreeAgents,
      order: brief.order,
      limit: 50,
    };
  }, [brief]);
  const requestKey = JSON.stringify(request);

  const [result, setResult] = useState<Scouted | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      scoutingSuggest(request).then(
        (found) => {
          // An answer to a request that has been replaced since is of no use.
          if (mine === seq.current) {
            setResult(found);
            setError(null);
            setSearching(false);
          }
        },
        (e) => {
          if (mine === seq.current) {
            setResult(null);
            setError(describeError(e));
            setSearching(false);
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `requestKey` stands for `request`, which is a new object whenever the brief is set again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, overview, version]);

  const roleNames = [brief.inPossession, brief.outOfPossession].filter(Boolean).map(roleName);

  return (
    <div className="scout-recommend" hidden={hidden}>
      <aside className="scout-brief" aria-label={text.brief.heading}>
        <h2 className="scout-heading">{text.brief.heading}</h2>

        <section className="scout-block" aria-label={text.brief.pitch}>
          <div className="scout-pitch" role="group" aria-label={text.brief.pitch}>
            {PITCH.filter(([key]) => overview.positions.some((p) => p.key === key)).map(([key, column, row]) => {
              const line = statusOf.get(LINE_OF_POSITION[key] ?? "");
              const status: DepthStatus | null = line?.status ?? null;
              const selected = key === brief.position;
              return (
                <button
                  key={key}
                  type="button"
                  className="scout-spot"
                  data-position={key}
                  aria-pressed={selected}
                  title={
                    line && status
                      ? text.positionTip(depthLineName(line.key), line.players.length, line.target, text.status[status])
                      : positionLabel(key)
                  }
                  style={{ gridColumn: column, gridRow: row }}
                  onClick={() => choosePosition(key)}
                >
                  {status && <StatusDot status={status} />}
                  {positionLabel(key)}
                </button>
              );
            })}
          </div>
          <ul className="scout-legend" aria-label={text.brief.legend}>
            {(["missing", "thin", "fine", "crowded"] as DepthStatus[]).map((status) => (
              <li key={status}>
                <StatusDot status={status} />
                {text.status[status]}
              </li>
            ))}
          </ul>
        </section>

        <section className="scout-block">
          <span className="scout-label" id="scout-purpose-label">
            {text.brief.purpose}
          </span>
          <div className="scout-purpose scout-segmented" role="group" aria-labelledby="scout-purpose-label">
            {PURPOSES.map((purpose) => (
              <button
                key={purpose}
                type="button"
                data-purpose={purpose}
                aria-pressed={brief.purpose === purpose}
                title={text.purposeTips[purpose]}
                onClick={() => onBrief({ purpose })}
              >
                {text.purposes[purpose]}
              </button>
            ))}
          </div>
        </section>

        <section className="scout-block">
          {(["inPossession", "outOfPossession"] as Phase[]).map((phase) => (
            <label className="scout-field" key={phase}>
              <span>{text.brief[phase]}</span>
              <select
                data-phase={phase}
                value={brief[phase]}
                onChange={(e) => onBrief({ [phase]: e.currentTarget.value })}
              >
                <option value="">{text.brief.anyRole}</option>
                {rolesAt(overview.roles, position, phase).map((group) => (
                  <optgroup key={group.line} label={text.lines[group.line]}>
                    {group.roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {roleAbbreviation(role.key)} — {roleName(role.key)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ))}
        </section>

        <TacticShortcut
          current={brief.position}
          onPick={(key, inPossession, outOfPossession) => {
            const next = overview.positions.find((p) => p.key === (key ?? brief.position));
            onBrief({
              position: key ?? brief.position,
              inPossession:
                inPossession !== null && roleAvailable(overview.roles, next, "inPossession", inPossession)
                  ? inPossession
                  : "",
              outOfPossession:
                outOfPossession !== null && roleAvailable(overview.roles, next, "outOfPossession", outOfPossession)
                  ? outOfPossession
                  : "",
            });
          }}
        />

        <details className="scout-filters">
          <summary>{text.brief.filters}</summary>
          <div className="scout-filter-grid">
            <label className="scout-field">
              <span>{text.brief.minAge}</span>
              <input
                type="number"
                min={15}
                max={60}
                value={brief.minAge}
                onChange={(e) => onBrief({ minAge: e.currentTarget.value })}
              />
            </label>
            <label className="scout-field">
              <span>{text.brief.maxAge}</span>
              <input
                type="number"
                min={15}
                max={60}
                value={brief.maxAge}
                onChange={(e) => onBrief({ maxAge: e.currentTarget.value })}
              />
            </label>
            <label className="scout-field wide">
              <span>
                {text.brief.maxFee} ({currencySymbol})
              </span>
              <input
                type="number"
                min={0}
                step="any"
                value={brief.maxFee}
                onChange={(e) => onBrief({ maxFee: e.currentTarget.value })}
              />
            </label>
            <label className="scout-field wide">
              <span>{text.brief.minProbability}</span>
              <select value={brief.minProbability} onChange={(e) => onBrief({ minProbability: e.currentTarget.value })}>
                <option value="">{text.brief.anyProbability}</option>
                {PROBABILITIES.map((value) => (
                  <option key={value} value={value}>
                    {formatPercent(Number(value))}+
                  </option>
                ))}
              </select>
            </label>
            <label className="scout-check wide">
              <input
                type="checkbox"
                checked={brief.noFreeAgents}
                onChange={(e) => onBrief({ noFreeAgents: e.currentTarget.checked })}
              />
              {text.brief.noFreeAgents}
            </label>
          </div>
        </details>
      </aside>

      <div className="scout-results">
        <h2 className="scout-ask" aria-live="polite">
          {text.ask.before}
          <strong>{positionLabel(brief.position)}</strong>
          {text.ask.after}
          {" · "}
          {roleNames.length > 0 ? roleNames.join(" / ") : text.ask.anyRole}
          {" · "}
          {text.purposes[brief.purpose]}
        </h2>

        {error && <div className="banner scout-banner">{error}</div>}

        {result && (
          <OwnOptions squad={result.squad} line={statusOf.get(LINE_OF_POSITION[brief.position] ?? "")} onOpen={onOpen} />
        )}

        <div className="scout-toolbar">
          <span className="scout-summary muted" aria-live="polite">
            {result ? text.summary(result.candidates, result.suggestions.length) : searching ? text.searching : ""}
            {result && searching && ` · ${text.searching}`}
          </span>
          <label className="scout-order">
            <span className="muted">{text.order.label}</span>
            <select value={brief.order} onChange={(e) => onBrief({ order: e.currentTarget.value as ScoutOrder })}>
              {ORDERS.map((order) => (
                <option key={order} value={order}>
                  {text.order[order]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {result &&
          (result.suggestions.length === 0 ? (
            <p className="empty">{text.empty}</p>
          ) : (
            <table className="grid scout-grid">
              <thead>
                <tr>
                  <th className="col-name">{text.columns.player}</th>
                  <th className="num">{text.columns.age}</th>
                  <th>{text.columns.fit}</th>
                  <th>{text.columns.role}</th>
                  <th className="num">
                    <ProbabilityHeader />
                  </th>
                  <th className="num">{text.columns.money}</th>
                  <th>{text.columns.note}</th>
                </tr>
              </thead>
              <tbody>
                {result.suggestions.map((s) => (
                  <SuggestionRow key={s.player.uid} suggestion={s} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          ))}
        <p className="scout-note muted">{text.note}</p>
      </div>
    </div>
  );
}

/** Reading the tactic takes a few seconds, so it is read only when asked; its slots are shortcuts. */
function TacticShortcut({
  current,
  onPick,
}: {
  current: string;
  onPick: (position: string | null, inPossession: string | null, outOfPossession: string | null) => void;
}) {
  const [tactics, setTactics] = useState<ScoutingTactics | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tactic = tactics?.tactics[0] ?? null;

  const read = () => {
    setReading(true);
    setError(null);
    scoutingTactics().then(
      (found) => {
        setTactics(found);
        setReading(false);
      },
      (e) => {
        setError(describeError(e));
        setReading(false);
      },
    );
  };

  return (
    <details className="scout-tactic">
      <summary>{text.brief.tactic}</summary>
      <div className="scout-tactic-body">
        <div className="scout-tactic-read-row">
          <button type="button" className="scout-tactic-read" disabled={reading} onClick={read}>
            {reading ? text.brief.tacticReading : text.brief.tacticRead}
          </button>
          <span className="muted">{text.brief.tacticHint}</span>
        </div>
        {error && <p className="muted">{error}</p>}
        {tactics?.problem && <p className="muted">{describeError(tactics.problem)}</p>}
        {tactic && (
          <ul className="scout-tactic-slots">
            {tactic.slots.map((slot) => (
              <li key={slot.index}>
                <button
                  type="button"
                  className="scout-tactic-slot"
                  title={text.brief.tacticSlotTitle}
                  aria-pressed={slot.position !== null && slot.position === current}
                  onClick={() => onPick(slot.position, slot.inPossession, slot.outOfPossession)}
                >
                  {slot.position === null ? "?" : positionLabel(slot.position)} · {roleAbbreviation(slot.inPossession)}
                  {" / "}
                  {roleAbbreviation(slot.outOfPossession)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** The squad's own players for the position: what a signing has to beat, with how the line stands. */
function OwnOptions({
  squad,
  line,
  onOpen,
}: {
  squad: Fitting[];
  line: DepthLine | undefined;
  onOpen: (player: PlayerSummary) => void;
}) {
  return (
    <section className="scout-own" aria-label={text.own.heading}>
      <h3>
        {text.own.heading}
        {line && (
          <span className="scout-own-line">
            {depthLineName(line.key)} {line.players.length}/{line.target}
            <span className="scout-status" data-status={line.status}>
              {text.status[line.status]}
            </span>
          </span>
        )}
      </h3>
      {squad.length === 0 ? (
        <p className="muted">{text.own.empty}</p>
      ) : (
        <ul>
          <li className="scout-own-head" aria-hidden="true">
            <span>{text.columns.player}</span>
            <span className="scout-own-age">{text.columns.age}</span>
            <span>{text.columns.fit}</span>
            <span>{text.columns.role}</span>
            <span>{text.own.position}</span>
          </li>
          {squad.slice(0, 5).map((f) => (
            <li key={f.player.uid}>
              <span className="scout-own-name">
                <WithPicture picture={<PersonFace uid={f.player.uid} name={f.player.name} size={PICTURE_SIZE.rowFace} />}>
                  <button
                    type="button"
                    className="name name-link"
                    aria-haspopup="dialog"
                    title={text.openProfile}
                    onClick={() => onOpen(f.player)}
                  >
                    {f.player.name}
                  </button>
                </WithPicture>
              </span>
              <span className="scout-own-age muted">{f.player.age ?? text.none}</span>
              <FitBar fit={f.fit} title={fitTitle(f)} />
              <RoleAbbreviations inPossession={f.inPossessionRole} outOfPossession={f.outOfPossessionRole} />
              <span className="muted">{familiarity(f.positionRating)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const rating = (value: number | null) => (value === null ? null : value.toFixed(1));

/** The hover of the fee and wage: the amounts in full, and his transfer value. */
const moneyTitle = (s: Suggestion) =>
  [
    s.fee !== null && `${text.columns.fee}: ${formatMoney(s.fee)}`,
    s.wage !== null && `${text.columns.wage}: ${formatMoney(s.wage)}${text.perWeek}`,
    s.value !== null && `${text.columns.value}: ${formatMoney(s.value)}`,
  ]
    .filter(Boolean)
    .join("\n") || undefined;

const fitTitle = (f: Fitting) =>
  text.fitTitle(rating(f.inPossession), rating(f.outOfPossession), `${f.positionRating.toFixed(1)} · ${familiarity(f.positionRating)}`);

function SuggestionRow({ suggestion: s, onOpen }: { suggestion: Suggestion; onOpen: (player: PlayerSummary) => void }) {
  const level = s.probability >= 70 ? "good" : s.probability >= 50 ? "ok" : "poor";
  const shown = s.reasons.slice(0, 2);
  const more = s.reasons.length - shown.length;
  const all = s.reasons.map((r) => `${reasonText(r)} (${signed(r.points)})`).join("\n");
  const roleTitle = [s.inPossessionRole, s.outOfPossessionRole]
    .filter((key): key is string => key !== null)
    .map(roleName)
    .join(" / ");
  return (
    <tr>
      <td className="col-name">
        <PlayerName player={s.player} onOpen={onOpen} sub={<ClubLine player={s.player} />} />
      </td>
      <td className="num">{s.player.age ?? text.none}</td>
      <td>
        <FitBar fit={s.fit} title={fitTitle(s)} />
      </td>
      <td title={roleTitle || undefined}>
        <RoleAbbreviations inPossession={s.inPossessionRole} outOfPossession={s.outOfPossessionRole} />
      </td>
      <td className={`num scout-probability ${level}`} title={all || undefined}>
        {formatPercent(s.probability)}
      </td>
      <td className="num scout-money" title={moneyTitle(s)}>
        <span className="scout-fee">{s.fee === null ? text.none : shortMoney(s.fee)}</span>
        <span className="sub">{s.wage === null ? text.none : `${shortMoney(s.wage)}${text.perWeek}`}</span>
      </td>
      <td className="scout-note-cell" title={all || undefined}>
        <div className="scout-reasons">
          {shown.map((r) => (
            <span key={r.code} className={`tag scout-reason ${r.points > 0 ? "pos" : r.points < 0 ? "neg" : ""}`}>
              {reasonText(r)}
            </span>
          ))}
          {more > 0 && <span className="tag scout-reason">+{more}</span>}
        </div>
      </td>
    </tr>
  );
}
