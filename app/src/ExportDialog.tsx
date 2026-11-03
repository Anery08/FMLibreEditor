// Exporting players: the button in the toolbar of the player list, and the dialog it opens. The dialog writes what the
// list's search and filters select, in its order, to a CSV or JSON file in the exports folder. It only reads the game.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "./api";
import { describeError } from "./format";
import { locale } from "./i18n";
import { exportText as text } from "./labels";
import type { ListState } from "./ListBrowser";
import type { ExportFormat, ExportReport, PlayerFilter, PlayerOrder } from "./types";
import { useModal } from "./useModal";

const FORMATS: readonly ExportFormat[] = ["csv", "csvSemicolon", "json"];

/** Where the format chosen last is kept. */
const STORAGE_KEY = "fmlibre.exportFormat";

/**
 * The format chosen last; at first, CSV with semicolons in a language whose Excel writes decimals with a comma (Turkish
 * and Spanish), and with commas in English.
 */
function startFormat(): ExportFormat {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const known = FORMATS.find((format) => format === saved);
    if (known !== undefined) {
      return known;
    }
  } catch {
    // No storage: the language decides.
  }
  return locale === "en" ? "csv" : "csvSemicolon";
}

/** What an export writes: the list as it was when the dialog opened. */
interface ExportScope {
  query: string;
  filter: PlayerFilter | undefined;
  order: PlayerOrder | null;
  /** How many players the search and the filters select. */
  total: number;
}

interface ExportButtonProps {
  /** The search text and the total of the list, from its toolbar. */
  list: ListState;
  /** The list's filter and order, as it sends them to its search: none of either when nothing is chosen. */
  filter: PlayerFilter | undefined;
  order: PlayerOrder | null;
}

/** The Export button of the player list, and the dialog it opens. It reads only, so it is there read-only too. */
export function ExportButton({ list, filter, order }: ExportButtonProps) {
  const [scope, setScope] = useState<ExportScope | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Once the dialog is gone, focus goes back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && scope === null) {
      button.current?.focus();
    }
    wasOpen.current = scope !== null;
  }, [scope]);

  // The total is null while the list is still asking for the search and filters it shows.
  const { total } = list;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="export-toggle"
        aria-haspopup="dialog"
        disabled={total === null}
        title={text.buttonTitle}
        onClick={() => total !== null && setScope({ query: list.query, filter, order, total })}
      >
        {text.button}
      </button>
      {scope && <ExportDialog scope={scope} onClose={() => setScope(null)} />}
    </>
  );
}

/**
 * The format, what a file holds, and Export; once written, the file and its folder, with Open and Show in folder. Each
 * Export writes a new file, so another format can follow.
 */
function ExportDialog({ scope, onClose }: { scope: ExportScope; onClose: () => void }) {
  const titleId = useId();
  const scopeId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [format, setFormat] = useState<ExportFormat>(startFormat);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useModal(dialog, !busy, onClose);

  useEffect(() => {
    alive.current = true;
    dialog.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // What was written is read out, and the line takes focus: the buttons for the file are beside it.
  useEffect(() => {
    if (report !== null) {
      result.current?.focus();
    }
  }, [report]);

  const choose = (next: ExportFormat) => {
    setFormat(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not kept for next time; this export still uses it.
    }
  };

  const run = async () => {
    if (busy || scope.total === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const args = { query: scope.query, filter: scope.filter, order: scope.order ?? undefined, format };
      const done = await call<ExportReport>("export_players", args);
      if (alive.current) {
        setReport(done);
      }
    } catch (e) {
      if (alive.current) {
        setError(describeError(e));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const reveal = async (command: "open_export" | "show_export") => {
    if (report === null) {
      return;
    }
    setError(null);
    try {
      await call(command, { path: report.path });
    } catch (e) {
      setError(describeError(e));
    }
  };

  return createPortal(
    // A click beside the dialog does nothing, and keeps focus where it is.
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
    >
      <div
        ref={dialog}
        className="modal export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={scopeId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{text.title}</h2>
          <p id={scopeId} className="mass-scope">
            {text.scope(scope.total)}
          </p>
        </header>

        <div className="modal-body">
          <fieldset className="export-formats" disabled={busy}>
            <legend>{text.formatLabel}</legend>
            {FORMATS.map((option) => (
              <label key={option} className="export-format">
                <input
                  type="radio"
                  name="export-format"
                  value={option}
                  checked={format === option}
                  onChange={() => choose(option)}
                />
                <span>
                  <span className="export-format-name">{text.formats[option]}</span>
                  <span className="export-format-hint">{text.formatHints[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="export-contents">{text.contents}</p>
        </div>

        {/* What the export wrote: a live region that is always there, and a Tab stop once it has something to say. */}
        <div ref={result} className="mass-result" role="status" aria-live="polite" tabIndex={report ? 0 : -1}>
          {report !== null && (
            <>
              <p>{text.done(report.players, report.file)}</p>
              <p className="export-folder">{text.folder(report.folder)}</p>
              {report.skipped > 0 && <p>{text.skipped(report.skipped)}</p>}
            </>
          )}
        </div>
        {error !== null && (
          <div className="banner mass-error" role="alert">
            {error}
          </div>
        )}

        <footer className="modal-foot">
          {report !== null && (
            <>
              <button type="button" className="primary" title={text.openTitle} onClick={() => void reveal("open_export")}>
                {text.open}
              </button>
              <button type="button" title={text.showTitle} onClick={() => void reveal("show_export")}>
                {text.show}
              </button>
            </>
          )}
          <span className="export-foot-gap" />
          <button
            type="button"
            className={report === null ? "primary" : undefined}
            disabled={busy || scope.total === 0}
            onClick={() => void run()}
          >
            {busy ? text.exporting : text.export}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            {text.close}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
