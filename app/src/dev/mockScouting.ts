// Fixtures for the Scouting tab: the human manager's club, a 4-3-3 he plays, the roles the editor knows (the same as
// the core's), and suggestions worked out from the fixture players, so the tab can be tried without the game.

import type {
  ClubSummary,
  ClubTactic,
  Line,
  PlayerSummary,
  Reason,
  Role,
  Scouted,
  ScoutingView,
  ScoutRequest,
  Side,
  Suggestion,
} from "../types";

/** [key, phase, line] of every role the core knows, in its order. */
const ROLE_LIST: [string, "inPossession" | "outOfPossession", Line][] = [
  ["bgk", "inPossession", "goalkeeper"],
  ["ngk", "inPossession", "goalkeeper"],
  ["cb", "inPossession", "centreBack"],
  ["bcb", "inPossession", "centreBack"],
  ["ncb", "inPossession", "centreBack"],
  ["acb", "inPossession", "centreBack"],
  ["ocb", "inPossession", "centreBack"],
  ["fb", "inPossession", "fullBack"],
  ["ifb", "inPossession", "fullBack"],
  ["wb", "inPossession", "wingBack"],
  ["iwb", "inPossession", "wingBack"],
  ["pwb", "inPossession", "wingBack"],
  ["awb", "inPossession", "wingBack"],
  ["dm", "inPossession", "defensiveMidfield"],
  ["hb", "inPossession", "defensiveMidfield"],
  ["bbm", "inPossession", "defensiveMidfield"],
  ["bbp", "inPossession", "defensiveMidfield"],
  ["chm", "inPossession", "centralMidfield"],
  ["wcm", "inPossession", "centralMidfield"],
  ["ap", "inPossession", "centralMidfield"],
  ["am", "inPossession", "attackingMidfield"],
  ["w", "inPossession", "wide"],
  ["if", "inPossession", "wide"],
  ["pw", "inPossession", "wide"],
  ["wfd", "inPossession", "wide"],
  ["cfd", "inPossession", "striker"],
  ["dlf", "inPossession", "striker"],
  ["p", "inPossession", "striker"],
  ["sk", "outOfPossession", "goalkeeper"],
  ["lhk", "outOfPossession", "goalkeeper"],
  ["cb", "outOfPossession", "centreBack"],
  ["scb", "outOfPossession", "centreBack"],
  ["ccb", "outOfPossession", "centreBack"],
  ["wcb", "outOfPossession", "centreBack"],
  ["fb", "outOfPossession", "fullBack"],
  ["pfb", "outOfPossession", "fullBack"],
  ["hfb", "outOfPossession", "fullBack"],
  ["wb", "outOfPossession", "wingBack"],
  ["hwb", "outOfPossession", "wingBack"],
  ["dm", "outOfPossession", "defensiveMidfield"],
  ["ddm", "outOfPossession", "defensiveMidfield"],
  ["pdm", "outOfPossession", "defensiveMidfield"],
  ["cm", "outOfPossession", "centralMidfield"],
  ["pcm", "outOfPossession", "centralMidfield"],
  ["scm", "outOfPossession", "centralMidfield"],
  ["oam", "outOfPossession", "attackingMidfield"],
  ["w", "outOfPossession", "wide"],
  ["tw", "outOfPossession", "wide"],
  ["iow", "outOfPossession", "wide"],
  ["cfd", "outOfPossession", "striker"],
  ["tcf", "outOfPossession", "striker"],
  ["ocf", "outOfPossession", "striker"],
];

const ROLES: Role[] = ROLE_LIST.map(([key, phase, line]) => ({
  key,
  phase,
  line,
  keyAttributes: ["passing", "first_touch", "decisions"],
  otherAttributes: ["stamina", "work_rate"],
}));

