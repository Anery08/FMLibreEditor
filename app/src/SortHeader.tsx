/** How a table is sorted: by one of its columns, one way or the other. */
export interface ColumnOrder<Sort extends string> {
  by: Sort;
  ascending: boolean;
}

interface SortHeaderProps<Sort extends string> {
  /** The column; it is also what the table is sorted by. */
  by: Sort;
  /** How the table is sorted now. */
  order: ColumnOrder<Sort>;
  onSort: (by: Sort) => void;
  /** The column's name, and the hover text of the button that sorts by it. */
  label: string;
  title: string;
  className?: string;
}

/**
 * A column header that sorts a table, in the player and staff lists and a club's squad: the sorted column shows an
 * arrow and says which way in `aria-sort`.
 */
export function SortHeader<Sort extends string>({ by, order, onSort, label, title, className }: SortHeaderProps<Sort>) {
  const direction = order.by !== by ? undefined : order.ascending ? "ascending" : "descending";
  return (
    <th className={className} aria-sort={direction}>
      <button type="button" className="sort" title={title} onClick={() => onSort(by)}>
        {label}
        <svg className="sort-arrow" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 8.5v-7M2 4.5l3-3 3 3" />
        </svg>
      </button>
    </th>
  );
}
