// "Players to let go": who the scout would sell, loan out or release, and why. The list comes most pressing first;
// any column can sort it.

import { useState } from "react";
import { fold, formatDate, formatMoney } from "./format";
import { intlLocale } from "./i18n";
import { scoutingText as text } from "./labels";
import { departureReasonText, depthLineName, PlayerName } from "./ScoutParts";
import { type ColumnOrder, SortHeader } from "./SortHeader";
import type { Departure, DepartureAction, FmDate, PlayerSummary } from "./types";

export type DepartureFilter = "all" | DepartureAction;

export const DEPARTURE_FILTERS: DepartureFilter[] = ["all", "sell", "loan", "release"];

/** The columns the list can be sorted by; `rank` is the scout's own order, most pressing first. */
type DepartureSort = "rank" | "name" | "age" | "ca" | "pa" | "value" | "wage" | "contract";

const ASCENDING_FIRST: ReadonlySet<DepartureSort> = new Set(["rank", "name", "age", "contract"]);

const SCOUT_ORDER: ColumnOrder<DepartureSort> = { by: "rank", ascending: true };

const dateNumber = (date: FmDate | null) => (date === null ? null : date.year * 10_000 + date.month * 100 + date.day);

function sortValue(d: Departure, rank: number, by: DepartureSort): number | string | null {
  switch (by) {
    case "rank":
      return rank;
    case "name":
      return fold(d.player.name);
    case "age":
      return d.player.age;
    case "ca":
      return d.player.currentAbility;
    case "pa":
      return d.player.potentialAbility;
    case "value":
      // Not for sale is worth more than any fee.
      return d.notForSale ? Number.MAX_SAFE_INTEGER : d.value;
    case "wage":
      return d.wage;
    case "contract":
      return dateNumber(d.player.contractExpires);
  }
}

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
  const [order, setOrder] = useState<ColumnOrder<DepartureSort>>(SCOUT_ORDER);
  const count = (which: DepartureFilter) =>
    which === "all" ? departures.length : departures.filter((d) => d.action === which).length;
  const ranked = departures.map((departure, i) => ({ departure, rank: i + 1 }));
  const shown = (filter === "all" ? ranked : ranked.filter((r) => r.departure.action === filter)).sort((a, b) => {
    const x = sortValue(a.departure, a.rank, order.by);
    const y = sortValue(b.departure, b.rank, order.by);
    if (x === null || y === null) {
      return x === y ? a.rank - b.rank : x === null ? 1 : -1;
    }
    const compared =
      typeof x === "string" && typeof y === "string" ? x.localeCompare(y, intlLocale) : Number(x) - Number(y);
    return compared === 0 ? a.rank - b.rank : order.ascending ? compared : -compared;
  });
  const sortBy = (by: DepartureSort) =>
    setOrder({ by, ascending: order.by === by ? !order.ascending : ASCENDING_FIRST.has(by) });
  const header = (by: DepartureSort, label: string, className?: string) => (
    <SortHeader
      by={by}
      order={order}
      onSort={sortBy}
      label={label}
      title={text.sortBy(text.departures.sortNames[by])}
      className={className}
    />
  );

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
              {header("rank", text.columns.rank, "num scout-col-rank")}
              {header("name", text.departures.columns.player, "col-name")}
              {header("age", text.departures.columns.age, "num")}
              {header("ca", text.columns.ca, "num")}
              {header("pa", text.columns.pa, "num")}
              {header("value", text.departures.columns.value, "num")}
              {header("wage", text.departures.columns.wage, "num")}
              {header("contract", text.departures.columns.contract)}
              <th>{text.departures.columns.advice}</th>
              <th>{text.departures.columns.reasons}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ departure: d, rank }) => (
              <tr key={d.player.uid}>
                <td className="num muted scout-col-rank">{rank}</td>
                <td className="col-name">
                  <PlayerName player={d.player} onOpen={onOpen} sub={text.departures.rank(depthLineName(d.line), d.rank)} />
                </td>
                <td className="num">{d.player.age ?? text.none}</td>
                <td className="num scout-ca">{d.player.currentAbility}</td>
                <td className="num muted">{d.player.potentialAbility}</td>
                <td className="num">
                  {d.notForSale ? text.reasons.notForSale("") : d.value === null ? text.none : formatMoney(d.value)}
                </td>
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
