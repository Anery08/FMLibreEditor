import { EditableValue } from "./EditControls";
import { POSITION_LABELS, profileText, type PositionKey } from "./labels";

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

/** A portrait pitch with one marker per position, filled by how well the player can play there. */
export function PositionPitch({ ratings }: { ratings: Record<string, number> }) {
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
