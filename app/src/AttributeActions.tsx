// Above a player's attributes while his profile is read: Max attributes, which sets every one of them to its best at
// once, and the box that freezes them.

import { useContext, useEffect, useRef, useState } from "react";
import { changeLog, freezeAttributes, frozenPlayers, maxAttributes, undoBatch } from "./editing";
import { describeError } from "./format";
import { fieldLabel, massEditText, profileText } from "./labels";
import { undoFailureLines } from "./massDraft";
import type { PlayerDetails } from "./types";
import { EditorContext, useEditSession } from "./useProfileEditing";

/** What the last Max attributes, or the undo of it, came to. */
interface Outcome {
  message: string;
  /** Whether the message is why it did not happen. */
  failed: boolean;
  /** Under the message: what the game refused, as lines of text. */
  problems: string[];
  /** The batch the Undo beside the message takes back; null when nothing was written, or once it is undone. */
  batch: number | null;
}

/** Most refusals the line under the buttons lists. */
const PROBLEMS_SHOWN = 5;

/**
 * Max attributes, with what it wrote and the button that takes it back, and Freeze attributes, with what freezing does
 * while it is on. Both wait while the game cannot be written to, and say why. Not there while the player is edited:
 * the inputs hold his attributes then.
 */
export function AttributeActions({ details }: { details: PlayerDetails }) {
  const uid = details.uid;
  const { editable, readOnlyNote, onEdited } = useContext(EditorContext);
  const editing = useEditSession() !== null;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Whether his attributes are frozen; null until the app has said.
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const alive = useRef(true);
  const resultBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // An undo takes its button away with it: focus goes to the line that says what it did, so that someone using the
  // keyboard stays here.
  useEffect(() => {
    if (outcome && document.activeElement === document.body) {
      resultBox.current?.focus();
    }
  }, [outcome]);

  // Asked again whenever the profile is read again: the squad tab of his club may have frozen him meanwhile.
  useEffect(() => {
    let current = true;
    frozenPlayers()
      .then((players) => current && setFrozen(players.includes(uid)))
      .catch(() => current && setFrozen(false));
    return () => {
      current = false;
    };
  }, [uid, details]);

  if (editing) {
    return null;
  }

  /** Writes with `task`; the button that started it is only dimmed meanwhile (aria-disabled), so it keeps focus. */
  const write = async (task: () => Promise<Outcome>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const done = await task();
      if (alive.current) {
        setOutcome(done);
      }
      // The game has changed: the lists, the profile and the change log read it again.
      onEdited();
    } catch (e) {
      if (alive.current) {
        setOutcome({ message: describeError(e), failed: true, problems: [], batch: null });
      }
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const max = () =>
    write(async () => {
      const report = await maxAttributes(uid);
      const lines = report.failed
        .slice(0, PROBLEMS_SHOWN)
        .map(({ field, error }) => `${fieldLabel("player", field)}: ${describeError(error)}`);
      const more = report.failed.length - PROBLEMS_SHOWN;
      return {
        message: profileText.maxAttributesDone(report.applied),
        failed: false,
        problems: more > 0 ? [...lines, massEditText.more(more)] : lines,
        batch: report.applied > 0 ? report.batch : null,
      };
    });

  const undo = (batch: number) =>
    write(async () => {
      const done = await undoBatch(batch);
      // The log names the fields behind the changes that could not be taken back.
      const log = done.failed.length > 0 ? await changeLog().catch(() => []) : [];
      return {
        message: profileText.maxAttributesUndone(done.undone),
        failed: false,
        problems: undoFailureLines(done.failed, log),
        batch: null,
      };
    });

  const freeze = async (on: boolean) => {
    setFreezeError(null);
    try {
      const players = await freezeAttributes(uid, on);
      if (alive.current) {
        setFrozen(players.includes(uid));
      }
      // Nothing in the game has changed, but the squad tab of his club says who is frozen: it reads again.
      onEdited();
    } catch (e) {
      if (alive.current) {
        setFreezeError(describeError(e));
      }
    }
  };

  return (
    <div className="attribute-actions">
      <div className="attribute-buttons">
        <button
          type="button"
          className="max-toggle"
          disabled={!editable}
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          title={editable ? profileText.maxAttributesTitle : readOnlyNote}
          onClick={() => void max()}
        >
          {profileText.maxAttributes}
        </button>
        {frozen !== null && (
          <label className="freeze-toggle" title={editable ? profileText.freezeAttributesNote : readOnlyNote}>
            <input
              type="checkbox"
              checked={frozen}
              disabled={!editable}
              onChange={(e) => void freeze(e.currentTarget.checked)}
            />
            <span>{profileText.freezeAttributes}</span>
          </label>
        )}
      </div>
      {/* A live region that is always there, so that it is read out when it fills; it takes no room while empty. */}
      <div ref={resultBox} className="squad-result" role="status" tabIndex={-1}>
        {outcome && (
          <>
            <div className="squad-result-line">
              <p className={outcome.failed ? "error" : undefined}>{outcome.message}</p>
              {outcome.batch !== null && (
                <button
                  type="button"
                  className="max-toggle"
                  aria-disabled={busy || undefined}
                  title={profileText.undoMaxTitle}
                  onClick={() => outcome.batch !== null && void undo(outcome.batch)}
                >
                  {profileText.undoMax}
                </button>
              )}
            </div>
            {outcome.problems.length > 0 && (
              <ul className="edit-problems">
                {outcome.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {frozen && <p className="note">{profileText.freezeAttributesNote}</p>}
      {freezeError && (
        <p className="note error" role="alert">
          {freezeError}
        </p>
      )}
    </div>
  );
}
