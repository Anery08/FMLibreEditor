// Making a player's loan permanent: the dialog the Make permanent button of the Loan part of his profile opens. He stays
// where he plays, now under contract with the club he is on loan to, and leaves his own club. The dialog takes a fee
// (which the club he stays at pays his own one) and a new wage and contract end if wanted, asks the game whether it can
// be done before it offers to, and does it. It is logged like a transfer between the two clubs, and one undo from the
// Changes view puts the loan back.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPounds, toShown } from "./currency";
import { isoFromNumber, makeLoanPermanent, numberFromDate, planLoanPermanent } from "./editing";
import { currencySymbol, describeError, formatAmount, formatDate, formatMoney } from "./format";
import { fieldLabel, moveText, permanentText as text, profileText } from "./labels";
import { ClubLine } from "./MoveDialog";
import {
  inputClass,
  judgeExpires,
  judgeFee,
  judgeWage,
  MAX_FEE_SHOWN,
  moneyLine,
  PLAN_DELAY,
  termNote,
  termsOf,
} from "./moveTerms";
import type { Contract, LoanDetails, MovePreview, MoveTerms } from "./types";
import { useModal } from "./useModal";

interface PermanentDialogProps {
  uid: number;
  name: string;
  loan: LoanDetails;
  /** His own contract, whose wage and end the inputs start from. */
  contract: Contract;
  /** Called once the loan is permanent: the game has changed, so the lists and the profile read it again. */
  onDone: () => void;
  onClose: () => void;
}

/** What the game said to the plan, for the terms and fee it was asked about. */
interface Planned {
  key: string;
  outcome: { preview: MovePreview } | { error: string };
}

const planKey = (terms: MoveTerms, fee: number | undefined) => `${terms.wage ?? ""}:${terms.expires ?? ""}:${fee ?? ""}`;

