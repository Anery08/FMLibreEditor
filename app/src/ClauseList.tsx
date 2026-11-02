// The bonuses and clauses of a player's contract, in the Contract group of his profile: each by name with what it
// depends on and its amount. The button under them opens the dialog that changes them: an amount or a condition,
// Remove, and a release clause added where the contract's list has room. Each change is written at once, logged like
// any change and undone from the Changes view.

import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPounds, toShown } from "./currency";
import { addReleaseClause, changeClause, removeClause } from "./editing";
import { describeError, formatAmount, formatMoney, formatNumber } from "./format";
import { clauseText as text, profileText } from "./labels";
import { Fact } from "./ProfileParts";
import type { Clause } from "./types";
import { useModal } from "./useModal";
import { EditorContext } from "./useProfileEditing";

/**
 * The most an amount may be, in pounds, and a condition: as the editor checks them (see `clauses.rs`). The amount
 * inputs hold the chosen currency, so they take up to `MOST_AMOUNT_SHOWN`.
 */
const MOST_AMOUNT = 2_000_000_000;
const MOST_AMOUNT_SHOWN = toShown(MOST_AMOUNT);
const MOST_CONDITION = 1_000;

/** The kind of a release clause, the one the dialog adds. */
const RELEASE_CLAUSE = 0;

/** The kinds whose condition is known (goals, assists, international matches, years, a percentage): only those change. */
const KNOWN_CONDITIONS = new Set([3, 10, 15, 19, 22, 40]);

/** What a clause depends on and its amount, as one line: "10 goals · £848,768"; ✓ for one with neither. */
export function clauseDetail(clause: Clause): string {
  return (
    [
      clause.condition === null ? null : profileText.clauseCondition(clause.kind, clause.condition),
      clause.amount === null ? null : formatMoney(clause.amount),
    ]
      .filter((part) => part !== null)
      .join(" · ") || "✓"
  );
}

/** A clause as the change log names it: its name, what it depends on and its amount. */
export function clauseLine(clause: Clause): string {
  return `${profileText.clauseName(clause.kind)} · ${clauseDetail(clause)}`;
}

/** A whole number typed in an input, when it lies from 0 to `max`; null otherwise. */
function wholeNumber(typed: string, max: number): number | null {
  const value = Number(typed.trim());
  return typed.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

interface ClauseListProps {
  uid: number;
  /** The player's name, for the dialog's heading. */
  name: string;
  clauses: Clause[];
  /** How many more clauses the contract's list has room for. */
  room: number;
}

/** The list in the profile, and the button that opens the dialog while the game can be written to. */
export function ClauseList({ uid, name, clauses, room }: ClauseListProps) {
  const { editable, readOnlyNote } = useContext(EditorContext);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Once the dialog is gone, focus goes back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) {
      button.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div className="clauses">
      <div className="injuries-head">
        <h4>{profileText.clauses}</h4>
        <button
          ref={button}
          type="button"
          className="heal-toggle"
          aria-haspopup="dialog"
          disabled={!editable}
          title={editable ? text.changeTitle : readOnlyNote}
          onClick={() => setOpen(true)}
        >
          {text.change}
        </button>
      </div>
      {clauses.length === 0 ? (
        <p className="note">{profileText.noClauses}</p>
      ) : (
        <dl className="stats">
          {clauses.map((clause) => (
            <Fact key={clause.index} label={profileText.clauseName(clause.kind)}>
              {clauseDetail(clause)}
            </Fact>
          ))}
        </dl>
      )}
      {open && <ClauseDialog uid={uid} name={name} clauses={clauses} room={room} onClose={() => setOpen(false)} />}
    </div>
  );
}

interface ClauseDialogProps extends ClauseListProps {
  onClose: () => void;
}

/**
 * The clauses with the controls that change them: the amount and, for a kind whose condition is known, the
 * condition, with Save and Remove; and the row that adds a release clause where the list has room. A write keeps every
 * control busy until the profile has read the game again; then the dialog shows the clauses the game holds.
 */