/** The positions a line takes, by side, as the core has them. */
function positionsOf(line: Line, side: Side | null): string[] {
  const sided = (right: string[], left: string[]) => (side === "right" ? right : side === "left" ? left : [...right, ...left]);
  switch (line) {
    case "goalkeeper":
      return ["gk"];
    case "centreBack":
      return ["dc"];
    case "fullBack":
      return sided(["dr", "wbr"], ["dl", "wbl"]);
    case "wingBack":
      return sided(["wbr", "dr"], ["wbl", "dl"]);
    case "defensiveMidfield":
      return ["dm", "mc"];
    case "centralMidfield":
      return ["mc", "dm"];
    case "attackingMidfield":
      return ["amc", "mc"];
    case "wide":
      return sided(["amr", "mr"], ["aml", "ml"]);
    case "striker":
      return ["st"];
  }
}

/** The slots of the fixture tactic: Monza's 4-3-3 from the research, [in possession, out of possession, line, side, best position]. */
const SLOTS: [string, string, Line, Side | null, string][] = [
  ["bgk", "sk", "goalkeeper", null, "gk"],
  ["ifb", "pfb", "fullBack", "right", "dr"],
  ["cb", "cb", "centreBack", null, "dc"],
  ["bcb", "cb", "centreBack", null, "dc"],
  ["iwb", "fb", "wingBack", "left", "dl"],
  ["dm", "dm", "defensiveMidfield", null, "dm"],
  ["ap", "cm", "centralMidfield", null, "mc"],
  ["chm", "pcm", "centralMidfield", null, "mc"],
  ["wfd", "w", "wide", "right", "amr"],
  ["w", "tw", "wide", "left", "aml"],
  ["cfd", "cfd", "striker", null, "st"],
];

export interface ScoutingFixtures {
  players: PlayerSummary[];
  clubs: ClubSummary[];
  ratings: Record<number, Record<string, number>>;
  women: Set<number>;
}

/** The human manager's club in the fixtures: the first men's club. */
function humanClub(f: ScoutingFixtures): ClubSummary {
  return f.clubs.find((club) => !club.women)!;
}

const best = (f: ScoutingFixtures, uid: number, positions: string[]) =>
  Math.max(0, ...positions.map((key) => f.ratings[uid]?.[key] ?? 0));

export function scoutingTactics(f: ScoutingFixtures): ScoutingView {
  const club = humanClub(f);
  const squad = f.players.filter((p) => p.clubUid === club.uid);
  const taken = new Set<number>();
  const tactic: ClubTactic = {
    style: "CONT",
    copies: 3,
    slots: SLOTS.map(([inPossession, outOfPossession, line, side, position], index) => {
      const pick = squad
        .filter((p) => !taken.has(p.uid))
        .sort((a, b) => (f.ratings[b.uid]?.[position] ?? 0) - (f.ratings[a.uid]?.[position] ?? 0))[0];
      if (pick) taken.add(pick.uid);
      return {
        index,
        // One unknown mask, as the Game Pass save had, so the tab shows what it does with one.
        inPossession: index === 7 ? null : inPossession,
        outOfPossession,
        inPossessionMask: index === 7 ? "408000" : "200002",
        outOfPossessionMask: "200008",
        line,
        side,
        player: pick?.uid ?? null,
      };
    }),
  };
  return {
    club,
    tactics: [tactic],
    problem: null,
    players: squad.filter((p) => taken.has(p.uid)),
    roles: ROLES,
    transferBudget: 22_957_535,
    wageBudget: 3_638_850,
  };
}

