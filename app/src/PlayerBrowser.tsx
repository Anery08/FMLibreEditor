import { useState } from "react";
import { Ability } from "./Ability";
import { ComparisonTray } from "./Comparison";
import { ExportButton } from "./ExportDialog";
import { formatDate } from "./format";
import { playerListText, positionLabel, profileText } from "./labels";
import { ListBrowser } from "./ListBrowser";
import { MassEditButton } from "./MassEditDialog";
import { ClubLogo, NationFlag, PICTURE_SIZE, WithPicture } from "./Picture";
import { countFilters, PlayerFilterBar, toPlayerFilter, type PlayerFilterFields } from "./PlayerFilters";
import { PlayerProfile } from "./PlayerProfile";
import { restored, useSnapshot } from "./restore";
import { SavedFilterControls } from "./SavedFilterControls";
import { readFields, readOrder } from "./savedFilters";
import type { PlayerOrder, PlayerSort, PlayerSummary } from "./types";
import { useComparison } from "./useComparison";

const text = playerListText;

/** What the list is in until a column header is clicked: the best players first. */
const DEFAULT_ORDER: PlayerOrder = { by: "currentAbility", ascending: false };

/** The columns whose first click sorts from A to Z or from the earliest date; the numbers start with the highest. */
const FIRST_ASCENDING: ReadonlySet<PlayerSort> = new Set<PlayerSort>(["name", "nation", "club", "contractExpires"]);

/** How many positions a row shows before the ellipsis; its hover text has all of them. */
const POSITIONS_SHOWN = 3;

interface PlayerBrowserProps {
  version: number;
  active: boolean;
  /** Whether the game's layout tells women from men, for the filter that keeps to one of them. */
  genderKnown: boolean;
  /** A player to show from elsewhere, e.g. one picked in a club's squad (see `ListBrowser`'s `open`). */
  open: { row: PlayerSummary } | null;
}

