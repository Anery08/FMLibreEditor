// "Squad depth": the ten lines of the senior squad as one table, goalkeepers first: how each stands against what a
// squad usually carries, its players best first, who else can play there, and a way to ask for advice.

import { formatNumber } from "./format";
import { scoutingText as text } from "./labels";
import { depthLineName } from "./ScoutParts";
import type { DepthLine, DepthPlayer, DepthStatus, PlayerSummary, SquadReport } from "./types";

/** The lines from the back to the front, as the squad is usually read. */
const ORDER = ["gk", "dc", "rightBack", "leftBack", "dm", "mc", "rightWing", "leftWing", "amc", "st"];

/** How many of a line's players the table names; the rest are counted. */
const SHOWN = 4;

const STATUSES: DepthStatus[] = ["missing", "thin", "fine", "crowded"];

/** Whether a line needs a look: missing, thin or crowded, or weak or ageing. */
const needsLook = (line: DepthLine) => line.status !== "fine" || line.weak || line.ageing;

export function ScoutDepth({
  report,
  onOpen,
  onAdvice,
}: {
  report: SquadReport;
  onOpen: (player: PlayerSummary) => void;
  /** Asks the Transfer advice section for a position. */
  onAdvice: (position: string) => void;
}) {
  const byKey = new Map(report.lines.map((line) => [line.key, line]));
  const lines = [
    ...ORDER.flatMap((key) => byKey.get(key) ?? []),
    ...report.lines.filter((line) => !ORDER.includes(line.key)),
  ];
  const age = report.averageAge === null ? null : formatNumber(report.averageAge, { maximumFractionDigits: 1 });
  const flagged = lines.filter(needsLook);
  return (
    <div className="scout-depth">
      <p className="scout-depth-summary muted">
        {text.depth.summary(report.size, age, formatNumber(Math.round(report.level)))}
      </p>
      <p className="scout-depth-attention">
        {flagged.length === 0 ? (
          text.depth.allFine
        ) : (
          <>
            <strong>{text.depth.attention}</strong>{" "}
            {flagged.map((line, i) => (
              <span key={line.key} className="scout-depth-flagged">
                {i > 0 && ", "}
                {depthLineName(line.key)} ({flags(line).join(", ")})
              </span>
            ))}
          </>
        )}
      </p>
      <table className="grid scout-depth-table">
        <colgroup>
          <col className="scout-depth-col-line" />
          <col className="scout-depth-col-status" />
          <col className="scout-depth-col-count" />
          <col />
          <col className="scout-depth-col-cover" />
          <col className="scout-depth-col-age" />
          <col className="scout-depth-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>{text.depth.columns.line}</th>
            <th>{text.depth.columns.status}</th>
            <th className="num">{text.depth.columns.count}</th>
            <th>{text.depth.columns.players}</th>
            <th>{text.depth.columns.cover}</th>
            <th className="num">{text.depth.columns.age}</th>
            <th aria-label={text.depth.advice} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <LineRow key={line.key} line={line} onOpen={onOpen} onAdvice={onAdvice} />
          ))}
        </tbody>
      </table>
      <ul className="scout-depth-help muted">
        {STATUSES.map((status) => (
          <li key={status}>
            <span className="scout-status" data-status={status}>
              {text.status[status]}
            </span>
            {text.depth.statusHelp[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line's status and flags in words, for the summary. */
function flags(line: DepthLine): string[] {
  return [
    line.status !== "fine" && text.status[line.status].toLocaleLowerCase(),
    line.weak && text.depth.weak.toLocaleLowerCase(),
    line.ageing && text.depth.ageing.toLocaleLowerCase(),
  ].filter((flag): flag is string => typeof flag === "string");
}

const averageAge = (players: DepthPlayer[]) => {
  const ages = players.flatMap((d) => (d.player.age === null ? [] : [d.player.age]));
  return ages.length === 0 ? null : ages.reduce((sum, age) => sum + age, 0) / ages.length;
};

function LineRow({
  line,
  onOpen,
  onAdvice,
}: {
  line: DepthLine;
  onOpen: (player: PlayerSummary) => void;
  onAdvice: (position: string) => void;
}) {
  const name = depthLineName(line.key);
  const position = line.positions[0];
  const age = averageAge(line.players);
  const named = line.players.slice(0, SHOWN);
  const rest = line.players.slice(SHOWN);
  return (
    <tr className="scout-line-card" data-line={line.key} data-status={line.status}>
      <td className="scout-depth-line">{name}</td>
      <td>
        <span className="scout-status" data-status={line.status} title={text.depth.statusHelp[line.status]}>
          {text.status[line.status]}
        </span>
        {line.weak && <span className="tag scout-flag">{text.depth.weak}</span>}
        {line.ageing && <span className="tag scout-flag">{text.depth.ageing}</span>}
      </td>
      <td className="num scout-depth-count" title={text.depth.countTitle(line.players.length, line.target)}>
        <strong>{line.players.length}</strong>
        <span className="muted"> / {line.target}</span>
      </td>
      <td className="scout-depth-players">
        {line.players.length === 0 ? (
          <span className="muted">{text.depth.empty}</span>
        ) : (
          <>
            {named.map((d, i) => (
              // A name, its ability and the comma after it stay together; a line breaks only between players.
              <span key={d.player.uid}>
                <span className="scout-depth-player">
                  <button
                    type="button"
                    className="name-link"
                    aria-haspopup="dialog"
                    title={`${text.openProfile} · ${text.columns.age} ${d.player.age ?? text.none}`}
                    onClick={() => onOpen(d.player)}
                  >
                    {d.player.name}
                  </button>{" "}
                  <span className="scout-depth-ability" title={text.depth.ability}>
                    {d.player.currentAbility}
                  </span>
                  {d.onLoan && <span className="tag loan">{text.loan}</span>}
                  {i < named.length - 1 && <span className="muted">,</span>}
                </span>{" "}
              </span>
            ))}
            {rest.length > 0 && (
              <span className="muted" title={rest.map((d) => d.player.name).join(", ")}>
                {" "}
                {text.depth.more(rest.length)}
              </span>
            )}
          </>
        )}
      </td>
      <td className="scout-depth-cover muted" title={line.cover.map((d) => d.player.name).join(", ") || undefined}>
        {line.cover.length === 0
          ? text.none
          : line.cover
              .slice(0, 2)
              .map((d) => d.player.name)
              .join(", ") + (line.cover.length > 2 ? ` ${text.depth.more(line.cover.length - 2)}` : "")}
      </td>
      <td className="num muted">{age === null ? text.none : formatNumber(age, { maximumFractionDigits: 1 })}</td>
      <td className="scout-depth-action">
        {position !== undefined && (
          <button
            type="button"
            className="scout-advice-button"
            title={`${text.depth.adviceTitle} (${name})`}
            onClick={() => onAdvice(position)}
          >
            {text.depth.advice}
          </button>
        )}
      </td>
    </tr>
  );
}