export function PermanentDialog({ uid, name, loan, contract, onDone, onClose }: PermanentDialogProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const running = useRef(false);

  // The wage as his contract has it, in pounds; the input holds it in the chosen currency.
  const wasWage = contract.wage;
  const wasWageShown = toShown(wasWage);
  const wasExpires = contract.expires ? numberFromDate(contract.expires) : null;
  const [wageText, setWageText] = useState(String(wasWageShown));
  const [expiresText, setExpiresText] = useState(wasExpires === null ? "" : isoFromNumber(wasExpires));
  // The fee starts as the loan's option to buy, where it has one: what the game would have the club pay to keep him.
  const optionFee = loan.terms?.optionFee ?? null;
  const hasOption = optionFee !== null && optionFee > 0;
  const [feeText, setFeeText] = useState(hasOption ? String(toShown(optionFee)) : "");
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [making, setMaking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useModal(dialog, !making, onClose);

  // Nothing is offered until the game has said yes, so focus starts on Cancel.
  useEffect(() => {
    alive.current = true;
    cancelButton.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  const wageVerdict = judgeWage(wageText, wasWageShown);
  const expiresVerdict = judgeExpires(expiresText, wasExpires);
  const feeVerdict = judgeFee(feeText);
  const valid =
    wageVerdict.status !== "invalid" && expiresVerdict.status !== "invalid" && feeVerdict.status !== "invalid";
  const wage = wageVerdict.status === "changed" ? toPounds(wageVerdict.value) : undefined;
  const expires = expiresVerdict.status === "changed" ? expiresVerdict.value : undefined;
  const fee = feeVerdict.status === "changed" ? toPounds(feeVerdict.value) : undefined;
  const terms = termsOf(wage, expires);
  const key = planKey(terms, fee);

  // The plan, asked a moment after the last change of the terms or the fee; an answer for older ones is dropped.
  useEffect(() => {
    if (!valid) {
      return;
    }
    let cancelled = false;
    const asked = termsOf(wage, expires);
    const timer = setTimeout(() => {
      planLoanPermanent(uid, asked, fee).then(
        (preview) => !cancelled && setPlanned({ key: planKey(asked, fee), outcome: { preview } }),
        (e) => !cancelled && setPlanned({ key: planKey(asked, fee), outcome: { error: describeError(e) } }),
      );
    }, PLAN_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [uid, valid, wage, expires, fee]);

  const outcome = planned !== null && planned.key === key ? planned.outcome : null;
  const canMake = valid && outcome !== null && "preview" in outcome && !making;

  const make = async () => {
    if (!canMake || running.current) {
      return;
    }
    running.current = true;
    setMaking(true);
    setFailure(null);
    try {
      await makeLoanPermanent(uid, terms, fee);
      onDone();
      onClose();
    } catch (e) {
      if (alive.current) {
        setFailure(describeError(e));
        // The game may not be as the plan found it: the plan is asked again before it is offered again.
        setPlanned(null);
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setMaking(false);
      }
    }
  };

  // Where he goes, and what the fee does to the clubs' money; or why it cannot be done. A live region always there.
  const route = (made: MovePreview) => {
    // A loan always has the club he belongs to.
    const from = made.from?.name ?? "";
    const lines = [moveText.route(from, made.to.name)];
    if (made.fee) {
      const amount = formatMoney(made.fee.fee);
      lines.push(moneyLine(made.fee.buyer, made.to.name, amount, true));
      lines.push(moneyLine(made.fee.seller, from, amount, false));
    }
    return lines.join("\n");
  };
  const plan: { tone: "pending" | "ok" | "refused"; message: string } = !valid
    ? { tone: "pending", message: moveText.fixTerms }
    : outcome === null
      ? { tone: "pending", message: text.checking }
      : "error" in outcome
        ? { tone: "refused", message: outcome.error }
        : { tone: "ok", message: route(outcome.preview) };

  const wageNote = termNote(wageVerdict, moveText.wageInvalid, formatMoney(wasWage));
  const expiresNote = termNote(
    expiresVerdict,
    moveText.expiresInvalid,
    contract.expires ? formatDate(contract.expires) : null,
  );
  const feeNote =
    feeVerdict.status === "invalid"
      ? { message: moveText.feeInvalid(formatAmount(MAX_FEE_SHOWN)), invalid: true }
      : null;

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
        className="modal move-dialog permanent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        aria-describedby={id("player")}
        aria-busy={making || undefined}
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
            <section className="move-section" aria-labelledby={id("stays")}>
              <h3 id={id("stays")}>{text.stays}</h3>
              <div className="move-club">
                <ClubLine uid={loan.clubUid} name={loan.club} />
              </div>
            </section>
          )}
          {loan.parent !== null && (
            <section className="move-section" aria-labelledby={id("leaves")}>
              <h3 id={id("leaves")}>{text.leaves}</h3>
              <div className="move-club">
                <ClubLine uid={loan.parentUid} name={loan.parent} />
              </div>
            </section>
          )}

          <section className="move-section" aria-labelledby={id("fee-heading")}>
            <h3 id={id("fee-heading")}>{moveText.feeHeading}</h3>
            <div className="move-terms">
              <div className="move-term">
                <label htmlFor={id("fee")}>{moveText.fee}</label>
                <span className="move-money">
                  <span className="move-unit" aria-hidden="true">
                    {currencySymbol}
                  </span>
                  <input
                    id={id("fee")}
                    className={inputClass(feeVerdict)}
                    type="number"
                    min={0}
                    max={MAX_FEE_SHOWN}
                    step={1}
                    placeholder="0"
                    value={feeText}
                    readOnly={making}
                    aria-invalid={feeVerdict.status === "invalid" || undefined}
                    aria-describedby={id("fee-note")}
                    onChange={(e) => setFeeText(e.currentTarget.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </span>
                <p id={id("fee-note")} className={feeNote ? "move-note invalid" : "move-note"}>
                  {feeNote ? feeNote.message : hasOption ? text.optionFee(formatMoney(optionFee)) : moveText.feeHint}
                </p>
              </div>
            </div>
          </section>

          <section className="move-section" aria-labelledby={id("contract")}>
            <h3 id={id("contract")}>{profileText.contract}</h3>
            <div className="move-terms">
              <div className="move-term">
                <label htmlFor={id("wage")}>{fieldLabel("player", "contract.wage")}</label>
                <span className="move-money">
                  <span className="move-unit" aria-hidden="true">
                    {currencySymbol}
                  </span>
                  <input
                    id={id("wage")}
                    className={inputClass(wageVerdict)}
                    type="number"
                    min={0}
                    step={1}
                    value={wageText}
                    readOnly={making}
                    aria-invalid={wageVerdict.status === "invalid" || undefined}
                    aria-describedby={wageNote ? id("wage-note") : undefined}
                    onChange={(e) => setWageText(e.currentTarget.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </span>
                {wageNote && (
                  <p id={id("wage-note")} className={wageNote.invalid ? "move-note invalid" : "move-note"}>
                    {wageNote.message}
                  </p>
                )}
              </div>

              <div className="move-term">
                <label htmlFor={id("expires")}>{fieldLabel("player", "contract.expires")}</label>
                <input
                  id={id("expires")}
                  className={inputClass(expiresVerdict)}
                  type="date"
                  value={expiresText}
                  readOnly={making}
                  aria-invalid={expiresVerdict.status === "invalid" || undefined}
                  aria-describedby={expiresNote ? id("expires-note") : undefined}
                  onChange={(e) => setExpiresText(e.currentTarget.value)}
                />
                {expiresNote && (
                  <p id={id("expires-note")} className={expiresNote.invalid ? "move-note invalid" : "move-note"}>
                    {expiresNote.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          <p className={`move-plan ${plan.tone}`} role="status">
            {plan.message}
          </p>

          <section className="move-section" aria-labelledby={id("does")}>
            <h3 id={id("does")}>{text.doesHeading}</h3>
            <ul className="move-facts">
              {text.does.map((line) => (
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
          <button type="button" className="primary" disabled={!canMake} onClick={() => void make()}>
            {making ? text.confirming : text.confirm}
          </button>
          <button ref={cancelButton} type="button" disabled={making} onClick={onClose}>
            {text.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
