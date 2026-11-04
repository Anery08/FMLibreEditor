// The players picked for a comparison. The set lives in the app (see `App`), so it survives switching views, and a
// player's profile opened from a club's squad adds to the set the player list's tray shows; a reload of the window
// starts with none.

import { createContext, useMemo, useState } from "react";

/** The most players one comparison holds: more columns would no longer read side by side. */
export const MAX_COMPARED = 4;

/** A player picked for a comparison. The name is for the tray, and for a column whose profile could not be read. */
export interface ComparedPlayer {
  uid: number;
  name: string;
}

/** The set of players picked for a comparison, and what can be done to it. */
export interface Comparison {
  /** The players, in the order they were picked. */
  players: readonly ComparedPlayer[];
  /** Whether no more players fit. */
  full: boolean;
  has: (uid: number) => boolean;
  /** Adds the player, or takes them out when they are in already. A full comparison takes no one more. */
  toggle: (player: ComparedPlayer) => void;
  remove: (uid: number) => void;
  clear: () => void;
}

/** The app's comparison, for the profiles that are not in the player list; null outside the connected app. */
export const ComparisonContext = createContext<Comparison | null>(null);

/** A comparison, empty to begin with: the app's (see `App`). */
export function useComparison(): Comparison {
  const [players, setPlayers] = useState<readonly ComparedPlayer[]>([]);

  return useMemo<Comparison>(() => {
    const includes = (list: readonly ComparedPlayer[], uid: number) => list.some((player) => player.uid === uid);
    return {
      players,
      full: players.length >= MAX_COMPARED,
      has: (uid) => includes(players, uid),
      toggle: (player) =>
        setPlayers((old) => {
          if (includes(old, player.uid)) {
            return old.filter((other) => other.uid !== player.uid);
          }
          return old.length >= MAX_COMPARED ? old : [...old, player];
        }),
      remove: (uid) => setPlayers((old) => (includes(old, uid) ? old.filter((player) => player.uid !== uid) : old)),
      clear: () => setPlayers((old) => (old.length === 0 ? old : [])),
    };
  }, [players]);
}
