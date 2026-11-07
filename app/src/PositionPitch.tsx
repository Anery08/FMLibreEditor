import { useContext, useEffect, useState, type ReactNode } from "react";
import { EditableValue } from "./EditControls";
import { freezePositions, frozenPositions } from "./editing";
import { describeError } from "./format";
import { InfoTip } from "./InfoTip";
import { POSITION_LABELS, profileText, type PositionKey } from "./labels";
import type { PlayerDetails } from "./types";
import { EditorContext, useEditSession } from "./useProfileEditing";

/** Rating bands, best first. `range` is what the legend prints. */
const TIERS = [
  { name: "natural", min: 20, range: "20" },
  { name: "accomplished", min: 15, range: "15–19" },
  { name: "competent", min: 10, range: "10–14" },
  { name: "unconvincing", min: 5, range: "5–9" },
  { name: "ineffective", min: 0, range: "1–4" },
] as const;

type TierName = (typeof TIERS)[number]["name"];

/** The band of a position rating, as the pitch (and the comparison of players) colours it. */
export function tierOf(rating: number): TierName {
  return TIERS.find((tier) => rating >= tier.min)?.name ?? "ineffective";
}

const PITCH = { width: 150, height: 184 };
const MARKER = { width: 34, height: 18 };

/** Marker centres on the pitch; the attacking end is at the top. */
const SPOTS: readonly (readonly [PositionKey, number, number])[] = [
  ["st", 75, 14],
  ["aml", 26, 40],
  ["amc", 75, 40],
  ["amr", 124, 40],
  ["ml", 26, 66],
  ["mc", 75, 66],
  ["mr", 124, 66],
  ["wbl", 26, 92],
  ["dm", 75, 92],
  ["wbr", 124, 92],
  ["dl", 26, 118],
  ["dc", 75, 118],
  ["dr", 124, 118],
  ["sw", 75, 144],
  ["gk", 75, 170],
];

/** The positions in the order the pitch has them, front to back and left to right. */
export const PITCH_ORDER: readonly PositionKey[] = SPOTS.map(([key]) => key);

/**
 * A portrait pitch with one marker per position, filled by how well the player can play there; `children` go right
 * under it, over the legend.
 */
export function PositionPitch({ ratings, children }: { ratings: Record<string, number>; children?: ReactNode }) {
  const rating = (key: PositionKey): number => ratings[key] ?? 0;
  const best = SPOTS.map(([key]) => key)
    .filter((key) => rating(key) >= 10)
    .sort((a, b) => rating(b) - rating(a))
    .map((key) => `${POSITION_LABELS[key]} ${rating(key)}`)
    .join(", ");

  return (
    <>
      <svg
        className="pitch"
        viewBox={`0 0 ${PITCH.width} ${PITCH.height}`}
        role="img"
        aria-label={profileText.positionsSummary(best)}
      >
        <rect className="pitch-field" x="1" y="1" width={PITCH.width - 2} height={PITCH.height - 2} rx="7" />
        <g className="pitch-lines">
          <line x1="1" y1="92" x2="149" y2="92" />
          <circle cx="75" cy="92" r="14" />
          <rect x="33" y="1" width="84" height="24" />
          <rect x="57" y="1" width="36" height="9" />
          <rect x="33" y="159" width="84" height="24" />
          <rect x="57" y="174" width="36" height="9" />
        </g>
        {SPOTS.map(([key, x, y]) => {
          const value = rating(key);
          const tier = tierOf(value);
          const label = POSITION_LABELS[key];
          return (
            <g
              key={key}
              className={`pitch-marker pos-${tier}`}
              transform={`translate(${x - MARKER.width / 2} ${y - MARKER.height / 2})`}
            >
              <title>{profileText.positionTooltip(label, value, profileText.positionTiers[tier])}</title>
              <rect width={MARKER.width} height={MARKER.height} rx="5" />
              <text x={MARKER.width / 2} y={MARKER.height / 2}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {children}
      <ul className="legend">
        {TIERS.map((tier) => (
          <li key={tier.name}>
            <span className={`swatch pos-${tier.name}`} />
            {profileText.positionTiers[tier.name]}
            <span className="range">{tier.range}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Every position's rating, in the order of the pitch, with the colour of its band; while the player is edited, each is
 * an input where it is shown. The sweeper is left out: the game no longer plays one.
 */
export function PositionRatings({ ratings }: { ratings: Record<string, number> }) {
  return (
    <section className="profile-group">
      <h3>{profileText.positionRatings}</h3>
      <dl className="stats position-ratings">
        {PITCH_ORDER.filter((key) => key !== "sw").map((key) => {
          const value = ratings[key] ?? 0;
          const tier = tierOf(value);
          const label = POSITION_LABELS[key];
          return (
            <div className="stat" key={key} title={profileText.positionTooltip(label, value, profileText.positionTiers[tier])}>
              <dt>{label}</dt>
              <dd className="position-rating">
                <EditableValue field={`position.${key}`}>
                  <span className={`swatch pos-${tier}`} aria-hidden="true" />
                  {value}
                </EditableValue>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * The box under the pitch that freezes a player's position ratings; its (i) says what that does. It waits while the
 * game cannot be written to, and says why. Not there while the player is edited: the inputs hold them then.
 */
export function PositionFreeze({ details }: { details: PlayerDetails }) {
  const uid = details.uid;
  const { editable, readOnlyNote, onEdited } = useContext(EditorContext);
  const editing = useEditSession() !== null;
  // Whether they are frozen; null until the app has said.
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asked again whenever the profile is read again: the squad tab of his club may have frozen him meanwhile.
  useEffect(() => {
    let current = true;
    frozenPositions()
      .then((players) => current && setFrozen(players.includes(uid)))
      .catch(() => current && setFrozen(false));
    return () => {
      current = false;
    };
  }, [uid, details]);

  if (editing || frozen === null) {
    return null;
  }

  const freeze = async (on: boolean) => {
    setError(null);
    try {
      setFrozen((await freezePositions(uid, on)).includes(uid));
      // Nothing in the game has changed, but the squad tab of his club says who is frozen: it reads again.
      onEdited();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="position-freeze">
      <div className="freeze-line">
        <label className="freeze-toggle" title={editable ? undefined : readOnlyNote}>
          <input
            type="checkbox"
            checked={frozen}
            disabled={!editable}
            onChange={(e) => void freeze(e.currentTarget.checked)}
          />
          <span>{profileText.freezePositions}</span>
        </label>
        <InfoTip label={profileText.freezePositionsInfo} note={profileText.freezePositionsNote} />
      </div>
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
