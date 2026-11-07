// The Nationality and homegrown group of a player's profile: his secondary nationalities, and the nations and clubs
// he was trained in, which decide whether he counts as homegrown under a competition's rules (as the game's
// eligibility page shows them). The button under it opens the dialog that changes them: each change is written at
// once, logged like any change and undone from the Changes view.

import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClubSearch } from "./ClubSearch";
import { addTie, changeTie, homegrownRules, listNations, removeTie } from "./editing";
import { describeError } from "./format";
import { InfoTip } from "./InfoTip";
import { tieText as text } from "./labels";
import { ClubLine } from "./MoveDialog";
import { ClubLogo, NationFlag, PICTURE_SIZE, WithPicture } from "./Picture";
import { Fact } from "./ProfileParts";
import type { ClubSummary, Nation, PlayerDetails, Tie, TieKind } from "./types";
import { useModal } from "./useModal";
import { EditorContext } from "./useProfileEditing";

/** The name of a homegrown rule: the game's, or its number for one without a name here. */
export function ruleLabel(code: number): string {
  return text.rules[code] ?? text.rule(code);
}

/** The three kinds of tie, as the group and the dialog list them. */
const SECTIONS: readonly { kind: TieKind; label: string }[] = [
  { kind: "nationality", label: text.nationalities },
  { kind: "trainedInNation", label: text.trainedInNation },
  { kind: "trainedAtClub", label: text.trainedAtClub },
  { kind: "workPermit", label: text.workPermit },
];

/**
 * The nations a player can be given a work permit exemption for: those the game gives one for, by UID (England,
 * Scotland), or by name where the UIDs are not the game's (the browser preview).
 */
const PERMIT_NATIONS: readonly { uid: number; name: string }[] = [
  { uid: 765, name: "England" },
  { uid: 793, name: "Scotland" },
];

const tieName = (tie: Tie) => tie.name ?? String(tie.targetUid);

/** A tie as one line: the flag or logo and the name, and for a training its rule unless `rule` is false. */
function TieLine({ tie, rule = true }: { tie: Tie; rule?: boolean }) {
  const picture =
    tie.tie === "trainedAtClub" ? (
      <ClubLogo uid={tie.targetUid} name={tieName(tie)} size={PICTURE_SIZE.textLogo} />
    ) : (
      <NationFlag uid={tie.targetUid} />
    );
  return (
    <WithPicture inline picture={picture}>
      {tieName(tie)}
      {rule && tie.rule !== null && <span className="tie-rule">{` · ${ruleLabel(tie.rule)}`}</span>}
      {tie.days !== null && <span className="tie-rule">{` · ${text.daysLeft(tie.days)}`}</span>}
    </WithPicture>
  );
}

