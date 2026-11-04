// Transferring a player to another club: the button in the header of his profile, and the dialog it opens. The dialog
// picks the club (and, if wanted, a fee and a new wage and contract end), asks the game whether the move can be made
// before it offers it, and makes it: the buying club pays the fee to the selling one. The transfer is logged like any
// change, and one undo from the Changes view takes back the move and the fee.
//
// A switch at the top of the dialog makes it a swap instead: after the club it picks one of the club's players, who
// goes the other way, and each keeps his own contract.
//
// A club whose squad list is full cannot take one more player: the editor allocates no memory in the game. The dialog
// then offers to make room, in a box where the refusal would be: one of the club's players is released in the same
// transfer, logged and undone with it, or the transfer becomes a swap with him.

import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Ability } from "./Ability";
import { call } from "./api";
import {
  isoFromNumber,
  movePlayer,
  moveStaff,
  numberFromDate,
  numberFromIso,
  planClubMove,
  planClubSwap,
  planStaffMove,
  roomMakers,
  swapPlayers,
} from "./editing";
import { toPounds, toShown } from "./currency";
import { currencySymbol, describeError, errorCode, formatAmount, formatDate, formatMoney } from "./format";
import { InfoTip } from "./InfoTip";
import {
  clubListText,
  editText,
  fieldLabel,
  moveText as text,
  positionLabel,
  profileText,
  releaseText,
} from "./labels";
import { ClubLogo, PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import { ReputationMeter } from "./ProfileParts";
import type {
  ClubMoney,
  ClubPage,
  ClubSummary,
  Contract,
  MovePreview,
  MoveTerms,
  PlayerPage,
  PlayerSummary,
  RoomMaker,
} from "./types";
import { useModal } from "./useModal";
import { EditorContext } from "./useProfileEditing";

/** The player the dialog moves, and the club he is at. */
interface MovingPlayer {
  uid: number;
  name: string;
  club: string;
  /** The club's UID, for its logo. */
  clubUid: number | null;
}

/** Who the dialog moves: a player, or a member of staff, who keeps his job and his contract's terms. */
type Kind = "player" | "staff";

interface MoveButtonProps {
  player: MovingPlayer;
  /** A player unless said otherwise. */
  kind?: Kind;
  /** His contract as the profile has read it: the inputs of the dialog start from it. Null when he has none. */
  contract: Contract | null;
  /** Whether the profile has been read: until then there is no contract for the dialog to start from. */
  ready: boolean;
}

/** The player and the contract the dialog was opened for: the profile behind it cannot change while it is up. */
interface Opened {
  player: MovingPlayer;
  contract: Contract | null;
}

/**
 * The Transfer button of a player's profile, and the dialog it opens. The profile decides when the button
 * is there (see `PlayerProfile`).
 */
export function MoveButton({ player, kind = "player", contract, ready }: MoveButtonProps) {
  const { onEdited } = useContext(EditorContext);
  const [opened, setOpened] = useState<Opened | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Once the dialog is gone, focus goes back to the button that opened it. Doing it earlier, with the dialog still
  // up, would only make the dialog take focus back.
  useEffect(() => {
    if (wasOpen.current && opened === null) {
      button.current?.focus();
    }
    wasOpen.current = opened !== null;
  }, [opened]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="move-toggle"
        aria-haspopup="dialog"
        disabled={!ready}
        title={kind === "staff" ? text.staffButtonTitle : text.buttonTitle}
        onClick={() => setOpened({ player, contract })}
      >
        {text.button}
      </button>
      {opened && (
        <MoveDialog
          player={opened.player}
          kind={kind}
          contract={opened.contract}
          onMoved={onEdited}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

/** How many clubs the search lists: the best by reputation, or the best matches of what was typed. */
const RESULT_LIMIT = 8;

/**
 * The same for the players of a club in a swap. A squad is long, so this is more than the list has room for: it
 * scrolls.
 */
const PARTNER_LIMIT = 50;

/** How long the search waits after the last key, so that a burst of keys asks the game once. */
const SEARCH_DELAY = 150;

/** The same for the plan, after the last change of the club or the terms (of a swap: of the player picked). */
const PLAN_DELAY = 200;

/** What the dialog makes: a move to a club, or a swap with one of its players. */
type Mode = "move" | "swap";

/** The two ends of the switch at the top of the dialog. */
const MODES: readonly { id: Mode; label: string }[] = [
  { id: "move", label: text.modeMove },
  { id: "swap", label: text.modeSwap },
];

/** What the search answered for the text it was asked with: a page of clubs, or why it failed. */
type Found = { query: string; page: ClubPage } | { query: string; error: string };

/** The same for the players of a club. */
type FoundPlayers = { query: string; page: PlayerPage } | { query: string; error: string };

/** The players a club with a full squad list can release to make room, as the game listed them, or why it could not. */
type Makers = { club: number; outcome: { rows: RoomMaker[] } | { error: string } };

/** What the game said to the plan of a move or a swap, for the club and terms or the player it was asked about. */
interface Planned {
  key: string;
  outcome: { preview: MovePreview } | { error: string };
}

/** How the text of an input stands against the value the contract had when the dialog opened. */
type Verdict = { status: "same" } | { status: "changed"; value: number } | { status: "invalid" };

const SAME: Verdict = { status: "same" };
const INVALID: Verdict = { status: "invalid" };

/** The whole number `text` holds; null when it is empty or anything else (a fraction, words, too big to send). */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  // Adding zero turns a typed "-0" into 0.
  return trimmed !== "" && Number.isSafeInteger(value) ? value + 0 : null;
}

/**
 * The wage input: a change to send, no change (also when the text is another way of writing what the contract had,
 * or the contract has none and nothing was typed), or unusable. Whether the game takes the number is for the plan
 * to say.
 */
function judgeWage(text: string, was: number | null): Verdict {
  if (text === (was === null ? "" : String(was))) {
    return SAME;
  }
  const value = wholeNumber(text);
  if (value === null || value < 0) {
    return INVALID;
  }
  return value === was ? SAME : { status: "changed", value };
}

/** The most a fee can be, in pounds: what the game's money fields hold; and as typed, in the chosen currency. */
const MAX_FEE = 2_000_000_000;
const MAX_FEE_SHOWN = toShown(MAX_FEE);

/**
 * The fee input: no fee while it is empty or 0, a whole amount of the chosen currency up to `MAX_FEE_SHOWN`, or
 * unusable. The value is as typed; the pounds to send are worked out from it.
 */
function judgeFee(text: string): Verdict {
  if (text.trim() === "") {
    return SAME;
  }
  const value = wholeNumber(text);
  if (value === null || value < 0 || value > MAX_FEE_SHOWN) {
    return INVALID;
  }
  return value === 0 ? SAME : { status: "changed", value };
}

/** The same for the contract end, which a date input holds as `YYYY-MM-DD`: unusable until it is a whole, real date. */
function judgeExpires(text: string, was: number | null): Verdict {
  if (text === (was === null ? "" : isoFromNumber(was))) {
    return SAME;
  }
  const value = numberFromIso(text);
  return value === null ? INVALID : value === was ? SAME : { status: "changed", value };
}

/** The terms to send: only what was changed, so that everything else stays as the contract has it. */
function termsOf(wage: number | undefined, expires: number | undefined): MoveTerms {
  return { ...(wage !== undefined && { wage }), ...(expires !== undefined && { expires }) };
}

/**
 * What a plan is for. A plan is the dialog's only while the club, the terms, the fee and the player released to make
 * room are those it was asked about.
 */
const planKey = (club: number, terms: MoveTerms, fee: number | undefined, release: number | undefined) =>
  `${club}:${terms.wage ?? ""}:${terms.expires ?? ""}:${fee ?? ""}:${release ?? ""}`;

/** A player the club can release, as one line of the list to pick from: his name, his ability, and what speaks against. */
const makerLabel = (row: RoomMaker) =>
  [
    row.name,
    `${profileText.currentAbilityShort} ${row.currentAbility}`,
    row.injured && text.injuredTag,
    row.captain && text.captainTag,
  ]
    .filter(Boolean)
    .join(" · ");

/** What a fee does to one club's money, a line for the plan: what it pays or gets, and its money before and after. */
function moneyLine(money: ClubMoney | null, club: string, fee: string, paying: boolean): string {
  if (money === null) {
    return text.noFinances(club);
  }
  const change = ({ before, after }: { before: number; after: number }) =>
    `${formatMoney(before)} → ${formatMoney(after)}`;
  return paying
    ? text.pays(club, fee, change(money.balance), money.transferBudget && change(money.transferBudget))
    : text.receives(club, fee, change(money.balance));
}

/** The same for a swap, which depends on the player picked alone (his club is the club picked). */
const swapKey = (partner: number) => `swap:${partner}`;

/** An input's class: outlined in the accent colour once it holds a change, and as an error while it cannot be sent. */
const inputClass = (verdict: Verdict) => (verdict.status === "same" ? "move-input" : `move-input ${verdict.status}`);

/** What goes under an input: why it cannot be sent, or the value it started from once it holds another. */
function termNote(verdict: Verdict, invalid: string, was: string | null): { message: string; invalid: boolean } | null {
  if (verdict.status === "invalid") {
    return { message: invalid, invalid: true };
  }
  return verdict.status === "changed" && was !== null ? { message: editText.was(was), invalid: false } : null;
}

/** A club as one line: its logo, its name (cut short where it does not fit), and a tag if it is a women's club. */
export function ClubLine({ uid, name, women = false }: { uid: number | null; name: string; women?: boolean }) {
  return (
    <WithPicture picture={<ClubLogo uid={uid} name={name} size={PICTURE_SIZE.clubRowLogo} />}>
      <span className="move-club-text">
        <span className="move-club-name" title={name}>
          {name}
        </span>
        {women && <span className="tag women">{clubListText.women}</span>}
      </span>
    </WithPicture>
  );
}

/** How many positions a player's line shows. */
const POSITIONS_SHOWN = 3;

/** A player as one line: his face, his name (cut short where it does not fit), and under it his positions and age. */
function PlayerLine({ player }: { player: PlayerSummary }) {
  const detail = [
    player.positions.length > 0 && player.positions.slice(0, POSITIONS_SHOWN).map(positionLabel).join(" "),
    player.age !== null && profileText.age(player.age),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <WithPicture picture={<PersonFace uid={player.uid} name={player.name} size={PICTURE_SIZE.rowFace} />}>
      <span className="move-player-text">
        <span className="move-club-name" title={player.name}>
          {player.name}
        </span>
        {detail && <span className="move-player-detail">{detail}</span>}
      </span>
    </WithPicture>
  );
}

interface PartnerPickerProps {
  /** The club whose players are listed: the one the swap goes to. */
  club: ClubSummary;
  /** The player picked to go the other way; null while the list is on show. */
  partner: PlayerSummary | null;
  /** Whether the swap is being made: the picked player stays. */
  busy: boolean;
  /** The search box, which the dialog moves focus to once the club is picked. */
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (player: PlayerSummary) => void;
  /** Takes the picked player back, for the list to come up again. */
  onChange: () => void;
}

/**
 * The players of the club a swap goes to: a box that narrows them by name, and the list under it with one row
 * highlighted (the one Enter picks), as for the clubs. The player picked takes the place of the list. Mount it with
 * `key={club.uid}` so that another club starts from its own list.
 */
function PartnerPicker({ club, partner, busy, inputRef, onPick, onChange }: PartnerPickerProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const results = useRef<HTMLUListElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  // The control that takes focus once the next render is on screen: the one that takes the place of the one pressed.
  const pendingFocus = useRef<"search" | "change" | null>(null);
  // Set when a key moved the highlight, so that the row it reached scrolls into view; the mouse is not followed.
  const keyboardMoved = useRef(false);

  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundPlayers | null>(null);
  // The row Enter picks.
  const [active, setActive] = useState(0);

  // Until the search has answered for what is typed the rows are the last ones: Enter leaves them alone.
  const rows = found !== null && "page" in found ? found.page.rows : [];
  const settled = found !== null && found.query === query;

  // The search asks for the club's players a moment after the last key, while none is picked. An answer that comes
  // after the text changed, or after a player was picked, is dropped: the cleanup says so.
  const choosing = partner === null;
  useEffect(() => {
    if (!choosing) {
      return;
    }
    let cancelled = false;
    const answer = (next: FoundPlayers) => {
      if (!cancelled) {
        setFound(next);
        setActive(0);
      }
    };
    const timer = setTimeout(
      () => {
        call<PlayerPage>("search_players", { query, limit: PARTNER_LIMIT, filter: { clubUid: club.uid } }).then(
          (page) => answer({ query, page }),
          (e) => answer({ query, error: describeError(e) }),
        );
      },
      // The first look, at the best players, needs no wait.
      query === "" ? 0 : SEARCH_DELAY,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [choosing, club.uid, query]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) {
      return;
    }
    pendingFocus.current = null;
    if (target === "search") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      changeButton.current?.focus();
    }
  });

  useEffect(() => {
    if (keyboardMoved.current) {
      keyboardMoved.current = false;
      results.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  const pick = (chosen: PlayerSummary) => {
    onPick(chosen);
    pendingFocus.current = "change";
  };

  const searchAgain = () => {
    onChange();
    pendingFocus.current = "search";
  };

  const searchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // The arrows move through the players, not the caret.
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
        pick(row);
      }
    }
  };

  if (partner !== null) {
    return (
      <div className="move-club">
        <PlayerLine player={partner} />
        <button ref={changeButton} type="button" className="move-change" disabled={busy} onClick={searchAgain}>
          {text.changePlayer}
        </button>
      </div>
    );
  }

  // What the search says under its list: a live region that is always there, so that it is read out when it fills.
  const note =
    found === null
      ? text.playersSearching
      : !settled
        ? ""
        : "error" in found
          ? text.playersSearchFailed(found.error)
          : found.page.rows.length === 0
            ? text.playersEmpty(query)
            : found.page.total > found.page.rows.length
              ? text.more(found.page.total - found.page.rows.length)
              : "";
  const noteIsError = found !== null && settled && "error" in found;

  return (
    <>
      <label className="search move-search">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4.5 4.5" />
        </svg>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={text.playerSearchLabel}
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={id("players")}
          aria-activedescendant={rows.length > 0 ? id(`player-${active}`) : undefined}
          value={query}
          placeholder={text.playerSearch}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={searchKeyDown}
        />
      </label>
      <div className="move-results-box move-partners" aria-busy={!settled || undefined}>
        <ul ref={results} id={id("players")} className="move-results" role="listbox" aria-label={text.playersLabel}>
          {rows.map((row, index) => (
            <li
              key={row.uid}
              id={id(`player-${index}`)}
              className={index === active ? "move-option active" : "move-option"}
              role="option"
              aria-selected={index === active}
              // Focus stays in the search box: a click only picks.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(row)}
            >
              <PlayerLine player={row} />
              <span className="move-abilities">
                <abbr title={profileText.currentAbility}>{profileText.currentAbilityShort}</abbr>
                <Ability value={row.currentAbility} />
                <abbr title={profileText.potentialAbility}>{profileText.potentialAbilityShort}</abbr>
                <Ability value={row.potentialAbility} />
              </span>
            </li>
          ))}
        </ul>
        <p className={noteIsError ? "move-results-note error" : "move-results-note"} role="status">
          {note}
        </p>
      </div>
    </>
  );
}

interface MoveDialogProps {
  player: MovingPlayer;
  kind: Kind;
  /** His contract as it was when the dialog opened: the inputs start from it. Null when he has none. */
  contract: Contract | null;
  /** Called once the player has moved: the game has changed, so the lists and the profile read it again. */
  onMoved: () => void;
  onClose: () => void;
}

function MoveDialog({ player, kind, contract, onMoved, onClose }: MoveDialogProps) {
  // A member of staff moves in the departments he works in, keeping his job and his contract's terms: no fee, no
  // terms and no swap.
  const staff = kind === "staff";
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const partnerInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const swapModeButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const running = useRef(false);
  // The control that takes focus once the next render is on screen: one that is not there yet, or was disabled.
  const pendingFocus = useRef<"search" | "change" | "partner" | "move" | "swapMode" | null>(null);
  // Set when a key moved the highlight, so that the row it reached scrolls into view; the mouse is not followed.
  const keyboardMoved = useRef(false);

  // The wage as the contract has it, in pounds; the input holds it in the chosen currency.
  const wasWage = contract?.wage ?? null;
  const wasWageShown = wasWage === null ? null : toShown(wasWage);
  const wasExpires = contract?.expires ? numberFromDate(contract.expires) : null;

  const [mode, setMode] = useState<Mode>("move");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  // The row Enter picks.
  const [active, setActive] = useState(0);
  const [club, setClub] = useState<ClubSummary | null>(null);
  // The player a swap sends to the player's club: one of the club's players, once picked. A move has none.
  const [partner, setPartner] = useState<PlayerSummary | null>(null);
  const [wageText, setWageText] = useState(wasWageShown === null ? "" : String(wasWageShown));
  const [expiresText, setExpiresText] = useState(wasExpires === null ? "" : isoFromNumber(wasExpires));
  const [feeText, setFeeText] = useState("");
  const [planned, setPlanned] = useState<Planned | null>(null);
  // How often the plan was asked again with nothing changed: after a move the game refused.
  const [replans, setReplans] = useState(0);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<{ key: string; message: string } | null>(null);
  // A club whose squad list the plan found full, and the game's refusal, which stands when none of its players can be
  // released: the dialog offers to make room instead.
  const [full, setFull] = useState<{ club: number; message: string } | null>(null);
  const [makers, setMakers] = useState<Makers | null>(null);
  // The player picked to release; the one suggested (the first) until another is picked.
  const [releasePick, setReleasePick] = useState<number | null>(null);

  useModal(dialog, !moving, onClose);

  // The inputs, and the terms they stand for.
  const wageVerdict = judgeWage(wageText, wasWageShown);
  const expiresVerdict = judgeExpires(expiresText, wasExpires);
  const feeVerdict = judgeFee(feeText);
  const valid =
    staff ||
    (wageVerdict.status !== "invalid" && expiresVerdict.status !== "invalid" && feeVerdict.status !== "invalid");
  const wage = !staff && wageVerdict.status === "changed" ? toPounds(wageVerdict.value) : undefined;
  const expires = !staff && expiresVerdict.status === "changed" ? expiresVerdict.value : undefined;
  const fee = !staff && feeVerdict.status === "changed" ? toPounds(feeVerdict.value) : undefined;
  const terms = termsOf(wage, expires);

  const swap = mode === "swap";

  // Making room: the club picked for a move has a full squad list. Its players that can be released are listed, and
  // the one picked (at first, the one suggested) is released in the same move. While none is picked yet, there is no
  // plan to ask.
  const fullClub = !swap && !staff && club !== null && full?.club === club.uid ? club.uid : null;
  const makersHere = fullClub !== null && makers?.club === fullClub ? makers.outcome : null;
  const makerRows = makersHere !== null && "rows" in makersHere ? makersHere.rows : null;
  const leaver = makerRows && (makerRows.find((row) => row.uid === releasePick) ?? makerRows[0] ?? null);
  const release = leaver?.uid;
  // The box is there while the players are listed, and once some can be released; with none, the refusal stands.
  const offerRoom = fullClub !== null && (makersHere === null || (makerRows !== null && makerRows.length > 0));

  // What the plan is for: for a move, null while there is no club, or an input cannot be sent; for a swap, null while
  // no player is picked. Move or Swap is offered only for a plan the game made for what is picked now, so a change
  // takes it back at once, before the new plan is asked.
  const key = swap
    ? partner !== null
      ? swapKey(partner.uid)
      : null
    : club !== null && valid && (fullClub === null || release !== undefined)
      ? planKey(club.uid, terms, fee, release)
      : null;
  const outcome = key !== null && planned?.key === key ? planned.outcome : null;
  const preview = outcome !== null && "preview" in outcome ? outcome.preview : null;
  const canMove = preview !== null && !moving;

  // What the button makes, for the plan it is offered for: the swap with the player picked, or the move to the club
  // (releasing the player picked, to make room).
  const make = swap
    ? partner && (() => swapPlayers(player.uid, partner.uid))
    : club &&
      (() => (staff ? moveStaff(player.uid, club.uid) : movePlayer(player.uid, club.uid, terms, fee, release)));

  // The clubs on show. Until the search has answered for what is typed they are the last ones: Enter leaves them alone.
  const rows = found !== null && "page" in found ? found.page.rows : [];
  const settled = found !== null && found.query === query;

  useEffect(() => {
    alive.current = true;
    searchInput.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // The search asks for the clubs a moment after the last key, while no club is picked: only those of his club's kind,
  // men's or women's, which the game refuses to mix. An answer that comes after the text changed, or after a club was
  // picked, is dropped: the cleanup says so.
  const choosing = club === null;
  useEffect(() => {
    if (!choosing) {
      return;
    }
    let cancelled = false;
    const answer = (next: Found) => {
      if (!cancelled) {
        setFound(next);
        setActive(0);
      }
    };
    const timer = setTimeout(
      () => {
        call<ClubPage>("search_clubs", { query, limit: RESULT_LIMIT, filter: {}, kindOf: player.clubUid }).then(
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
  }, [choosing, query]);

  // The game works out the move a moment after the club and the terms stop changing. An answer that comes after they
  // changed again is dropped: the cleanup says so. A full squad list is not the end of it: the dialog then lists the
  // players the club can release, and asks again with the one picked.
  const waitingForLeaver = fullClub !== null && release === undefined;
  useEffect(() => {
    if (swap || club === null || !valid || waitingForLeaver) {
      return;
    }
    let cancelled = false;
    const asked = termsOf(wage, expires);
    const answer = (result: Planned["outcome"]) => {
      if (!cancelled) {
        setPlanned({ key: planKey(club.uid, asked, fee, release), outcome: result });
      }
    };
    const timer = setTimeout(() => {
      (staff ? planStaffMove(player.uid, club.uid) : planClubMove(player.uid, club.uid, asked, fee, release)).then(
        (made) => answer({ preview: made }),
        (e) => {
          if (!cancelled && !staff && release === undefined && errorCode(e) === "move.noRoom") {
            setFull({ club: club.uid, message: describeError(e) });
          }
          answer({ error: describeError(e) });
        },
      );
    }, PLAN_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [swap, staff, player.uid, club, valid, wage, expires, fee, release, waitingForLeaver, replans]);

  // The players a club with a full squad list can release, asked once the plan found it full, and again after a move
  // the game refused.
  useEffect(() => {
    if (fullClub === null) {
      return;
    }
    let cancelled = false;
    roomMakers(fullClub).then(
      (rows) => !cancelled && setMakers({ club: fullClub, outcome: { rows } }),
      (e) => !cancelled && setMakers({ club: fullClub, outcome: { error: describeError(e) } }),
    );
    return () => {
      cancelled = true;
    };
  }, [fullClub, replans]);

  // The same for a swap, a moment after the player to swap with is picked.
  useEffect(() => {
    if (!swap || partner === null) {
      return;
    }
    let cancelled = false;
    const answer = (result: Planned["outcome"]) => {
      if (!cancelled) {
        setPlanned({ key: swapKey(partner.uid), outcome: result });
      }
    };
    const timer = setTimeout(() => {
      planClubSwap(player.uid, partner.uid).then(
        (made) => answer({ preview: made }),
        (e) => answer({ error: describeError(e) }),
      );
    }, PLAN_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [swap, player.uid, partner, replans]);

  // Focus that was asked for while the controls changed: the button that takes the place of the search, the search
  // that takes the place of the button, the search for the player of a swap that takes the place of the clubs, or Move
  // once a failed move is over (the buttons were disabled while it ran).
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) {
      return;
    }
    pendingFocus.current = null;
    if (target === "search") {
      searchInput.current?.focus();
      searchInput.current?.select();
    } else if (target === "change") {
      changeButton.current?.focus();
    } else if (target === "partner") {
      partnerInput.current?.focus();
    } else if (target === "swapMode") {
      swapModeButton.current?.focus();
    } else {
      (moveButton.current && !moveButton.current.disabled ? moveButton : cancelButton).current?.focus();
    }
  });

  useEffect(() => {
    if (keyboardMoved.current) {
      keyboardMoved.current = false;
      results.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active]);

  const pick = (chosen: ClubSummary) => {
    setClub(chosen);
    // A swap goes on to the club's players; a move to its terms, from the button that brings the clubs back.
    pendingFocus.current = swap ? "partner" : "change";
  };

  const searchAgain = () => {
    setClub(null);
    // The player was one of the club's, and so were those it could release.
    setPartner(null);
    setFull(null);
    setMakers(null);
    setReleasePick(null);
    pendingFocus.current = "search";
  };

  // Making room by a swap instead: the dialog becomes the swap with the player picked to release.
  const swapWith = (other: PlayerSummary) => {
    setMode("swap");
    setPartner(other);
    pendingFocus.current = "swapMode";
  };

  const searchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
        pick(row);
      }
    }
  };

  const move = async () => {
    if (!canMove || key === null || make === null || running.current) {
      return;
    }
    running.current = true;
    setMoving(true);
    setMoveError(null);
    try {
      await make();
      // The game has changed: the lists, the profile and the change log read it again.
      onMoved();
      onClose();
    } catch (e) {
      if (alive.current) {
        setMoveError({ key, message: describeError(e) });
        // The game may not be as the plan found it: the plan is worked out again, and Move waits for it if it must.
        setReplans((count) => count + 1);
        pendingFocus.current = "move";
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setMoving(false);
      }
    }
  };

  // What the search says under its list: a live region that is always there, so that it is read out when it fills.
  const note =
    found === null
      ? text.searching
      : !settled
        ? ""
        : "error" in found
          ? text.searchFailed(found.error)
          : found.page.rows.length === 0
            ? clubListText.empty(query, false)
            : found.page.total > found.page.rows.length
              ? text.more(found.page.total - found.page.rows.length)
              : "";
  const noteIsError = found !== null && settled && "error" in found;

  const wageNote = termNote(wageVerdict, text.wageInvalid, wasWage === null ? null : formatMoney(wasWage));
  const expiresNote = termNote(
    expiresVerdict,
    text.expiresInvalid,
    contract?.expires ? formatDate(contract.expires) : null,
  );

  const feeNote =
    feeVerdict.status === "invalid" ? { message: text.feeInvalid(formatAmount(MAX_FEE_SHOWN)), invalid: true } : null;

  // Where the clubs of a move that can be made lead, who is released to make room, and what its fee does to their
  // money; for a swap, who goes where.
  const route = (made: MovePreview) => {
    if (swap && partner !== null) {
      return text.swapRoute(player.name, made.from.name, made.to.name, partner.name);
    }
    const lines = [text.route(made.from.name, made.to.name)];
    if (leaver !== null) {
      lines.push(`${leaver.name}: ${releaseText.ready(made.to.name)}`);
    }
    if (made.fee) {
      const amount = formatMoney(made.fee.fee);
      lines.push(moneyLine(made.fee.buyer, made.to.name, amount, true));
      lines.push(moneyLine(made.fee.seller, made.from.name, amount, false));
    }
    return lines.join("\n");
  };

  // What the move or the swap comes to, or why it cannot be made. The plan line is a live region that is always there.
  // For a full squad list it says why no player can be released, when none can: the game's refusal.
  const noLeaver =
    makersHere === null
      ? null
      : "error" in makersHere
        ? text.playersSearchFailed(makersHere.error)
        : makersHere.rows.length === 0 && full !== null
          ? full.message
          : null;
  const plan: { tone: "pending" | "ok" | "refused"; message: string } =
    club === null
      ? { tone: "pending", message: swap ? text.swapChooseClub : staff ? text.staffChooseClub : text.chooseClub }
      : swap && partner === null
        ? { tone: "pending", message: text.swapChoosePlayer }
        : !swap && !valid
          ? { tone: "pending", message: text.fixTerms }
          : noLeaver !== null
            ? { tone: "refused", message: noLeaver }
            : outcome === null
              ? { tone: "pending", message: swap ? text.swapChecking : text.checking }
              : "error" in outcome
                ? { tone: "refused", message: outcome.error }
                : { tone: "ok", message: route(outcome.preview) };
  // A failed move is told for the club and terms it was tried with only (a swap: for the player picked).
  const failure = moveError !== null && moveError.key === key ? moveError.message : null;

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
        className="modal move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        aria-describedby={id("player")}
        aria-busy={moving || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={id("title")}>{swap ? text.swapTitle : text.title}</h2>
          <p id={id("player")} className="move-player">
            {player.name}
          </p>
        </header>

        <div className="modal-body">
          {!staff && (
            <div className="move-mode" role="group" aria-label={text.modeLabel}>
              {MODES.map(({ id: kindOfMove, label }) => (
                <button
                  key={kindOfMove}
                  ref={kindOfMove === "swap" ? swapModeButton : undefined}
                  type="button"
                  aria-pressed={kindOfMove === mode}
                  disabled={moving}
                  onClick={() => setMode(kindOfMove)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <section className="move-section" aria-labelledby={id("from")}>
            <h3 id={id("from")}>{text.from}</h3>
            <div className="move-club">
              <ClubLine uid={player.clubUid} name={player.club} />
            </div>
          </section>

          <section className="move-section" aria-labelledby={id("to")}>
            <h3 id={id("to")}>{text.to}</h3>
            {club === null ? (
              <>
                <label className="search move-search">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="8.5" cy="8.5" r="5.5" />
                    <path d="m13 13 4.5 4.5" />
                  </svg>
                  <input
                    ref={searchInput}
                    role="combobox"
                    aria-label={text.searchLabel}
                    aria-autocomplete="list"
                    aria-expanded={rows.length > 0}
                    aria-controls={id("clubs")}
                    aria-activedescendant={rows.length > 0 ? id(`club-${active}`) : undefined}
                    value={query}
                    placeholder={clubListText.search}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={searchKeyDown}
                  />
                </label>
                {/* The box keeps the room of a full list, so that the dialog does not jump as results come and go. */}
                <div className="move-results-box" aria-busy={!settled || undefined}>
                  <ul
                    ref={results}
                    id={id("clubs")}
                    className="move-results"
                    role="listbox"
                    aria-label={text.resultsLabel}
                  >
                    {rows.map((row, index) => (
                      <li
                        key={row.uid}
                        id={id(`club-${index}`)}
                        className={index === active ? "move-option active" : "move-option"}
                        role="option"
                        aria-selected={index === active}
                        // Focus stays in the search box: a click only picks.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(row)}
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
              </>
            ) : (
              <div className="move-club">
                <ClubLine uid={club.uid} name={club.name} women={club.women} />
                <ReputationMeter value={club.reputation} />
                <button
                  ref={changeButton}
                  type="button"
                  className="move-change"
                  disabled={moving}
                  onClick={searchAgain}
                >
                  {text.change}
                </button>
              </div>
            )}
          </section>

          {swap && club !== null && (
            <section className="move-section" aria-labelledby={id("swap-with")}>
              <h3 id={id("swap-with")}>{text.swapWith}</h3>
              <PartnerPicker
                key={club.uid}
                club={club}
                partner={partner}
                busy={moving}
                inputRef={partnerInput}
                onPick={setPartner}
                onChange={() => setPartner(null)}
              />
            </section>
          )}

          {!swap && !staff && (
            <section className="move-section" aria-labelledby={id("fee-heading")}>
              <h3 id={id("fee-heading")}>{text.feeHeading}</h3>
              <div className="move-terms">
                <div className="move-term">
                  <label htmlFor={id("fee")}>{text.fee}</label>
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
                      readOnly={moving}
                      aria-invalid={feeVerdict.status === "invalid" || undefined}
                      aria-describedby={id("fee-note")}
                      onChange={(e) => setFeeText(e.currentTarget.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                    />
                  </span>
                  <p id={id("fee-note")} className={feeNote ? "move-note invalid" : "move-note"}>
                    {feeNote ? feeNote.message : text.feeHint}
                  </p>
                </div>
              </div>
            </section>
          )}

          <section className="move-section" aria-labelledby={id("contract")}>
            <h3 id={id("contract")}>{profileText.contract}</h3>
            {swap || staff ? (
              <p className="move-note">{staff ? text.staffContract : text.swapContract}</p>
            ) : (
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
                      readOnly={moving}
                      aria-invalid={wageVerdict.status === "invalid" || undefined}
                      aria-describedby={wageNote ? id("wage-note") : undefined}
                      onChange={(e) => setWageText(e.currentTarget.value)}
                      // A wheel turned over the focused input would change it: let go of it, so the dialog scrolls.
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
                    readOnly={moving}
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
            )}
          </section>

          {offerRoom && club !== null && (
            <div className="room-notice">
              <p className="room-head">
                {text.noRoom(club.name)} <InfoTip label={text.noRoomInfoLabel} note={text.noRoomInfo} />
              </p>
              <fieldset className="room-choices" disabled={moving}>
                <legend>{text.noRoomNeed(player.name, club.name)}</legend>
                <div className="room-choice">
                  <input type="radio" id={id("room-release")} name={id("room")} checked readOnly />
                  <label htmlFor={id("room-release")}>{text.releaseChoice}</label>
                  <span className="room-pick">
                    <select
                      className="move-input room-select"
                      aria-label={text.releasePickLabel}
                      value={leaver?.uid ?? ""}
                      disabled={leaver === null}
                      onChange={(e) => setReleasePick(Number(e.currentTarget.value))}
                    >
                      {makerRows === null ? (
                        <option value="">{text.playersSearching}</option>
                      ) : (
                        makerRows.map((row) => (
                          <option key={row.uid} value={row.uid}>
                            {makerLabel(row)}
                          </option>
                        ))
                      )}
                    </select>
                    <span className="room-outcome">{text.releaseOutcome}</span>
                  </span>
                </div>
                <div className="room-choice">
                  <input
                    type="radio"
                    id={id("room-swap")}
                    name={id("room")}
                    checked={false}
                    disabled={leaver === null}
                    onChange={() => leaver && swapWith(leaver)}
                  />
                  <label htmlFor={id("room-swap")}>{text.swapChoice}</label>
                  <span className="room-outcome">{text.swapChoiceOutcome(player.club)}</span>
                </div>
              </fieldset>
            </div>
          )}

          <p className={`move-plan ${plan.tone}`} role="status">
            {plan.message}
          </p>

          <section className="move-section" aria-labelledby={id("does")}>
            <h3 id={id("does")}>{swap ? text.swapDoesHeading : text.doesHeading}</h3>
            <ul className="move-facts">
              {(swap ? text.swapDoes : staff ? text.staffDoes : offerRoom ? text.makeRoomDoes : text.does).map(
                (line) => (
                  <li key={line}>{line}</li>
                ),
              )}
            </ul>
          </section>
        </div>

        {failure !== null && (
          <div className="banner move-error" role="alert">
            {failure}
          </div>
        )}

        <footer className="modal-foot">
          <span className="move-foot-note">{swap ? text.swapHint : text.hint}</span>
          <button ref={moveButton} type="button" className="primary" disabled={!canMove} onClick={() => void move()}>
            {moving
              ? swap
                ? text.swapping
                : text.moving
              : swap
                ? text.swap
                : leaver !== null
                  ? text.moveAndRelease(leaver.name)
                  : text.move}
          </button>
          <button ref={cancelButton} type="button" disabled={moving} onClick={onClose}>
            {text.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