function ClauseDialog({ uid, name, clauses, room, onClose }: ClauseDialogProps) {
  const { onEdited } = useContext(EditorContext);
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What is typed in each row, by the clause's index, and in the row that adds a release clause.
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [conditions, setConditions] = useState<Record<number, string>>({});
  const [newAmount, setNewAmount] = useState("");

  useModal(dialog, !busy, onClose);

  useEffect(() => {
    alive.current = true;
    closeButton.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // The control that had focus when a write began: it is disabled while the write runs, which takes focus away.
  const focused = useRef<HTMLElement | null>(null);

  // The profile has read the game again: the clauses are the game's, what was typed goes, and the controls take
  // changes again. Focus goes back to the control that had it, or to Close when it went with the clause it removed.
  useEffect(() => {
    setBusy(false);
    setAmounts({});
    setConditions({});
    setNewAmount("");
  }, [clauses]);

  useEffect(() => {
    const control = focused.current;
    if (busy || control === null) {
      return;
    }
    focused.current = null;
    (control.isConnected ? control : closeButton.current)?.focus();
  }, [busy]);

  const write = async (change: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    focused.current = dialog.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    setBusy(true);
    setError(null);
    try {
      await change();
      // The game has changed: the lists, the profile and the change log read it again.
      onEdited();
    } catch (e) {
      if (alive.current) {
        setError(describeError(e));
        setBusy(false);
      }
    }
  };

  const row = (clause: Clause) => {
    const label = profileText.clauseName(clause.kind);
    const conditionChanges = clause.condition !== null && KNOWN_CONDITIONS.has(clause.kind);
    const shownAmount = clause.amount === null ? null : toShown(clause.amount);
    const typedAmount = amounts[clause.index] ?? (shownAmount === null ? "" : String(shownAmount));
    const typedCondition = conditions[clause.index] ?? (clause.condition === null ? "" : String(clause.condition));
    const amount = clause.amount === null ? null : wholeNumber(typedAmount, MOST_AMOUNT_SHOWN);
    const condition = conditionChanges ? wholeNumber(typedCondition, MOST_CONDITION) : null;
    const invalid = (clause.amount !== null && amount === null) || (conditionChanges && condition === null);
    const change = {
      ...(amount !== null && amount !== shownAmount && { amount: toPounds(amount) }),
      ...(condition !== null && condition !== clause.condition && { condition }),
    };
    const changed = Object.keys(change).length > 0;
    return (
      <li key={clause.index} className="tie-row clause-row">
        <span className="tie-target">
          {label}
          {clause.condition !== null && !conditionChanges && (
            <span className="tie-rule">{` · ${profileText.clauseCondition(clause.kind, clause.condition)}`}</span>
          )}
        </span>
        {clause.amount !== null && (
          <input
            type="text"
            inputMode="numeric"
            className="clause-amount"
            aria-label={text.amountOf(label)}
            aria-invalid={amount === null || undefined}
            value={typedAmount}
            disabled={busy}
            onChange={(e) => {
              const typed = e.currentTarget.value;
              setAmounts((all) => ({ ...all, [clause.index]: typed }));
            }}
          />
        )}
        {conditionChanges && (
          <input
            type="text"
            inputMode="numeric"
            className="clause-condition"
            aria-label={text.conditionOf(label)}
            aria-invalid={condition === null || undefined}
            value={typedCondition}
            disabled={busy}
            onChange={(e) => {
              const typed = e.currentTarget.value;
              setConditions((all) => ({ ...all, [clause.index]: typed }));
            }}
          />
        )}
        {(clause.amount !== null || conditionChanges) && (
          <button
            type="button"
            disabled={busy || invalid || !changed}
            title={
              invalid
                ? amount === null && clause.amount !== null
                  ? text.outOfRange(formatAmount(MOST_AMOUNT_SHOWN))
                  : text.outOfRange(formatNumber(MOST_CONDITION))
                : undefined
            }
            onClick={() => void write(() => changeClause(uid, clause.index, change))}
          >
            {text.save}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          title={text.removeTitle(label)}
          onClick={() => void write(() => removeClause(uid, clause.index))}
        >
          {text.remove}
        </button>
      </li>
    );
  };

  const hasRelease = clauses.some((clause) => clause.kind === RELEASE_CLAUSE);
  const canAdd = !hasRelease && room > 0;
  const releaseAmount = wholeNumber(newAmount, MOST_AMOUNT_SHOWN);

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
        className="modal move-dialog ties-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        aria-describedby={id("player")}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={id("title")}>{text.title}</h2>
          <p id={id("player")} className="move-player">
            {name}
          </p>
        </header>

        <div className="modal-body">
          <p className="move-note">{hasRelease || canAdd ? text.hint : `${text.hint} ${text.full}`}</p>
          <section className="move-section">
            {clauses.length === 0 && <p className="muted tie-none">{profileText.noClauses}</p>}
            <ul className="tie-rows">{clauses.map(row)}</ul>
            {canAdd && (
              <div className="tie-row clause-row">
                <span className="tie-target">{text.addRelease}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="clause-amount"
                  aria-label={text.releaseAmount}
                  aria-invalid={(newAmount !== "" && releaseAmount === null) || undefined}
                  value={newAmount}
                  disabled={busy}
                  onChange={(e) => setNewAmount(e.currentTarget.value)}
                />
                <button
                  type="button"
                  disabled={busy || releaseAmount === null}
                  title={newAmount !== "" && releaseAmount === null ? text.outOfRange(formatAmount(MOST_AMOUNT_SHOWN)) : undefined}
                  onClick={() => releaseAmount !== null && void write(() => addReleaseClause(uid, toPounds(releaseAmount)))}
                >
                  {text.add}
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="ties-status" role="status">
          {busy ? text.working : ""}
        </div>
        {error !== null && (
          <div className="banner move-error" role="alert">
            {error}
          </div>
        )}

        <footer className="modal-foot">
          <button ref={closeButton} type="button" disabled={busy} onClick={onClose}>
            {text.close}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