/** The group in the profile, and the button that opens the dialog while the game can be written to. */
export function TiesGroup({ details }: { details: PlayerDetails }) {
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
    <section className="profile-group">
      <h3>{text.heading}</h3>
      <dl className="stats ties">
        {SECTIONS.map(({ kind, label }) => {
          const ties = details.ties.filter((tie) => tie.tie === kind);
          return (
            <Fact key={kind} label={label}>
              {ties.length === 0 ? (
                <span className="muted">{text.none}</span>
              ) : (
                <ul className="tie-list">
                  {ties.map((tie) => (
                    <li key={tie.index}>
                      <TieLine tie={tie} />
                    </li>
                  ))}
                </ul>
              )}
            </Fact>
          );
        })}
      </dl>
      <div className="ties-foot">
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
      {open && <TiesDialog details={details} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** The homegrown rules the editor writes, fetched once; they never change. */
let rulesFetched: Promise<number[]> | null = null;
const writableRules = () => (rulesFetched ??= homegrownRules());

interface TiesDialogProps {
  details: PlayerDetails;
  onClose: () => void;
}

/** Which club search is open in the dialog: one that points a club he was trained at at another, or the one that adds. */
type Picking = { kind: "change"; tie: Tie } | { kind: "add" } | null;

/**
 * The player's ties with the controls that change them: a nation's select and a training's rule, Remove, and rows
 * that add a nationality, a nation or a club, where his list has room or the app grows it. A club he was
 * trained at is changed, and one added, with a search for the club. A write keeps every control busy until the profile
 * has read the game again; then the dialog shows the ties the game holds.
 */
function TiesDialog({ details, onClose }: TiesDialogProps) {
  const { onEdited } = useContext(EditorContext);
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const addClubButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [nations, setNations] = useState<Nation[]>([]);
  const [rules, setRules] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The nation and rule of the row that adds a training.
  const [newNation, setNewNation] = useState("");
  const [newRule, setNewRule] = useState(1);
  // The club search that is open, the club picked to add, and its rule.
  const [picking, setPicking] = useState<Picking>(null);
  const [newClub, setNewClub] = useState<ClubSummary | null>(null);
  const [newClubRule, setNewClubRule] = useState(1);

  useModal(dialog, !busy, onClose);

  useEffect(() => {
    alive.current = true;
    closeButton.current?.focus();
    const failed = (e: unknown) => alive.current && setError(describeError(e));
    listNations().then((all) => alive.current && setNations(all.filter((nation) => nation.uid !== null)), failed);
    writableRules().then((codes) => alive.current && setRules(codes), failed);
    return () => {
      alive.current = false;
    };
  }, []);

  // The control that had focus when a write began: it is disabled while the write runs, which takes focus away.
  const focused = useRef<HTMLElement | null>(null);
  // Whether focus goes to Add a club once the write is over: the club was picked in its search.
  const focusAddClub = useRef(false);

  // The profile has read the game again: the ties are the game's, and the controls take changes again. Focus goes back
  // to the control that had it, or to Close when that control went with the tie it changed.
  useEffect(() => {
    setBusy(false);
  }, [details.ties]);

  useEffect(() => {
    if (busy) {
      return;
    }
    if (focusAddClub.current) {
      focusAddClub.current = false;
      (addClubButton.current ?? closeButton.current)?.focus();
      return;
    }
    const control = focused.current;
    if (control === null) {
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
    // A club picked in a search, which goes with the write: focus comes back to the button that opened it (Add a club
    // comes back once the write is over).
    if (focused.current?.closest(".tie-pick")) {
      focused.current =
        picking?.kind === "change"
          ? (dialog.current?.querySelector<HTMLElement>(`[data-change-club="${picking.tie.index}"]`) ?? null)
          : null;
      focusAddClub.current = picking?.kind === "add";
    }
    setBusy(true);
    setError(null);
    try {
      await change();
      setNewNation("");
      setPicking(null);
      setNewClub(null);
      // The game has changed: the lists, the profile and the change log read it again.
      onEdited();
    } catch (e) {
      if (alive.current) {
        // The search stays as it was, and so does focus: the error says what went wrong.
        focusAddClub.current = false;
        setError(describeError(e));
        setBusy(false);
      }
    }
  };

  const uid = details.uid;
  const ruleOptions = (current: number | null) =>
    (current === null || rules.includes(current) ? rules : [...rules, current]).map((code) => (
      <option key={code} value={code} disabled={!rules.includes(code)}>
        {ruleLabel(code)}
      </option>
    ));
  // A nation's select offers every nation by name; the one the tie has stays offered even if the lists lack it.
  const nationOptions = (tie: Tie | null) => (
    <>
      {tie !== null && !nations.some((nation) => nation.uid === tie.targetUid) && (
        <option value={tie.targetUid}>{tieName(tie)}</option>
      )}
      {nations.map((nation) => (
        <option key={nation.address} value={nation.uid ?? ""}>
          {nation.name}
        </option>
      ))}
    </>
  );

  const row = (tie: Tie) => {
    const name = tieName(tie);
    return (
      <li key={tie.index} className="tie-row">
        {tie.tie === "trainedAtClub" || tie.tie === "workPermit" ? (
          <span className="tie-target">
            <TieLine tie={tie} rule={false} />
          </span>
        ) : (
          <select
            aria-label={text.nationOf(name)}
            value={tie.targetUid}
            disabled={busy}
            onChange={(e) => {
              const nation = Number(e.currentTarget.value);
              void write(() => changeTie(uid, tie.index, { nation }));
            }}
          >
            {nationOptions(tie)}
          </select>
        )}
        {tie.rule !== null && (
          <select
            aria-label={text.ruleOf(name)}
            value={tie.rule}
            disabled={busy}
            onChange={(e) => {
              const rule = Number(e.currentTarget.value);
              void write(() => changeTie(uid, tie.index, { rule }));
            }}
          >
            {ruleOptions(tie.rule)}
          </select>
        )}
        {/* The buttons stay together where the row wraps. */}
        <span className="tie-actions">
          {tie.tie === "trainedAtClub" && (
            <button
              type="button"
              disabled={busy}
              aria-expanded={picking?.kind === "change" && picking.tie.index === tie.index}
              data-change-club={tie.index}
              title={text.changeClubTitle(name)}
              onClick={() => setPicking({ kind: "change", tie })}
            >
              {text.changeClub}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            title={text.removeTitle(name)}
            onClick={() => void write(() => removeTie(uid, tie.index))}
          >
            {text.remove}
          </button>
        </span>
      </li>
    );
  };

  // A tie can be added where his list has room, or where the app grows it.
  const room = details.tieRoom > 0 || details.tiesGrow;
  // The nations he can be given a work permit exemption for: not his own, nor one he has it for already.
  const permitNations = nations.filter(
    (nation) =>
      PERMIT_NATIONS.some((permit) => permit.uid === nation.uid || permit.name === nation.name) &&
      nation.uid !== details.nationUid &&
      !details.ties.some((tie) => tie.tie === "workPermit" && tie.targetUid === nation.uid),
  );
  const addClub = () => {
    if (newClub !== null) {
      void write(() => addTie(uid, "trainedAtClub", newClub.uid, newClubRule));
    }
  };
  const stopPicking = () => {
    const was = picking;
    setPicking(null);
    setNewClub(null);
    // Focus goes back to the button that opened the search: Add a club comes back with it.
    requestAnimationFrame(() => {
      const opener =
        was?.kind === "change"
          ? dialog.current?.querySelector<HTMLButtonElement>(`[data-change-club="${was.tie.index}"]`)
          : addClubButton.current;
      opener?.focus();
    });
  };

  /** Under the clubs he was trained at: the search that changes one, or the one that adds one, and Add a club. */
  const clubControls = () => {
    if (picking?.kind === "change") {
      const name = tieName(picking.tie);
      return (
        <div className="tie-pick">
          <p className="tie-pick-head">{text.clubInsteadOf(name)}</p>
          <ClubSearch
            label={text.clubInsteadOf(name)}
            onPick={(club) => void write(() => changeTie(uid, picking.tie.index, { club: club.uid }))}
            onCancel={stopPicking}
          />
          <div className="tie-pick-foot">
            <button type="button" disabled={busy} onClick={stopPicking}>
              {text.cancel}
            </button>
          </div>
        </div>
      );
    }
    if (picking?.kind === "add") {
      return (
        <div className="tie-pick">
          <p className="tie-pick-head">{text.newClub}</p>
          {newClub === null ? (
            <ClubSearch label={text.addClub} onPick={setNewClub} onCancel={stopPicking} />
          ) : (
            <div className="move-club">
              <ClubLine uid={newClub.uid} name={newClub.name} women={newClub.women} />
              <button type="button" className="move-change" disabled={busy} onClick={() => setNewClub(null)}>
                {text.pickAnother}
              </button>
            </div>
          )}
          <div className="tie-row">
            <select
              aria-label={text.newClubRule}
              value={newClubRule}
              disabled={busy}
              onChange={(e) => setNewClubRule(Number(e.currentTarget.value))}
            >
              {ruleOptions(null)}
            </select>
          </div>
          <div className="tie-pick-foot">
            <button type="button" className="primary" disabled={busy || newClub === null} onClick={addClub}>
              {text.add}
            </button>
            <button type="button" disabled={busy} onClick={stopPicking}>
              {text.cancel}
            </button>
          </div>
        </div>
      );
    }
    if (!room) {
      return null;
    }
    return (
      <button
        ref={addClubButton}
        type="button"
        className="heal-toggle"
        disabled={busy}
        title={text.addClubTitle}
        onClick={() => setPicking({ kind: "add" })}
      >
        {text.addClub}
      </button>
    );
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
            {details.name}
          </p>
        </header>

        <div className="modal-body">
          <p className="move-note">{room ? text.hint : `${text.hint} ${text.full}`}</p>

          {SECTIONS.map(({ kind, label }) => {
            const ties = details.ties.filter((tie) => tie.tie === kind);
            return (
              <section key={kind} className="move-section" aria-labelledby={id(kind)}>
                <h3 id={id(kind)} className={kind === "workPermit" ? "tie-head" : undefined}>
                  {label}
                  {kind === "workPermit" && <InfoTip label={text.permitInfoLabel} note={text.permitInfo} />}
                </h3>
                {ties.length === 0 && <p className="muted tie-none">{text.none}</p>}
                <ul className="tie-rows">{ties.map(row)}</ul>
                {kind === "nationality" && room && (
                  <select
                    aria-label={text.addNationality}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const nation = Number(e.currentTarget.value);
                      void write(() => addTie(uid, "nationality", nation));
                    }}
                  >
                    <option value="">{text.addNationality}</option>
                    {nationOptions(null)}
                  </select>
                )}
                {kind === "trainedInNation" && room && (
                  <div className="tie-row">
                    <select
                      aria-label={text.addNation}
                      value={newNation}
                      disabled={busy}
                      onChange={(e) => setNewNation(e.currentTarget.value)}
                    >
                      <option value="">{text.addNation}</option>
                      {nationOptions(null)}
                    </select>
                    <select
                      aria-label={text.newRule}
                      value={newRule}
                      disabled={busy}
                      onChange={(e) => setNewRule(Number(e.currentTarget.value))}
                    >
                      {ruleOptions(null)}
                    </select>
                    <button
                      type="button"
                      disabled={busy || newNation === ""}
                      onClick={() => void write(() => addTie(uid, "trainedInNation", Number(newNation), newRule))}
                    >
                      {text.add}
                    </button>
                  </div>
                )}
                {kind === "trainedAtClub" && clubControls()}
                {kind === "workPermit" && room && permitNations.length > 0 && (
                  <select
                    aria-label={text.addPermit}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const nation = Number(e.currentTarget.value);
                      void write(() => addTie(uid, "workPermit", nation));
                    }}
                  >
                    <option value="">{text.addPermit}</option>
                    {permitNations.map((nation) => (
                      <option key={nation.address} value={nation.uid ?? ""}>
                        {nation.name}
                      </option>
                    ))}
                  </select>
                )}
              </section>
            );
          })}
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
