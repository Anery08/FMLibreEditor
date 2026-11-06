// Small pieces the three sections of the Scouting tab share: a player's name and face, the fit bar, the chips of
// reasons, the colours of the depth statuses, and the texts that turn the core's codes into words.

import { type ReactNode } from "react";
import { formatMoney } from "./format";
import { InfoTip } from "./InfoTip";
import { profileText, scoutingText as text } from "./labels";
import { ClubLogo, PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import { tierOf } from "./PositionPitch";
import type { DepartureReason, DepthStatus, PlayerSummary, Reason } from "./types";

/** The squad line each position belongs to, as the dots on the pitch need it. */
export const LINE_OF_POSITION: Record<string, string> = {
  gk: "gk",
  dc: "dc",
  dr: "rightBack",
  wbr: "rightBack",
  dl: "leftBack",
  wbl: "leftBack",
  dm: "dm",
  mc: "mc",
  amr: "rightWing",
  mr: "rightWing",
  aml: "leftWing",
  ml: "leftWing",
  amc: "amc",
  st: "st",
};

export const roleName = (key: string) => text.roles[key] ?? key.toUpperCase();

/** "IFB", or "?" for a role the editor does not know. */
export const roleAbbreviation = (key: string | null) => (key === null ? "?" : key.toUpperCase());

/** The reasons whose value is an amount of money; the others' is a number of days. */
const MONEY_REASONS: ReadonlySet<string> = new Set(["releaseClause", "overBudget", "stretch", "wageHigh"]);

export function reasonText(reason: Reason): string {
  const say = text.reasons[reason.code];
  if (!say) {
    return reason.code;
  }
  const { value } = reason;
  return say(value === null ? "" : MONEY_REASONS.has(reason.code) ? formatMoney(value) : String(Math.round(value)));
}

export function departureReasonText({ code, value }: DepartureReason): string {
  const say = text.departureReasons[code];
  if (!say) {
    return code;
  }
  const shown = value === null ? "" : code === "highWage" ? formatMoney(value) : String(Math.round(value));
  return say(shown);
}

export const signed = (points: number) => (points > 0 ? `+${points}` : String(points));

/** An amount in pounds, short, in the chosen currency: "£38.6M", "£36K". */
export const shortMoney = (pounds: number) => formatMoney(pounds, { notation: "compact", maximumFractionDigits: 1 });

/** How well a player plays a position, in the words of his profile ("Natural", "Competent"). */
export const familiarity = (rating: number) => profileText.positionTiers[tierOf(Math.round(rating))];

/** The line's name in the plural, or the key for one the editor has no name for. */
export const depthLineName = (key: string) => text.depthLines[key] ?? key;

/** A face and the name that opens the player's profile; `sub` is the line under the name. */
export function PlayerName({
  player,
  onOpen,
  sub,
}: {
  player: PlayerSummary;
  onOpen: (player: PlayerSummary) => void;
  sub?: ReactNode;
}) {
  return (
    <WithPicture picture={<PersonFace uid={player.uid} name={player.name} size={PICTURE_SIZE.rowFace} />}>
      <button
        type="button"
        className="name name-link"
        aria-haspopup="dialog"
        title={text.openProfile}
        onClick={() => onOpen(player)}
      >
        {player.name}
      </button>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </WithPicture>
  );
}

/**
 * The player's club under his name: its logo and name, or "Free agent". For a player on loan, or in a club's second
 * team, `owner` is the club his contract is with, which would sell him; the club he plays for follows it.
 */
export function ClubLine({ player, owner }: { player: PlayerSummary; owner?: { uid: number; name: string } | null }) {
  if (owner) {
    const title = player.club === null ? owner.name : `${owner.name} · ${text.playsFor(player.club)}`;
    return (
      <span className="scout-club-line" title={title}>
        <ClubLogo uid={owner.uid} name={owner.name} size={PICTURE_SIZE.textLogo} />
        <span className="name-text">
          {owner.name}
          {player.club !== null && <span className="muted"> · {text.playsFor(player.club)}</span>}
        </span>
      </span>
    );
  }
  if (player.club === null || player.clubUid === null) {
    return <span className="scout-club-line muted">{text.freeAgent}</span>;
  }
  return (
    <span className="scout-club-line" title={player.club}>
      <ClubLogo uid={player.clubUid} name={player.club} size={PICTURE_SIZE.textLogo} />
      <span className="name-text">{player.club}</span>
    </span>
  );
}

/** A small bar and the number it stands for. */
export function FitBar({ fit, title }: { fit: number; title?: string }) {
  const level = fit >= 70 ? "good" : fit >= 50 ? "ok" : "poor";
  return (
    <div className="scout-fit" title={title}>
      <span className="scout-bar" aria-hidden="true">
        <span className={level} style={{ width: `${Math.max(0, Math.min(100, fit))}%` }} />
      </span>
      <span className="num">{Math.round(fit)}</span>
    </div>
  );
}

/** "IFB / PFB", each with its full name on hover. */
export function RoleAbbreviations({ inPossession, outOfPossession }: { inPossession: string | null; outOfPossession: string | null }) {
  const one = (key: string | null) => (
    <span title={key === null ? undefined : roleName(key)}>{roleAbbreviation(key)}</span>
  );
  return (
    <span className="scout-roles-pair">
      {one(inPossession)} / {one(outOfPossession)}
    </span>
  );
}

/** The (i) beside the Probability column's title, which says what the probability is. */
export function ProbabilityInfo() {
  return (
    <span className="scout-th-info">
      <InfoTip label={text.probabilityInfoLabel} note={text.probabilityInfo} />
    </span>
  );
}

/** The dot that says how a squad line stands. */
export function StatusDot({ status }: { status: DepthStatus }) {
  return <span className="scout-dot" data-status={status} aria-hidden="true" />;
}