/** A made-up but steady measure of how a fixture player suits a slot. */
function suggestion(f: ScoutingFixtures, player: PlayerSummary, positions: string[], club: ClubSummary): Suggestion {
  const rating = best(f, player.uid, positions);
  const roleRating = Math.min(20, 4 + player.currentAbility / 13 + ((player.uid >> 3) % 5) / 2);
  const factor = rating >= 18 ? 1 : rating >= 15 ? 0.97 : rating >= 13 ? 0.88 : 0.75;
  const fit = Math.max(0, Math.min(100, Math.round(((roleRating - 5) / 12) * 100 * factor)));
  const value = Math.round(player.currentAbility ** 3 * 9);
  const theirs = f.clubs.find((c) => c.uid === player.clubUid);
  const reasons: Reason[] = [];
  let fee: number | null = player.clubUid === null ? 0 : Math.round(value * 1.15);
  if (player.clubUid === null) reasons.push({ code: "freeAgent", points: 25, value: null });
  if (player.uid % 7 === 0) {
    reasons.push({ code: "listed", points: 15, value: null });
    fee = fee === null ? null : Math.round(fee * 0.8);
  }
  if (player.uid % 5 === 0) reasons.push({ code: "fringe", points: 10, value: 4 });
  if (player.uid % 11 === 0) reasons.push({ code: "keyPlayer", points: -15, value: 1 });
  if (player.uid % 13 === 0) reasons.push({ code: "expiring", points: 15, value: 140 });
  if (fee !== null && fee > 22_957_535 * 1.3) reasons.push({ code: "overBudget", points: -40, value: fee - 22_957_535 });
  else if (fee !== null && fee > 22_957_535) reasons.push({ code: "stretch", points: -15, value: fee - 22_957_535 });
  if (theirs?.reputation != null && club.reputation != null) {
    if (theirs.reputation > club.reputation + 1000) reasons.push({ code: "biggerClub", points: -20, value: theirs.reputation });
    else if (theirs.reputation + 1000 < club.reputation) reasons.push({ code: "smallerClub", points: 10, value: theirs.reputation });
  }
  const realism = Math.max(0, Math.min(100, 55 + reasons.reduce((sum, r) => sum + r.points, 0)));
  const age = player.age ?? 27;
  const years = age <= 29 ? 1 : age <= 31 ? 0.95 : age <= 33 ? 0.88 : 0.8;
  return {
    player,
    fit,
    inPossession: Math.round(roleRating * 10) / 10,
    outOfPossession: Math.round((roleRating - 0.6) * 10) / 10,
    positionRating: rating,
    realism,
    reasons,
    fee,
    wage: Math.round(250 + player.currentAbility ** 2.4 / 6),
    value,
    score: Math.round((0.7 * fit + 0.3 * realism) * years),
  };
}

export function scoutingSuggest(f: ScoutingFixtures, request: ScoutRequest): Scouted {
  const club = humanClub(f);
  const role = ROLES.find((r) => r.key === request.inPossession && r.phase === "inPossession")
    ?? ROLES.find((r) => r.key === request.outOfPossession && r.phase === "outOfPossession");
  if (!role) {
    throw { code: "scout.unknownRole", message: "unknown role", params: { role: request.inPossession ?? "" } };
  }
  const positions = positionsOf(role.line, request.side ?? null);
  const pool = f.players.filter((p) => !f.women.has(p.uid) && p.clubUid !== club.uid);
  const fitting = pool
    .filter((p) => best(f, p.uid, positions) >= 10)
    .filter((p) => (request.minAge == null || (p.age ?? 0) >= request.minAge) && (request.maxAge == null || (p.age ?? 99) <= request.maxAge))
    .filter((p) => !(request.noFreeAgents && p.clubUid === null));
  const currentRow = f.players.find((p) => p.uid === request.current);
  const current = currentRow ? suggestion(f, currentRow, positions, club) : null;
  let suggestions = fitting.map((p) => suggestion(f, p, positions, club));
  if (request.upgradesOnly && current) suggestions = suggestions.filter((s) => s.fit > current.fit);
  if (request.realisticOnly) suggestions = suggestions.filter((s) => s.realism >= 50);
  if (request.maxFee != null) suggestions = suggestions.filter((s) => s.fee !== null && s.fee <= request.maxFee!);
  const order = request.order ?? "score";
  suggestions.sort((a, b) =>
    order === "fit" ? b.fit - a.fit
    : order === "realism" ? b.realism - a.realism
    : order === "fee" ? (a.fee ?? Infinity) - (b.fee ?? Infinity)
    : b.score - a.score);
  return {
    suggestions: suggestions.slice(0, request.limit ?? 50),
    current,
    transferBudget: 22_957_535,
    wageRoom: 666_235,
    examined: f.players.length,
    candidates: fitting.length,
  };
}