/** The players table with the profile of the selected player beside it. */
export function PlayerBrowser({ version, active, genderKnown, open }: PlayerBrowserProps) {
  // The filters and the sort start as they were before the language was switched, if it was (see `restore.ts`).
  const [fields, setFields] = useState<PlayerFilterFields>(() => restored("playerFields", readFields));
  // Null until a header is clicked: no order is asked for, and the search answers with the best current ability first.
  const [order, setOrder] = useState<PlayerOrder | null>(() => restored("playerOrder", readOrder));
  useSnapshot("playerFields", () => fields);
  useSnapshot("playerOrder", () => order);
  // The players picked for a comparison. They are kept here, as the list is: every list stays mounted while another
  // view is shown (see `App`), so the set survives switching views.
  const comparison = useComparison();

  // Where the layout cannot tell women from men, the bar offers no such choice, and a saved filter that made one is
  // taken without it.
  const filter = toPlayerFilter(genderKnown ? fields : { ...fields, gender: "" });
  const filterCount = countFilters(filter);
  const sorted = order ?? DEFAULT_ORDER;
  const sortBy = (by: PlayerSort) =>
    setOrder({ by, ascending: sorted.by === by ? !sorted.ascending : FIRST_ASCENDING.has(by) });
  const sortHeader = (by: PlayerSort, className?: string) => (
    <SortHeader by={by} order={sorted} onSort={sortBy} className={className} />
  );

  return (
    <ListBrowser<PlayerSummary>
      name="players"
      command="search_players"
      requestArgs={{ filter, order: order ?? undefined }}
      version={version}
      active={active}
      placeholder={text.search}
      summary={(total, shown) =>
        text.summary(total, shown, order && { by: text.sortNames[order.by], ascending: order.ascending })
      }
      empty={(query) => text.empty(query, filterCount > 0)}
      filterBar={
        <PlayerFilterBar
          fields={fields}
          onChange={setFields}
          active={filterCount}
          genderKnown={genderKnown}
          actions={
            <SavedFilterControls
              fields={fields}
              order={order}
              filtered={filterCount > 0}
              onApply={(savedFields, savedOrder) => {
                setFields(savedFields);
                setOrder(savedOrder);
              }}
            />
          }
        />
      }
      toolbarActions={(list) => (
        <>
          <ExportButton list={list} filter={filter} order={order} />
          <MassEditButton entity="player" filters={{ playerFilter: filter }} list={list} />
        </>
      )}
      footer={<ComparisonTray comparison={comparison} />}
      open={open}
      tableClass="player-grid"
      header={
        <>
          {sortHeader("name", "col-name")}
          {sortHeader("age", "num col-age")}
          <th className="col-positions">{text.columns.positions}</th>
          {sortHeader("nation", "col-nation")}
          {sortHeader("club", "col-club")}
          {sortHeader("contractExpires", "col-contract")}
          <th className="col-born">{text.columns.born}</th>
          {sortHeader("currentAbility", "num col-ca")}
          {sortHeader("potentialAbility", "num col-pa")}
          <th className="num col-uid">{text.columns.uid}</th>
        </>
      }
      cells={(p) => (
        <>
          {/* The hover text has what a long name, nation or club is cut to. */}
          <td className="col-name" title={p.fullName && p.fullName !== p.name ? `${p.name}\n${p.fullName}` : p.name}>
            <div className="name">{p.name}</div>
            {p.fullName && p.fullName !== p.name && <div className="sub">{p.fullName}</div>}
          </td>
          <td className="num col-age">{p.age ?? profileText.none}</td>
          <PositionsCell positions={p.positions} />
          <td className="col-nation" title={p.nation ?? undefined}>
            <WithPicture picture={<NationFlag uid={p.nationUid} />}>{p.nation ?? profileText.none}</WithPicture>
          </td>
          <td className="col-club" title={p.club ?? undefined}>
            <WithPicture picture={<ClubLogo uid={p.clubUid} name={p.club} size={PICTURE_SIZE.rowLogo} />}>
              {p.club ?? <span className="muted">{profileText.freeAgent}</span>}
            </WithPicture>
          </td>
          <td className="date col-contract">{formatDate(p.contractExpires) || profileText.none}</td>
          <td className="date col-born">{formatDate(p.dateOfBirth)}</td>
          <td className="num col-ca">
            <Ability value={p.currentAbility} />
          </td>
          <td className="num col-pa">
            <Ability value={p.potentialAbility} />
          </td>
          <td className="num uid col-uid">{p.uid}</td>
        </>
      )}
      profile={(p, panel) => (
        <PlayerProfile player={p} version={panel.version} onClose={panel.onClose} comparison={comparison} />
      )}
    />
  );
}

interface SortHeaderProps {
  /** The column; it is also what the list is sorted by. */
  by: PlayerSort;
  /** How the list is sorted now. */
  order: PlayerOrder;
  onSort: (by: PlayerSort) => void;
  className?: string;
}

/** A column header that sorts the list; the sorted column shows an arrow and says which way in `aria-sort`. */
function SortHeader({ by, order, onSort, className }: SortHeaderProps) {
  const direction = order.by !== by ? undefined : order.ascending ? "ascending" : "descending";
  return (
    <th className={className} aria-sort={direction}>
      <button type="button" className="sort" title={text.sortBy(text.sortNames[by])} onClick={() => onSort(by)}>
        {text.columns[by]}
        <svg className="sort-arrow" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 8.5v-7M2 4.5l3-3 3 3" />
        </svg>
      </button>
    </th>
  );
}

/** The positions a player can play, best first: three at most, then an ellipsis; the hover text has all of them. */
function PositionsCell({ positions }: { positions: readonly string[] }) {
  if (positions.length === 0) {
    return <td className="col-positions muted">{profileText.none}</td>;
  }
  const labels = positions.map(positionLabel);
  return (
    <td className="col-positions" title={labels.join(" ")}>
      {labels.slice(0, POSITIONS_SHOWN).join(" ")}
      {labels.length > POSITIONS_SHOWN && " …"}
    </td>
  );
}
