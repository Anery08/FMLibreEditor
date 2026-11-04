// Going to a player from elsewhere in the window: a player named in a club's squad opens in the player list, where his
// profile has all it offers there (Compare, Transfer, Release). The club list keeps its club and tab meanwhile, so the
// Clubs tab leads back to the squad.

import { createContext } from "react";
import type { PlayerSummary } from "./types";

/** Brings the player list into view with the player's profile open; null outside the connected app. */
export const OpenPlayerContext = createContext<((player: PlayerSummary) => void) | null>(null);
