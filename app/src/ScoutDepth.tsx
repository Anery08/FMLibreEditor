// "Squad depth": the ten lines of the senior squad laid out like a pitch, each with its players and how it stands.

import { formatNumber } from "./format";
import { scoutingText as text } from "./labels";
import { PersonFace } from "./Picture";
import { depthLineName } from "./ScoutParts";
import type { DepthLine, DepthPlayer, PlayerSummary, SquadReport } from "./types";

/** [line key, column, row]: attack at the top, a line to a row where it stands alone. */
const LAYOUT: readonly (readonly [string, number, number])[] = [
  ["st", 0, 1],
  ["leftWing", 1, 2],
  ["amc", 2, 2],
  ["rightWing", 3, 2],
  ["mc", 0, 3],
  ["dm", 0, 4],
  ["leftBack", 1, 5],
  ["dc", 2, 5],
  ["rightBack", 3, 5],
  ["gk", 0, 6],
];

/** How many of a line's players a card lists; the rest are counted. */
const SHOWN = 6;

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
  const age = report.averageAge === null ? null : formatNumber(report.averageAge, { maximumFractionDigits: 1 });
  return (
    <div className="scout-depth">
      <p className="scout-depth-summary muted">
        {text.depth.summary(report.size, age, formatNumber(Math.round(report.level)))}
        <span className="scout-depth-legend">{text.depth.legend}</span>
      </p>
      <div className="scout-pitch-lines">
        {LAYOUT.map(([key, column, row]) => {
          const line = byKey.get(key);
          return (
            line && (
              <LineCard
                key={key}
                line={line}
                single={column === 0}
                row={row}
                column={column}
                onOpen={onOpen}
                onAdvice={onAdvice}
              />
            )
          );
        })}
      </div>
    </div>
  );
}

function LineCard({
  line,
  single,
  row,
  column,
  onOpen,
  onAdvice,
}: {
  line: DepthLine;
  single: boolean;
  row: number;
  column: number;
  onOpen: (player: PlayerSummary) => void;
  onAdvice: (position: string) => void;
}) {
  const style = single ? { gridRow: row, gridColumn: "1 / -1" } : { gridRow: row, gridColumn: column };
  const name = depthLineName(line.key);
  const position = line.positions[0];
  return (
    <section className={single ? "scout-line-card single" : "scout-line-card"} data-line={line.key} style={style} aria-label={name}>
      <header>
        <h3>{name}</h3>
        <span className="scout-status" data-status={line.status}>
          {text.status[line.status]}
        </span>
        <span className="scout-count muted">
          {line.players.length}/{line.target}
        </span>
        {line.weak && <span className="tag scout-flag">{text.depth.weak}</span>}
        {line.ageing && <span className="tag scout-flag">{text.depth.ageing}</span>}
        {position !== undefined && (
          <button type="button" className="scout-advice-button" title={text.depth.adviceTitle} onClick={() => onAdvice(position)}>
            {text.depth.advice}
          </button>
        )}
      </header>
      {line.players.length === 0 ? (
        <p className="muted scout-line-empty">{text.depth.empty}</p>
      ) : (
        <ul className="scout-line-players">
          {line.players.slice(0, SHOWN).map((p) => (
            <DepthRow key={p.player.uid} entry={p} onOpen={onOpen} />
          ))}
          {line.players.length > SHOWN && (
            <li className="scout-line-more muted" title={line.players.slice(SHOWN).map((p) => p.player.name).join(", ")}>
              {text.depth.more(line.players.length - SHOWN)}
            </li>
          )}
        </ul>
      )}
      {line.cover.length > 0 && (
        <p className="scout-cover muted">{text.depth.cover(line.cover.map((c) => c.player.name).join(", "))}</p>
      )}
    </section>
  );
}

function DepthRow({ entry, onOpen }: { entry: DepthPlayer; onOpen: (player: PlayerSummary) => void }) {
  const { player } = entry;
  return (
    <li>
      <PersonFace uid={player.uid} name={player.name} size={22} />
      <button type="button" className="name-link" aria-haspopup="dialog" title={text.openProfile} onClick={() => onOpen(player)}>
        {player.name}
      </button>
      {entry.onLoan && <span className="tag loan">{text.loan}</span>}
      <span className="muted scout-line-age" title={text.columns.age}>
        {player.age ?? text.none}
      </span>
      <span className="scout-line-ability" title={text.depth.ability}>
        {player.currentAbility}
      </span>
    </li>
  );
}
