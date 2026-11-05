// "Players to let go": who the scout would sell, loan out or release, and why.

import { formatDate, formatMoney } from "./format";
import { scoutingText as text } from "./labels";
import { departureReasonText, depthLineName, PlayerName } from "./ScoutParts";
import type { Departure, DepartureAction, PlayerSummary } from "./types";

export type DepartureFilter = "all" | DepartureAction;

export const DEPARTURE_FILTERS: DepartureFilter[] = ["all", "sell", "loan", "release"];

export function ScoutDepartures({
  departures,
  filter,
  onFilter,
  onOpen,
}: {
  departures: Departure[];
  filter: DepartureFilter;
  onFilter: (filter: DepartureFilter) => void;
  onOpen: (player: PlayerSummary) => void;
}) {
  const count = (which: DepartureFilter) =>
    which === "all" ? departures.length : departures.filter((d) => d.action === which).length;
  const shown = filter === "all" ? departures : departures.filter((d) => d.action === filter);

  return (
    <div className="scout-departures">
      <div className="scout-departures-head">
        <p className="muted">{text.departures.intro}</p>
        {departures.length > 0 && (
          <div className="scout-segmented" role="group" aria-label={text.departures.filter}>
            {DEPARTURE_FILTERS.map((which) => (
              <button
                key={which}
                type="button"
                data-filter={which}
                aria-pressed={filter === which}
                onClick={() => onFilter(which)}
              >
                {which === "all" ? text.departures.all : text.departures.actions[which]} ({count(which)})
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="empty">{text.departures.empty}</p>
      ) : (
        <table className="grid scout-grid scout-departure-grid">
          <thead>
            <tr>
              <th className="col-name">{text.departures.columns.player}</th>
              <th className="num">{text.departures.columns.age}</th>
              <th className="num">{text.departures.columns.ability}</th>
              <th className="num">{text.departures.columns.value}</th>
              <th className="num">{text.departures.columns.wage}</th>
              <th>{text.departures.columns.contract}</th>
              <th>{text.departures.columns.advice}</th>
              <th>{text.departures.columns.reasons}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.player.uid}>
                <td className="col-name">
                  <PlayerName player={d.player} onOpen={onOpen} sub={text.departures.rank(depthLineName(d.line), d.rank)} />
                </td>
                <td className="num">{d.player.age ?? text.none}</td>
                <td className="num">
                  {d.player.currentAbility}
                  <span className="muted"> / {d.player.potentialAbility}</span>
                </td>
                <td className="num">{d.value === null ? text.none : formatMoney(d.value)}</td>
                <td className="num">{d.wage === null ? text.none : `${formatMoney(d.wage)}${text.perWeek}`}</td>
                <td>{formatDate(d.player.contractExpires) || text.none}</td>
                <td>
                  <span className="scout-action" data-action={d.action}>
                    {text.departures.actions[d.action]}
                  </span>
                </td>
                <td className="scout-note-cell">
                  <div className="scout-reasons">
                    {d.reasons.map((r) => (
                      <span key={r.code} className="tag scout-reason">
                        {departureReasonText(r)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
