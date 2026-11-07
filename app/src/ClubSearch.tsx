// A search for a club: a box that lists the best clubs by reputation until something is typed, then the best matches
// of it. The arrows move through the list, Enter or a click picks the club, and Escape gives up. Focus stays in the box.
// The Transfer dialog has a search of its own, which keeps to the clubs a player can move to; this one lists them all.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { call } from "./api";
import { describeError } from "./format";
import { clubListText, moveText } from "./labels";
import { ClubLine } from "./MoveDialog";
import { ReputationMeter } from "./ProfileParts";
import type { ClubPage, ClubSummary } from "./types";

/** How many clubs the list shows. */
const RESULT_LIMIT = 8;

/** How long the search waits after the last key, so that a burst of keys asks the game once. */
const SEARCH_DELAY = 150;

/** What the search answered for the text it was asked with: a page of clubs, or why it failed. */
type Found = { query: string; page: ClubPage } | { query: string; error: string };

interface ClubSearchProps {
  /** The box's name for assistive technology. */
  label: string;
  onPick: (club: ClubSummary) => void;
  /** Escape in the box. */
  onCancel: () => void;
}

export function ClubSearch({ label, onPick, onCancel }: ClubSearchProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const keyboardMoved = useRef(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // The clubs are asked for a moment after the last key; an answer that comes after the text changed is dropped.
  useEffect(() => {
    let cancelled = false;
    const answer = (next: Found) => {
      if (!cancelled) {
        setFound(next);
        setActive(0);
      }
    };
    const timer = setTimeout(
      () => {
        call<ClubPage>("search_clubs", { query, limit: RESULT_LIMIT, filter: {} }).then(
          (page) => answer({ query, page }),
          (e) => answer({ query, error: describeError(e) }),
        );
      },
      // The first look, at the best clubs, needs no wait.
      query === "" ? 0 : SEARCH_DELAY,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (keyboardMoved.current) {
      keyboardMoved.current = false;
      results.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  const rows = found !== null && "page" in found ? found.page.rows : [];
  const settled = found !== null && found.query === query;
  const note =
    found === null
      ? moveText.searching
      : !settled
        ? ""
        : "error" in found
          ? moveText.searchFailed(found.error)
          : found.page.rows.length === 0
            ? clubListText.empty(query, false)
            : found.page.total > found.page.rows.length
              ? moveText.more(found.page.total - found.page.rows.length)
              : "";
  const noteIsError = found !== null && settled && "error" in found;

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // The arrows move through the clubs, not the caret.
      event.preventDefault();
      if (rows.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        keyboardMoved.current = true;
        setActive((index) => (index + step + rows.length) % rows.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (settled && row) {
        onPick(row);
      }
    } else if (event.key === "Escape") {
      // Only the search goes: the dialog around it stays.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="club-search">
      <label className="search move-search">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4.5 4.5" />
        </svg>
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={id("clubs")}
          aria-activedescendant={rows.length > 0 ? id(`club-${active}`) : undefined}
          value={query}
          placeholder={clubListText.search}
          spellCheck={false}
          autoComplete="off"
          // Escape gives up the search, not the dialog around it (see `useModal`).
          data-takes-escape=""
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={keyDown}
        />
      </label>
      {/* The box keeps the room of a full list, so that the dialog does not jump as results come and go. */}
      <div className="move-results-box" aria-busy={!settled || undefined}>
        <ul ref={results} id={id("clubs")} className="move-results" role="listbox" aria-label={moveText.resultsLabel}>
          {rows.map((row, index) => (
            <li
              key={row.uid}
              id={id(`club-${index}`)}
              className={index === active ? "move-option active" : "move-option"}
              role="option"
              aria-selected={index === active}
              // Focus stays in the search box: a click only picks.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(row)}
            >
              <ClubLine uid={row.uid} name={row.name} women={row.women} />
              <ReputationMeter value={row.reputation} />
            </li>
          ))}
        </ul>
        <p className={noteIsError ? "move-results-note error" : "move-results-note"} role="status">
          {note}
        </p>
      </div>
    </div>
  );
}
