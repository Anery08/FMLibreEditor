// The notice under the masthead after connecting to a save in which players' attributes, energy and match sharpness
// or clubs' money were frozen before: what is frozen again, and what waits until FMLibreEditor can write to this
// version of the game.

import { appText } from "./labels";
import type { Refrozen } from "./types";

const text = appText.refrozen;

/** Most names the notice lists of each kind; it counts the rest. */
const NAMES_SHOWN = 5;

const names = (list: string[]) =>
  list.length > NAMES_SHOWN
    ? `${list.slice(0, NAMES_SHOWN).join(", ")} ${text.more(list.length - NAMES_SHOWN)}`
    : list.join(", ");

/** What connecting froze again, by name, and how many wait; it stays until it is dismissed. */
export function FrozenNotice({ refrozen, onDismiss }: { refrozen: Refrozen; onDismiss: () => void }) {
  const again = refrozen.players.length + refrozen.fitness.length + refrozen.clubs.length > 0;
  return (
    <div className="frozen-notice" role="status">
      <div className="compatibility-text">
        <strong>{again ? text.title : text.waitingTitle}</strong>
        {refrozen.players.length > 0 && <p>{text.players(names(refrozen.players))}</p>}
        {refrozen.fitness.length > 0 && <p>{text.fitness(names(refrozen.fitness))}</p>}
        {refrozen.clubs.length > 0 && <p>{text.clubs(names(refrozen.clubs))}</p>}
        {refrozen.waiting > 0 && <p>{text.waiting(refrozen.waiting)}</p>}
      </div>
      <button type="button" className="icon-button" aria-label={text.dismiss} title={text.dismiss} onClick={onDismiss}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
    </div>
  );
}
