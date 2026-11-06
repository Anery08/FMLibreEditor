// Recalling a player from his loan: the dialog the Recall button of the Loan part of his profile opens. It says what
// the recall does before anything is written: today becomes the last day of the loan, and the game, when the day is
// over, ends the loan and brings him back to his club. The recall is logged like any change, and an undo from the
// Changes view puts the loan's old end back while the game has not ended it.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { recallLoan } from "./editing";
import { describeError, formatMoney } from "./format";
import { recallText as text } from "./labels";
import { ClubLine } from "./MoveDialog";
import type { LoanDetails } from "./types";
import { useModal } from "./useModal";

interface RecallDialogProps {
  uid: number;
  name: string;
  loan: LoanDetails;
  /** Called once the loan's end is written: the game has changed, so the profile reads it again. */
  onRecalled: () => void;
  onClose: () => void;
}

export function RecallDialog({ uid, name, loan, onRecalled, onClose }: RecallDialogProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const running = useRef(false);
  const [recalling, setRecalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useModal(dialog, !recalling, onClose);

  // The question is asked before anything is written: focus starts on its safe answer, Cancel.
  useEffect(() => {
    alive.current = true;
    cancelButton.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  const recall = async () => {
    if (running.current) {
      return;
    }
    running.current = true;
    setRecalling(true);
    setFailure(null);
    try {
      await recallLoan(uid);
      onRecalled();
      onClose();
    } catch (e) {
      if (alive.current) {
        setFailure(describeError(e));
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setRecalling(false);
      }
    }
  };

  const parent = loan.parent ?? "";
  // What the game itself would not allow, by the loan's terms: the recall here moves the loan's last day all the same.
  const terms = loan.terms;
  const refusals =
    terms === null
      ? []
      : [
          ...(terms.canBeRecalled ? [] : [text.notRecallable(parent)]),
          ...(terms.canBeTerminated ? [] : [text.notTerminable]),
        ];
  // A loan with an option to buy loses it, as the game might sell him to the club he is on loan at when it ends.
  const optionFee = terms?.optionFee ?? null;
  const [first, ...rest] = text.does(parent);
  const does =
    optionFee !== null && optionFee > 0
      ? [first, text.dropsOption(loan.club ?? "", formatMoney(optionFee)), ...rest]
      : [first, ...rest];
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
        className="modal move-dialog recall-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        aria-describedby={id("player")}
        aria-busy={recalling || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={id("title")}>{text.title}</h2>
          <p id={id("player")} className="move-player">
            {name}
          </p>
        </header>

        <div className="modal-body">
          {loan.club !== null && (
            <section className="move-section" aria-labelledby={id("from")}>
              <h3 id={id("from")}>{text.from}</h3>
              <div className="move-club">
                <ClubLine uid={loan.clubUid} name={loan.club} />
              </div>
            </section>
          )}
          {loan.parent !== null && (
            <section className="move-section" aria-labelledby={id("to")}>
              <h3 id={id("to")}>{text.to}</h3>
              <div className="move-club">
                <ClubLine uid={loan.parentUid} name={loan.parent} />
              </div>
            </section>
          )}

          {refusals.length > 0 && (
            <section className="move-section recall-terms" aria-labelledby={id("terms")}>
              <h3 id={id("terms")}>{text.termsHeading}</h3>
              <ul className="move-facts">
                {refusals.map((line) => (
                  <li key={line} className="refused">
                    {line}
                  </li>
                ))}
                <li>{text.worksAnyway}</li>
              </ul>
            </section>
          )}

          <section className="move-section" aria-labelledby={id("does")}>
            <h3 id={id("does")}>{text.doesHeading}</h3>
            <ul className="move-facts">
              {does.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>

        {failure !== null && (
          <div className="banner move-error" role="alert">
            {failure}
          </div>
        )}

        <footer className="modal-foot">
          <span className="move-foot-note">{text.hint}</span>
          <button type="button" className="primary" disabled={recalling} onClick={() => void recall()}>
            {recalling ? text.confirming : text.confirm}
          </button>
          <button ref={cancelButton} type="button" disabled={recalling} onClick={onClose}>
            {text.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
