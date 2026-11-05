import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPounds } from "./currency";
import { scoutingSuggest, scoutingTactics } from "./editing";
import { currencySymbol, describeError, formatMoney } from "./format";
import { positionLabel, scoutingText as text } from "./labels";
import { ClubLogo, PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import { PlayerDialog } from "./PlayerProfile";
import { isRecord, restored, useSnapshot } from "./restore";
import type {
  Line,
  PlayerSummary,
  Role,
  ScoutOrder,
  Scouted,
  ScoutingView,
  ScoutRequest,
  Side,
  Suggestion,
  TacticSlot,
} from "./types";

/** What the side select offers: the slot's own side, a side, or both. */
type SideChoice = "auto" | "right" | "left" | "either";

/** What the user changed for one slot; what is missing is the slot's own. */
interface Override {
  /** A role key; null for none (or an unknown role not replaced). */
  inPossession?: string | null;
  outOfPossession?: string | null;
  side?: SideChoice;
}

interface Filters {
  minAge: string;
  maxAge: string;
  /** In the shown currency; empty for no limit. */
  maxFee: string;
  realisticOnly: boolean;
  upgradesOnly: boolean;
  noFreeAgents: boolean;
  order: ScoutOrder;
}


const ORDERS: ScoutOrder[] = ["score", "fit", "realism", "fee"];
const SIDE_CHOICES: SideChoice[] = ["auto", "right", "left", "either"];

/** The lines in the order of the formation, back to front. */
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

/** The lines whose players play on one side. */
const SIDED: ReadonlySet<Line> = new Set<Line>(["fullBack", "wingBack", "wide"]);

/** The reasons whose value is an amount of money; the others' is a number of days. */
const MONEY_REASONS: ReadonlySet<string> = new Set(["releaseClause", "overBudget", "stretch", "wageHigh"]);

const DEBOUNCE_MS = 300;

/** What was saved before the language was switched; a start from scratch for what is missing or wrong. */
interface Saved {
  tactic: number;
  slot: number;
  overrides: Record<string, Override>;
  filters: Filters;
}

const readText = (value: unknown): string => (typeof value === "string" ? value : "");
const readCount = (value: unknown): number => (typeof value === "number" && value >= 0 ? Math.floor(value) : 0);

function readRole(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? value : undefined;
}

function readOverride(value: unknown): Override {
  if (!isRecord(value)) {
    return {};
  }
  const side = SIDE_CHOICES.find((choice) => choice === value.side);
  return {
    ...(readRole(value.inPossession) !== undefined && { inPossession: readRole(value.inPossession) }),
    ...(readRole(value.outOfPossession) !== undefined && { outOfPossession: readRole(value.outOfPossession) }),
    ...(side && { side }),
  };
}

function readSaved(value: unknown): Saved {
  const saved = isRecord(value) ? value : {};
  const filters = isRecord(saved.filters) ? saved.filters : {};
  const overrides = isRecord(saved.overrides) ? saved.overrides : {};
  return {
    tactic: readCount(saved.tactic),
    slot: readCount(saved.slot),
    overrides: Object.fromEntries(Object.entries(overrides).map(([key, one]) => [key, readOverride(one)])),
    filters: {
      minAge: readText(filters.minAge),
      maxAge: readText(filters.maxAge),
      maxFee: readText(filters.maxFee),
      realisticOnly: filters.realisticOnly === true,
      upgradesOnly: filters.upgradesOnly === true,
      noFreeAgents: filters.noFreeAgents === true,
      order: ORDERS.find((order) => order === filters.order) ?? "score",
    },
  };
}

const roleName = (key: string) => text.roles[key] ?? key.toUpperCase();

/** A whole number from what was typed, or null when it is empty or not a number. */
function wholeNumber(typed: string): number | null {
  const number = typed.trim() === "" ? NaN : Number(typed);
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** The tab that suggests players for a slot of the manager's tactic. */
export function ScoutingBrowser({ version, active }: { version: number; active: boolean }) {
  const [saved] = useState(() => restored("scouting", readSaved));
  const [view, setView] = useState<ScoutingView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tacticIndex, setTacticIndex] = useState(saved.tactic);
  const [slotIndex, setSlotIndex] = useState(saved.slot);
  const [overrides, setOverrides] = useState<Record<string, Override>>(saved.overrides);
  const [filters, setFilters] = useState<Filters>(saved.filters);
  const [result, setResult] = useState<Scouted | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [shown, setShown] = useState<PlayerSummary | null>(null);
  useSnapshot("scouting", () => ({ tactic: tacticIndex, slot: slotIndex, overrides, filters }));

  // The data version the tactics were read at; they are read again when the tab is shown after the data changed.
  const loadedVersion = useRef<number | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    loadedVersion.current = version;
    setLoading(true);
    setError(null);
    try {
      const read = await scoutingTactics();
      if (seq === loadSeq.current) {
        setView(read);
      }
    } catch (e) {
      if (seq === loadSeq.current) {
        setError(describeError(e));
      }
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [version]);

  useEffect(() => {
    if (active && loadedVersion.current !== version) {
      void load();
    }
  }, [active, version, load]);

  const tactic = view?.tactics[Math.min(tacticIndex, (view?.tactics.length ?? 1) - 1)] ?? null;
  const tacticNumber = view && tactic ? view.tactics.indexOf(tactic) : 0;
  const slot: TacticSlot | null = tactic?.slots[Math.min(slotIndex, tactic.slots.length - 1)] ?? null;
  const overrideKey = `${tacticNumber}:${slot?.index ?? 0}`;
  const override = overrides[overrideKey];

  const roleByKey = useMemo(() => new Map((view?.roles ?? []).map((role) => [role.key + role.phase, role])), [view]);
  const players = useMemo(() => new Map((view?.players ?? []).map((player) => [player.uid, player])), [view]);

  const inPossession = slot ? (override?.inPossession !== undefined ? override.inPossession : slot.inPossession) : null;
  const outOfPossession = slot
    ? override?.outOfPossession !== undefined
      ? override.outOfPossession
      : slot.outOfPossession
    : null;
  const sideChoice = override?.side ?? "auto";
  const line: Line | null =
    (inPossession !== null ? roleByKey.get(`${inPossession}inPossession`)?.line : undefined) ?? slot?.line ?? null;
  const sided = line !== null && SIDED.has(line);
  const side: Side | null = !sided ? null : sideChoice === "auto" ? (slot?.side ?? null) : sideChoice === "either" ? null : sideChoice;

  const change = (patch: Override) =>
    setOverrides((all) => ({ ...all, [overrideKey]: { ...all[overrideKey], ...patch } }));
  const filter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((all) => ({ ...all, [key]: value }));

  // What to ask for; null while there is nothing to ask (no slot, or no role in possession to look for).
  const request: ScoutRequest | null = useMemo(() => {
    if (!slot || inPossession === null) {
      return null;
    }
    const fee = wholeNumber(filters.maxFee);
    return {
      inPossession,
      outOfPossession,
      side,
      current: slot.player,
      minAge: wholeNumber(filters.minAge),
      maxAge: wholeNumber(filters.maxAge),
      maxFee: fee === null ? null : toPounds(Math.max(0, fee)),
      realisticOnly: filters.realisticOnly,
      noFreeAgents: filters.noFreeAgents,
      upgradesOnly: filters.upgradesOnly,
      order: filters.order,
      limit: 50,
    };
  }, [slot, inPossession, outOfPossession, side, filters]);
  const requestKey = JSON.stringify(request);

  const searchSeq = useRef(0);
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (request === null || view === null) {
      setResult(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      scoutingSuggest(request).then(
        (found) => {
          // An answer to a request that has been replaced since is of no use.
          if (seq === searchSeq.current) {
            setResult(found);
            setSearchError(null);
            setSearching(false);
          }
        },
        (e) => {
          if (seq === searchSeq.current) {
            setResult(null);
            setSearchError(describeError(e));
            setSearching(false);
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `requestKey` stands for `request`, which is a new object whenever one of its parts is set again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, view]);

  const className = ["workspace", "scouting", !active && "inactive"].filter(Boolean).join(" ");

  if (view === null) {
    return (
      <div className={className}>
        <div className="players scout-main">
          {error && <div className="banner scout-banner">{error}</div>}
          {loading ? (
            <p className="empty">{text.reading}</p>
          ) : (
            error && (
              <div className="toolbar">
                <button type="button" onClick={() => void load()}>
                  {text.refresh}
                </button>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  const wageLabel = result?.wageRoom != null ? text.wageRoom : text.wageBudget;
  const wage = result?.wageRoom != null ? result.wageRoom : view.wageBudget;
  const transferBudget = result?.transferBudget ?? view.transferBudget;

  return (
    <div className={className}>
      <aside className="scout-slots" aria-label={text.slots}>
        {tactic && (
          <ol>
            {tactic.slots.map((s) => (
              <li key={s.index}>
                <SlotButton
                  slot={s}
                  player={s.player === null ? undefined : players.get(s.player)}
                  selected={s.index === slot?.index}
                  onSelect={() => setSlotIndex(s.index)}
                />
              </li>
            ))}
          </ol>
        )}
      </aside>

      <div className="players scout-main">
        <div className="toolbar scout-toolbar">
          <span className="scout-club">
            <WithPicture picture={<ClubLogo uid={view.club.uid} name={view.club.name} size={PICTURE_SIZE.clubRowLogo} />}>
              <span className="name-text">{view.club.name}</span>
            </WithPicture>
          </span>
          <span className="scout-figure">
            <span className="muted">{text.transferBudget}</span>{" "}
            <strong>{transferBudget === null ? text.none : formatMoney(transferBudget)}</strong>
          </span>
          <span className="scout-figure">
            <span className="muted">{wageLabel}</span>{" "}
            <strong>{wage === null ? text.none : `${formatMoney(wage)}${text.perWeek}`}</strong>
          </span>
          {view.tactics.length > 1 && (
            <select
              aria-label={text.tacticPicker}
              value={tacticNumber}
              onChange={(e) => {
                setTacticIndex(Number(e.currentTarget.value));
                setSlotIndex(0);
              }}
            >
              {view.tactics.map((t, i) => (
                <option key={i} value={i}>
                  {text.tactic(i + 1, t.style === null ? null : (text.styles[t.style] ?? t.style))}
                </option>
              ))}
            </select>
          )}
          <button type="button" title={text.refreshTitle} disabled={loading} onClick={() => void load()}>
            {text.refresh}
          </button>
          {loading && <span className="muted">{text.reading}</span>}
        </div>

        {error && <div className="banner scout-banner">{error}</div>}
        {view.problem && <div className="banner scout-banner">{describeError(view.problem)}</div>}

        {slot && (
          <div className="filter-bar">
            <div className="filter-fields">
              <label className="filter-field">
                <span>{text.roleSelect.inPossession}</span>
                <select
                  aria-label={text.roleSelect.inPossession}
                  value={inPossession ?? ""}
                  onChange={(e) => change({ inPossession: e.currentTarget.value || null })}
                >
                  {inPossession === null && <option value="">{text.roleSelect.pick}</option>}
                  <RoleOptions roles={view.roles} phase="inPossession" />
                </select>
              </label>
              <label className="filter-field">
                <span>{text.roleSelect.outOfPossession}</span>
                <select
                  aria-label={text.roleSelect.outOfPossession}
                  value={outOfPossession ?? ""}
                  onChange={(e) => change({ outOfPossession: e.currentTarget.value || null })}
                >
                  <option value="">{text.roleSelect.none}</option>
                  <RoleOptions roles={view.roles} phase="outOfPossession" />
                </select>
              </label>
              {sided && (
                <label className="filter-field">
                  <span>{text.side.label}</span>
                  <select
                    aria-label={text.side.label}
                    value={sideChoice}
                    onChange={(e) => change({ side: e.currentTarget.value as SideChoice })}
                  >
                    {SIDE_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {text.side[choice]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="filter-fields">
              <label className="filter-field">
                <span>{text.filters.minAge}</span>
                <input
                  type="number"
                  min={15}
                  max={60}
                  aria-label={text.filters.minAge}
                  value={filters.minAge}
                  onChange={(e) => filter("minAge", e.currentTarget.value)}
                />
              </label>
              <label className="filter-field">
                <span>{text.filters.maxAge}</span>
                <input
                  type="number"
                  min={15}
                  max={60}
                  aria-label={text.filters.maxAge}
                  value={filters.maxAge}
                  onChange={(e) => filter("maxAge", e.currentTarget.value)}
                />
              </label>
              <label className="filter-field">
                <span>
                  {text.filters.maxFee} ({currencySymbol})
                </span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  aria-label={text.filters.maxFee}
                  value={filters.maxFee}
                  onChange={(e) => filter("maxFee", e.currentTarget.value)}
                />
              </label>
              <label className="filter-field">
                <span>{text.filters.order}</span>
                <select
                  aria-label={text.filters.order}
                  value={filters.order}
                  onChange={(e) => filter("order", e.currentTarget.value as ScoutOrder)}
                >
                  {ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {text.filters.orders[order]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <input
                  type="checkbox"
                  checked={filters.realisticOnly}
                  onChange={(e) => filter("realisticOnly", e.currentTarget.checked)}
                />
                {text.filters.realisticOnly}
              </label>
              <label className="filter-field">
                <input
                  type="checkbox"
                  checked={filters.upgradesOnly}
                  onChange={(e) => filter("upgradesOnly", e.currentTarget.checked)}
                />
                {text.filters.upgradesOnly}
              </label>
              <label className="filter-field">
                <input
                  type="checkbox"
                  checked={filters.noFreeAgents}
                  onChange={(e) => filter("noFreeAgents", e.currentTarget.checked)}
                />
                {text.filters.noFreeAgents}
              </label>
            </div>
          </div>
        )}

        {searchError && <div className="banner scout-banner">{searchError}</div>}

        <div className="table-wrap">
          {slot && inPossession === null ? (
            <p className="empty">{text.pickRole}</p>
          ) : (
            result && (
              <>
                <p className="scout-summary muted" aria-live="polite">
                  {text.summary(result.candidates, result.examined, result.suggestions.length)}
                  {searching && ` · ${text.searching}`}
                </p>
                {result.current === null && result.suggestions.length === 0 ? (
                  <p className="empty">{text.empty}</p>
                ) : (
                  <table className="grid scout-grid">
                    <thead>
                      <tr>
                        <th className="col-name">{text.columns.player}</th>
                        <th className="num">{text.columns.age}</th>
                        <th>{text.columns.club}</th>
                        <th>{text.columns.positions}</th>
                        <th>{text.columns.fit}</th>
                        <th className="num">{text.columns.realism}</th>
                        <th className="num">{text.columns.fee}</th>
                        <th className="num">{text.columns.wage}</th>
                        <th>{text.columns.reasons}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.current && <SuggestionRow suggestion={result.current} pinned onOpen={setShown} />}
                      {result.suggestions.map((s) => (
                        <SuggestionRow key={s.player.uid} suggestion={s} onOpen={setShown} />
                      ))}
                    </tbody>
                  </table>
                )}
                {result.suggestions.length === 0 && result.current !== null && <p className="empty">{text.empty}</p>}
                <p className="scout-note muted">{text.note}</p>
              </>
            )
          )}
          {slot && inPossession !== null && result === null && searching && <p className="empty">{text.searching}</p>}
        </div>
      </div>

      {shown && <PlayerDialog player={shown} version={version} onClose={() => setShown(null)} />}
    </div>
  );
}

/** The roles of one phase as the options of a select, a group to a line. */
function RoleOptions({ roles, phase }: { roles: Role[]; phase: Role["phase"] }) {
  return (
    <>
      {LINES.map((line) => {
        const inLine = roles.filter((role) => role.phase === phase && role.line === line);
        return (
          inLine.length > 0 && (
            <optgroup key={line} label={text.lines[line]}>
              {inLine.map((role) => (
                <option key={role.key} value={role.key}>
                  {roleName(role.key)}
                </option>
              ))}
            </optgroup>
          )
        );
      })}
    </>
  );
}

function SlotButton({
  slot,
  player,
  selected,
  onSelect,
}: {
  slot: TacticSlot;
  player: PlayerSummary | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const roleLabel = (key: string | null, mask: string) =>
    key === null ? (
      <span title={text.unknownRole(mask)}>?</span>
    ) : (
      <span title={roleName(key)}>{key.toUpperCase()}</span>
    );
  return (
    <button type="button" className={selected ? "scout-slot selected" : "scout-slot"} aria-pressed={selected} onClick={onSelect}>
      <span className="scout-roles">
        {roleLabel(slot.inPossession, slot.inPossessionMask)} / {roleLabel(slot.outOfPossession, slot.outOfPossessionMask)}
      </span>
      <span className="scout-line muted">
        {slot.line && text.lines[slot.line]}
        {slot.side && ` · ${text.sideShort[slot.side]}`}
      </span>
      <span className="scout-slot-player">
        {player ? (
          <WithPicture picture={<PersonFace uid={player.uid} name={player.name} size={PICTURE_SIZE.rowFace} />}>
            <span className="name-text">{player.name}</span>
          </WithPicture>
        ) : (
          <span className="muted">{text.emptySlot}</span>
        )}
      </span>
    </button>
  );
}

function reasonText(code: string, value: number | null): string {
  const say = text.reasons[code];
  if (!say) {
    return code;
  }
  const shownValue = value === null ? "" : MONEY_REASONS.has(code) ? formatMoney(value) : String(Math.round(value));
  return say(shownValue);
}

const rating = (value: number | null) => (value === null ? null : value.toFixed(1));

function SuggestionRow({
  suggestion: s,
  pinned = false,
  onOpen,
}: {
  suggestion: Suggestion;
  pinned?: boolean;
  onOpen: (player: PlayerSummary) => void;
}) {
  const p = s.player;
  const realismClass = s.realism >= 70 ? "good" : s.realism >= 50 ? "ok" : "poor";
  const sign = (points: number) => (points > 0 ? `+${points}` : String(points));
  return (
    <tr className={pinned ? "scout-current" : undefined}>
      <td className="col-name">
        <WithPicture picture={<PersonFace uid={p.uid} name={p.name} size={PICTURE_SIZE.rowFace} />}>
          <button
            type="button"
            className="name name-link"
            aria-haspopup="dialog"
            title={text.openProfile}
            onClick={() => onOpen(p)}
          >
            {p.name}
          </button>
          {pinned && <div className="sub">{text.current}</div>}
        </WithPicture>
      </td>
      <td className="num">{p.age ?? text.none}</td>
      <td className="scout-club-cell" title={p.club ?? text.freeAgent}>
        {p.club !== null && p.clubUid !== null ? (
          <WithPicture picture={<ClubLogo uid={p.clubUid} name={p.club} size={PICTURE_SIZE.rowLogo} />}>
            <span className="name-text">{p.club}</span>
          </WithPicture>
        ) : (
          <span className="muted">{text.freeAgent}</span>
        )}
      </td>
      <td>{p.positions.slice(0, 3).map(positionLabel).join(", ")}</td>
      <td>
        <div
          className="scout-fit"
          title={text.fitTitle(rating(s.inPossession), rating(s.outOfPossession), s.positionRating.toFixed(1))}
        >
          <span className="scout-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, s.fit))}%` }} />
          </span>
          <span className="num">{Math.round(s.fit)}</span>
        </div>
      </td>
      <td
        className={`num scout-realism ${realismClass}`}
        title={s.reasons.map((r) => `${reasonText(r.code, r.value)} (${sign(r.points)})`).join("\n")}
      >
        {Math.round(s.realism)}
      </td>
      {/* His value is in the fee's tooltip: the table is wide enough already. */}
      <td className="num" title={s.value === null ? undefined : `${text.columns.value}: ${formatMoney(s.value)}`}>
        {s.fee === null ? text.none : formatMoney(s.fee)}
      </td>
      <td className="num">{s.wage === null ? text.none : `${formatMoney(s.wage)}${text.perWeek}`}</td>
      <td>
        {/* The chips wrap inside a box of their own: a flex cell would stop being a table cell. */}
        <div className="scout-reasons">
          {s.reasons.map((r) => (
            <span
              key={r.code}
              className={`tag scout-reason ${r.points > 0 ? "pos" : r.points < 0 ? "neg" : ""}`}
              title={sign(r.points)}
            >
              {reasonText(r.code, r.value)}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}
