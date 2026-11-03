// The English text of the UI, and the shape every language has: `tr.ts` and `es.ts` are typed `Strings`, which is
// `typeof en`, so a key that one dictionary has and another lacks fails the build. A new language is a new file like
// them, which `index.ts` then offers and `SettingsMenu.tsx` gives a flag.
//
// Keys of the game data map to the names FM uses; every other string of the panels is in `profile` (those only the
// club panel has, in `clubProfile`), and those of the player, staff and club lists in `playerList`, `staffList` and
// `clubList` (the saved player filters are in `playerList.filters.saved`). Editing has `edit` (and `fields` for the
// names of the fields), the Changes view `changes`, mass editing `massEdit`, comparing players `comparison`, moving a
// player to another club or swapping him with one `move`, a club's squad `squad`, the sidebar and the connect panel
// `app`, and the graphics packs the pictures come from `graphics`. The components read them through `labels.ts`.
//
// The text functions (counts, summaries, "was …") are written per language: plurals and word order differ, so a
// language builds its sentences itself.

import type {
  CheckKey,
  Entity,
  ExportFormat,
  GraphicsCounts,
  MassOperationKind,
  MassPreview,
  PlayerSort,
  SquadSort,
  Storefront,
} from "../types";
import { fieldName } from "./fieldNames";

const numbers = new Intl.NumberFormat("en-GB");
const percents = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** A count or an amount with the thousands separators of the language: "12,345". */
const format = (value: number) => numbers.format(value);

/** "No changes", "1 change", "3 changes", "12,345 changes". */
const changeCount = (count: number) =>
  count === 0 ? "No changes" : count === 1 ? "1 change" : `${format(count)} changes`;

/** "1 value left alone", "12 values left alone". */
const valuesLeftAlone = (count: number) =>
  count === 1 ? "1 value left alone" : `${format(count)} values left alone`;

/** "237 players", "1 player", "237 staff", "1 member of staff", "12 clubs", "1 club". */
const entityCount: Record<Entity, (count: number) => string> = {
  player: (count) => (count === 1 ? "1 player" : `${format(count)} players`),
  staff: (count) => (count === 1 ? "1 member of staff" : `${format(count)} staff`),
  club: (count) => (count === 1 ? "1 club" : `${format(count)} clubs`),
};

/** What each list holds, in the plural. */
const entityNouns: Record<Entity, string> = { player: "players", staff: "staff", club: "clubs" };

const SQUAD_STATUSES: Partial<Record<number, string>> = {
  1: "Star player",
  2: "Important player",
  3: "Regular starter",
  4: "Rotation player",
  5: "Impact sub",
};

/**
 * Sentences for the failures of the Rust commands, by code (see `describeError` in format.ts). Each gets the values
 * the failure names, its amounts and dates already written out; fields come as keys, which `fieldName` names. A code
 * a dictionary leaves out shows the English message the command sent.
 */
export type ErrorTexts = Partial<Record<string, (params: Readonly<Record<string, string>>) => string>>;

/** The name of the field a failure names. */
const field = (key: string | undefined) => fieldName(en, key ?? "");

/** What a check is about, from the key a failure gives, with a capital: "Contracts". */
const checkName = (key: string | undefined) => {
  const name = (en.checks as Partial<Record<string, string>>)[key ?? ""] ?? key ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** The commands' own English is kept where it names no field. */
const errors: ErrorTexts = {
  "edit.unknownField": (p) => `There is no editable field “${p.field}” here.`,
  "edit.outOfRange": (p) => `${p.value} is not a valid ${field(p.field)}: it takes ${p.min} to ${p.max}.`,
  "edit.notADate": (p) => `${p.value} is not a date for ${field(p.field)}.`,
  "edit.notAChoice": (p) => `${p.value} is not one of the values ${field(p.field)} takes.`,
  "edit.taken": (p) => `Squad number ${p.value} is taken: ${p.name ?? `the player with UID ${p.uid}`} wears it.`,
  "edit.unsupported": (p) => `${field(p.field)} cannot be changed that way: ${p.reason}.`,
  "edit.noRecord": (p) => `${field(p.field)} cannot be changed here: its record is missing or does not check out.`,
  "edit.unset": (p) => `${field(p.field)} is not set in the game, so it was left alone.`,
  "edit.implausible": (p) => `${field(p.field)} reads ${p.value}, which it cannot hold; it was left alone to be safe.`,
  "edit.notApplied": (p) => `${field(p.field)}: wrote ${p.wrote} but read back ${p.read}.`,
  "edit.conflict": (p) => `${field(p.field)} is now ${p.found}, not ${p.expected}: the game has changed it since.`,
  "move.outOfRange": (p) => `${p.value} is not a valid ${field(p.field)}: it takes ${p.min} to ${p.max}.`,
  "export.failed": (p) => `Could not write the file: ${p.reason}`,
  "export.openFailed": (p) => `Could not open it: ${p.reason}`,
  "guard.unknownBuild": () =>
    "FMLibreEditor has not been checked with this version of the game, so it does not write to it. Edit anyway, in " +
    "the notice at the top, turns editing on.",
  "guard.failed": (p) =>
    `${checkName(p.check)} did not check out in this version of the game, so FMLibreEditor leaves them unchanged.`,
  "memory.noBridge": () =>
    "macOS does not let FMLibreEditor into the game: the game was started without the FMLibreEditor bridge. Set " +
    "the bridge up, then start the game again from Steam.",
  "setup.steamRunning": () =>
    "Steam is running, so FM27's launch options were left alone; the bridge itself is installed. Quit Steam and " +
    "try again, or enter the launch option in Steam yourself.",
};

/** The kinds of contract clauses and bonuses, by the codes contracts hold them as; named as FMRTE names them. */
const CLAUSE_NAMES_EN: Partial<Record<number, string>> = {
  0: "Minimum fee release clause",
  1: "Relegation release clause",
  3: "Yearly wage rise",
  10: "Seasonal landmark goal bonus",
  15: "Top division relegation wage drop",
  19: "Wage after reaching international matches",
  22: "Optional contract extension by club",
  27: "Minimum fee release clause (clubs in the Champions Cup)",
  32: "Appearance fee",
  33: "Goal bonus",
  34: "Clean sheet bonus",
  38: "Unused substitute fee",
  39: "Assist bonus",
  40: "Seasonal landmark assist bonus",
};

/** Reasons to be unhappy, by the codes the game keeps them as; named as FMRTE names them. */
const CONCERN_MOTIVES_EN: Partial<Record<number, string>> = {
  596: "Left out of a competition squad",
  808: "Thinks a teammate has been treated unfairly",
  926: "Doesn't believe a teammate deserves the playing time he wants",
};

/** Players' traits (preferred moves), by their bit in the game's mask; named as FMRTE names them. */
const TRAIT_NAMES_EN: readonly string[] = [
  "Runs with ball down left",
  "Runs with ball down right",
  "Runs with ball through centre",
  "Gets into opposition area",
  "Moves into channels",
  "Gets forward whenever possible",
  "Plays short simple passes",
  "Tries killer balls often",
  "Shoots from distance",
  "Shoots with power",
  "Places shots",
  "Curls ball",
  "Likes to round keeper",
  "Likes to try to beat offside trap",
  "Uses outside of foot",
  "Marks opponent tightly",
  "Winds up opponents",
  "Argues with officials",
  "Plays with back to goal",
  "Comes deep to get ball",
  "Plays one-twos",
  "Likes to lob keeper",
  "Dictates tempo",
  "Attempts overhead kicks",
  "Looks for pass rather than attempting to score",
  "Plays no through balls",
  "Stops play",
  "Knocks ball past opponent",
  "Moves ball to right foot before dribble attempt",
  "Moves ball to left foot before dribble attempt",
  "Dwells on ball",
  "Arrives late in opponents' area",
  "Tries to play way out of trouble",
  "Stays back at all times",
  "Avoids using weaker foot",
  "Tries tricks",
  "Tries long range free kicks",
  "Dives into tackles",
  "Does not dive into tackles",
  "Cuts inside",
  "Hugs line",
  "Gets crowd going",
  "Tries first time shots",
  "Tries long range passes",
  "Likes ball played into feet",
  "Hits free kicks with power",
  "Likes to beat man repeatedly",
  "Likes to switch ball to other flank",
  "Will retire at top",
  "Will play football as long as possible",
  "Possesses long flat throw",
  "Runs with ball often",
  "Runs with ball rarely",
  "Attempts to develop weaker foot",
  "Static target man",
  "Uses long throw to start counter attacks",
  "Refrains from taking long shots",
  "Cuts inside from left wing",
  "Cuts inside from right wing",
  "Crosses early",
  "Brings ball out of defence",
  "Plays ball with feet"
];

export const en = {
  attributes: {
    // Technical
    corners: "Corners",
    crossing: "Crossing",
    dribbling: "Dribbling",
    finishing: "Finishing",
    first_touch: "First Touch",
    free_kicks: "Free Kick Taking",
    heading: "Heading",
    long_shots: "Long Shots",
    long_throws: "Long Throws",
    marking: "Marking",
    passing: "Passing",
    penalty_taking: "Penalty Taking",
    tackling: "Tackling",
    technique: "Technique",
    // Mental
    aggression: "Aggression",
    anticipation: "Anticipation",
    bravery: "Bravery",
    composure: "Composure",
    concentration: "Concentration",
    decisions: "Decisions",
    determination: "Determination",
    flair: "Flair",
    leadership: "Leadership",
    off_the_ball: "Off the Ball",
    positioning: "Positioning",
    teamwork: "Teamwork",
    vision: "Vision",
    work_rate: "Work Rate",
    // Physical
    acceleration: "Acceleration",
    agility: "Agility",
    balance: "Balance",
    jumping_reach: "Jumping Reach",
    natural_fitness: "Natural Fitness",
    pace: "Pace",
    stamina: "Stamina",
    strength: "Strength",
    // Goalkeeping (first touch and passing are shared with Technical)
    aerial_reach: "Aerial Reach",
    command_of_area: "Command of Area",
    communication: "Communication",
    eccentricity: "Eccentricity",
    handling: "Handling",
    kicking: "Kicking",
    one_on_ones: "One on Ones",
    punching: "Punching (Tendency)",
    reflexes: "Reflexes",
    rushing_out: "Rushing Out (Tendency)",
    throwing: "Throwing",
    // Hidden
    consistency: "Consistency",
    dirtiness: "Dirtiness",
    important_matches: "Important Matches",
    injury_proneness: "Injury Proneness",
    versatility: "Versatility",
    // Feet
    left_foot: "Left Foot",
    right_foot: "Right Foot",
  },

  staffAttributes: {
    // Coaching
    attacking: "Attacking",
    defending: "Defending",
    fitness: "Fitness",
    goalkeeping: "Goalkeeping",
    possession: "Possession",
    set_pieces: "Set Pieces",
    tactical: "Tactical",
    technical: "Technical",
    working_with_youngsters: "Working with Youngsters",
    // Mental
    authority: "Authority",
    determination: "Determination",
    motivating: "Motivating",
    people_management: "People Management",
    // Knowledge
    data_analysis: "Data Analysis",
    judging_ability: "Judging Player Ability",
    judging_potential: "Judging Player Potential",
    judging_staff: "Judging Staff Ability",
    negotiating: "Negotiating",
    tactical_knowledge: "Tactical Knowledge",
    // Medical
    physiotherapy: "Physiotherapy",
    sports_science: "Sports Science",
  },

  personality: {
    adaptability: "Adaptability",
    ambition: "Ambition",
    loyalty: "Loyalty",
    pressure: "Pressure",
    professionalism: "Professionalism",
    sportsmanship: "Sportsmanship",
    temperament: "Temperament",
    controversy: "Controversy",
  },

  /** The abbreviations of the positions: the same in every language. */
  positions: {
    gk: "GK",
    sw: "SW",
    dl: "DL",
    dc: "DC",
    dr: "DR",
    dm: "DM",
    ml: "ML",
    mc: "MC",
    mr: "MR",
    aml: "AML",
    amc: "AMC",
    amr: "AMR",
    st: "ST",
    wbl: "WBL",
    wbr: "WBR",
  },

  clubFacilities: {
    training: "Training",
    youth_facilities: "Youth Facilities",
    youth_coaching: "Youth Coaching",
    youth_recruitment: "Youth Recruitment",
    /** Only a club with finances has it. */
    corporate: "Corporate",
  },

  supporterTraits: {
    loyalty: "Loyalty",
    passion: "Passion",
    patience: "Patience",
    affluence: "Affluence",
    temperament: "Temperament",
    expectations: "Expectations",
  },

  /** The kinds of supporters, in the order of the supporter-mix bar. */
  supporterMix: {
    hardcore: "Hardcore",
    core: "Core",
    family: "Family",
    fair_weather: "Fair-weather",
    casual: "Casual",
    other: "Other",
  },

  /** FM's job codes as stored in contracts. */
  jobs: {
    1: "Player",
    2: "Coach",
    4: "Chairperson",
    6: "Director",
    12: "Physio",
    14: "Scout",
    16: "Manager",
    20: "Assistant Coach",
    22: "Set Piece Coach",
    26: "Fitness Coach",
    34: "Goalkeeping Coach",
    40: "Head of Sports Science",
    44: "Chief Scout",
    48: "Sports Scientist",
    50: "Head Physio",
    58: "Recruitment Analyst",
    60: "Performance Analyst",
    64: "Head of Youth Development",
    70: "President",
    86: "Loan Manager",
    88: "Technical Director",
  },

  /** The names of the fields that are not attributes, personality or positions, by key. */
  fields: {
    current_ability: "Current ability",
    potential_ability: "Potential ability",
    height: "Height (cm)",
    date_of_birth: "Date of birth",
    asking_price: "Asking price",
    nation: "Nationality",
    "reputation.home": "Home reputation",
    "reputation.current": "Current reputation",
    "reputation.world": "World reputation",
    "international.caps": "Caps",
    "international.goals": "International goals",
    "international.u21_caps": "U21 caps",
    "international.u21_goals": "U21 goals",
    // What the game changes every day.
    condition: "Energy",
    match_sharpness: "Match sharpness",
    jadedness: "Jadedness",
    morale: "Morale",
    "contract.wage": "Wage per week",
    "contract.loyalty_bonus": "Loyalty bonus per week",
    "contract.happiness": "Happiness",
    "contract.playing_time_happiness": "Playing time happiness",
    "contract.unhappiness": "Reasons to be unhappy",
    "contract.expires": "Contract end",
    "contract.squad_number": "Squad number",
    "contract.squad_status": "Squad status",
    "contract.transfer_listed": "Transfer listed",
    "contract.loan_listed": "Loan listed",
    // A member of staff's job, which the change log keeps as a change of its code.
    "contract.job": "Job",
    // A player's ties, which the change log keeps as changes of the nation or club (see `ties`).
    "tie.nationality": "Secondary nationality",
    "tie.trainedInNation": "Trained in nation",
    "tie.trainedAtClub": "Trained at club",
    // A move to another club, which the change log keeps as a change of the player's club.
    club: "Club",
    // Healing a player, which the change log keeps as a change of his injuries.
    injuries: "Injuries",
    // Lifting a player's bans, which the change log keeps as a change of his bans.
    bans: "Bans",
    // Keeping a player from retiring, which the change log keeps as a change of the date he was to retire on.
    retirement: "Retirement",
    // A change to a player's contract clauses, which the change log keeps as a change of the clause's amount.
    clause: "Contract clause",
    "clause.amount": "Clause amount",
    "clause.condition": "Clause condition",
    // Making a player the captain or vice-captain of one of a club's teams, which the change log keeps as a change of
    // the club's captain or vice-captain.
    captain: "Captain",
    vice_captain: "Vice-captain",
    // A club's own reputation, which has no home, current or world.
    reputation: "Reputation",
    "facilities.training": "Training facilities",
    "facilities.youth_facilities": "Youth facilities",
    "facilities.youth_coaching": "Youth coaching",
    "facilities.youth_recruitment": "Youth recruitment",
    "facilities.corporate": "Corporate facilities",
    "finance.balance": "Balance",
    "finance.transfer_budget": "Transfer budget",
    "finance.wage_budget": "Wage budget",
    "finance.total_wage_budget": "Total wage budget",
    "stadium.capacity": "Stadium capacity",
    "stadium.seating": "Seated capacity",
    "stadium.used": "Capacity in use",
    "stadium.expansion": "Expansion capacity",
  },

  profile: {
    close: "Close profile",
    loading: "Loading profile…",
    /** The handle on the left edge of the panel. */
    resize: "Resize the profile panel",
    resizeHint: "Drag to make the panel wider or narrower; double-click to reset it",
    /** Shown where a value is missing. */
    none: "—",

    // Header
    freeAgent: "Free agent",
    born: "Born",
    height: (cm: number) => `${cm} cm`,
    /** After the input of the height, while the player is edited. */
    heightUnit: "cm",
    uid: "UID",
    currentAbility: "Current ability",
    currentAbilityShort: "CA",
    potentialAbility: "Potential ability",
    potentialAbilityShort: "PA",
    /** Hover text of a potential ability that is set as a range (the game stores it as a negative number). */
    potentialRange: "Potential set as a range",

    // Attributes
    technical: "Technical",
    goalkeeping: "Goalkeeping",
    mental: "Mental",
    physical: "Physical",
    hidden: "Hidden",
    feet: "Feet",
    personality: "Personality",
    /** Hover text of an attribute: the value as stored, 0–100 unless the game stores it on another scale. */
    raw: (raw: number, scale = 100) => `raw ${raw} / ${scale}`,
    lowerIsBetter: "lower is better",
    age: (age: number) => `age ${age}`,

    // Positions
    positions: "Positions",
    positionsSummary: (best: string) => `Position ratings: ${best}`,
    /** The group of every position's rating, under the pitch. */
    positionRatings: "Position ratings",
    positionTiers: {
      natural: "Natural",
      accomplished: "Accomplished",
      competent: "Competent",
      unconvincing: "Unconvincing",
      ineffective: "Ineffective",
    },
    positionTooltip: (position: string, rating: number, tier: string) => `${position} · ${rating} · ${tier}`,

    // Contract
    contract: "Contract",
    wage: "Wage per week",
    /** Under the wage: the game keeps money in pounds; `converted` when the app shows another currency. */
    wageNote: (converted: boolean): string =>
      converted
        ? "the game keeps pounds; shown at FM's own exchange rate"
        : "the game keeps pounds; another currency can be chosen in the settings",
    signed: "Signed",
    expires: "Expires",
    joined: "Joined",
    squadStatus: "Squad status",
    squadStatusName: (status: number) => SQUAD_STATUSES[status] ?? `Status ${status}`,
    squadNumber: "Squad number",
    transferListed: "Transfer listed",
    loanListed: "Loan listed",

    // Career
    career: "Career",
    internationalCaps: "International caps",
    internationalGoals: "International goals",
    u21Caps: "U21 caps",
    u21Goals: "U21 goals",
    askingPrice: "Asking price",
    notSet: "Not set",
    reputation: "Reputation",
    reputationHome: "Home",
    reputationCurrent: "Current",
    reputationWorld: "World",
    /** The retirement the game has planned for a player, and the button that keeps him playing. */
    retirement: "Retirement",
    retires: "Plans to retire",
    noRetirement: "The game has not planned his retirement",
    keepPlaying: "Prevent retirement",
    keepingPlaying: "Preventing…",
    keepPlayingTitle:
      "Take his retirement out of the game's plans and give him the trait “Will play football as long as possible” in place of “Will retire at top”; Changes can undo it",

    // Medical (the group's heading is `medical`, below; the names of its values are in `fields`)
    /** A player's morale, 1–20. */
    morale: (value: number) => `${value} / 20`,
    /** Hover text of his morale: the game shows it as his overall happiness. */
    /** A player's traits (preferred moves): the heading, none, and each one's name by its bit. */
    traits: "Traits",
    noTraits: "No traits",
    traitName: (bit: number) => TRAIT_NAMES_EN[bit] ?? `Trait ${bit}`,
    /** A player's reasons to be unhappy, as FMRTE lists them, and the button that removes them all. */
    unhappiness: "Unhappiness",
    noUnhappiness: "Nothing makes him unhappy",
    removeUnhappiness: "Remove all",
    removingUnhappiness: "Removing…",
    removeUnhappinessTitle: "Take every reason to be unhappy off his list, as FMRTE's Remove all does; Changes can undo it",
    concernSince: (date: string) => `since ${date}`,
    concernKind: (kind: number) => (kind === 1 ? "Concerned" : kind === 2 ? "Internal" : `Type ${kind}`),
    concernMotive: (motive: number) => CONCERN_MOTIVES_EN[motive] ?? `Reason ${motive}`,
    /** A contract's clauses and bonuses: the heading, and what each kind the game has is called. */
    clauses: "Bonuses and clauses",
    noClauses: "No bonuses or clauses",
    loyaltyBonus: "Loyalty bonus",
    happiness: "Happiness",
    playingTimeHappiness: "Playing time happiness",
    moodTitle: "As FMRTE shows it, from -100 to 100; the game shows it in words",
    /** The name of a clause or bonus by its kind; a kind the app does not know yet by its number. */
    clauseName: (kind: number) => CLAUSE_NAMES_EN[kind] ?? `Clause ${kind}`,
    /** What a clause depends on, by kind: goals, assists, matches, years or a percentage. */
    clauseCondition: (kind: number, value: number) => {
      switch (kind) {
        case 10:
          return `${value} goals`;
        case 40:
          return `${value} assists`;
        case 19:
          return `${value} international matches`;
        case 22:
          return value === 1 ? "1 year" : `${value} years`;
        case 3:
        case 15:
          return `${value}%`;
        default:
          return String(value);
      }
    },
    moraleTitle: "The game shows morale as the player's overall happiness: content at 10, slightly happy at 11, extremely happy at 15 and 20",
    /** Hover text of jadedness, which the profile shows as stored. */
    jadednessTitle: "How worn out the player is by playing, which rest takes away: -500 is fully rested, and the higher it is, the more he needs a rest",
    noInjuries: "No injuries",
    /** The name of an injury the game gave none for. */
    unknownInjury: "Unknown injury",
    /** Under the name of an injury: when it began, and when he is expected back (`dates`: one date, or a range). */
    injuryStarted: (date: string) => `Started ${date}`,
    injuryBack: (dates: string) => `Expected back ${dates}`,
    /** Heals every injury of the player at once. */
    heal: "Heal",
    healTitle: "Heal every injury of this player in the game",
    noBans: "No bans",
    /** A ban: how many matches the player still has to miss, and under it when it began. */
    banMatches: (matches: number) => (matches === 1 ? "1 match" : `${format(matches)} matches`),
    banStarted: (date: string) => `From ${date}`,
    /** Lifts every ban of the player at once. */
    liftBans: "Lift",
    liftBansTitle: "Lift every ban of this player in the game",

    // Above the attributes, while the profile is read
    /** Sets every attribute of the player to its best at once. */
    maxAttributes: "Max attributes",
    maxAttributesTitle: "Set every attribute of this player to its best: 20, and 1 for injury proneness and dirtiness",
    /** What Max attributes wrote, beside the button that takes it back; then what that undid. */
    maxAttributesDone: (count: number) =>
      count === 0 ? "Every attribute is at its best already" : `${changeCount(count)} written`,
    maxAttributesUndone: (count: number) => (count === 0 ? "Nothing was undone" : `Undid ${changeCount(count)}`),
    undoMax: "Undo",
    undoMaxTitle: "Write his old attributes back to the game",
    /** Freezing his attributes, while the game can be written to, and what that does. */
    freezeAttributes: "Freeze attributes",
    freezeAttributesNote:
      "While the app is open and connected, his attributes do not get worse: what the game takes is put back, and " +
      "improvements still count. The app remembers this for this save, and freezes them again when it connects to it.",

    // Staff
    /** Badge on the manager the user controls. */
    you: "You",
    youTitle: "The manager you control in this save",
    id: "ID",
    job: "Job",
    /** Giving a member of staff another job at their club, under the job in the contract. */
    changeJob: "Change job",
    changeJobTitle: "Give this member of staff another job at their club in the game",
    newJob: "New job",
    applyJob: "Apply",
    cancelJob: "Cancel",
    unemployed: "Unemployed",
    coaching: "Coaching",
    knowledge: "Knowledge",
    medical: "Medical",
    /** A coaching job held by someone who still plays. */
    playerCoach: (job: string) => `${job} (player-coach)`,
    unknownJob: (code: number) => `Job ${code}`,
  },

  /** The player list: search, filter bar and columns. */
  playerList: {
    /** The entry in the sidebar. */
    nav: "Players",
    /** In the status line, once connected. */
    count: (total: number) => `${format(total)} players`,
    search: "Search players by name or UID",
    /**
     * The line beside the search box. `sorted` is the order a column header was clicked for, or null while the
     * list is in its default order (best current ability first); its `by` is a name from `sortNames`.
     */
    summary: (total: number, shown: number, sorted: { by: string; ascending: boolean } | null) => {
      const count = `${format(total)} players`;
      if (total <= shown) {
        return count;
      }
      return sorted === null
        ? `${count} · showing the top ${shown} by current ability`
        : `${count} · showing the first ${shown} by ${sorted.by}, ${sorted.ascending ? "ascending" : "descending"}`;
    },
    /** The message under an empty table; `filtered` is whether any filter is in effect. */
    empty: (query: string, filtered: boolean) => {
      if (query === "") {
        return filtered ? "No players match these filters." : "No players found.";
      }
      return filtered ? `No players match “${query}” with these filters.` : `No players match “${query}”.`;
    },
    columns: {
      name: "Name",
      age: "Age",
      positions: "Positions",
      nation: "Nation",
      club: "Club",
      contractExpires: "Contract",
      born: "Born",
      currentAbility: "CA",
      potentialAbility: "PA",
      uid: "UID",
    } satisfies Record<PlayerSort | "positions" | "born" | "uid", string>,
    /** Hover text of a column header that sorts the list; `by` is a name from `sortNames`. */
    sortBy: (by: string) => `Sort by ${by}`,
    /** The name of each sortable column, as the summary line and the hover text of a header say it. */
    sortNames: {
      currentAbility: "current ability",
      potentialAbility: "potential ability",
      age: "age",
      name: "name",
      nation: "nation",
      club: "club",
      contractExpires: "contract end",
    } satisfies Record<PlayerSort, string>,
    filters: {
      /** The button that shows or hides the filters. */
      toggle: "Filters",
      /** Its name for assistive technology while `count` of the filters are in effect. */
      toggleActive: (count: number) => `Filters, ${count} active`,
      clear: "Clear",
      /** The entry of the position select that is no filter. */
      any: "Any",
      position: "Position",
      age: "Age",
      minAge: "Minimum age",
      maxAge: "Maximum age",
      /** The hint in an empty age input. */
      minPlaceholder: "Min",
      maxPlaceholder: "Max",
      minCurrentAbility: "Min CA",
      minCurrentAbilityTitle: "Minimum current ability",
      minPotentialAbility: "Min PA",
      minPotentialAbilityTitle: "Minimum potential ability",
      /** The hint in an empty ability input: what it accepts. */
      abilityPlaceholder: "1–200",
      nation: "Nation",
      club: "Club",
      freeAgentsOnly: "Free agents only",
      contractEndsBy: "Contract ends by",
      transferListedOnly: "Transfer listed only",
      loanListedOnly: "Loan listed only",
      /** Bounds on attributes, a row each, under the other filters; the staff list has them too. */
      attributes: {
        heading: "Attributes",
        /** The select of a row, for assistive technology, and its entry before an attribute is picked. */
        attribute: "Attribute",
        pick: "Pick an attribute",
        /** The two inputs of a row, for assistive technology; `name` is the attribute, "" before one is picked. */
        min: (name: string) => (name ? `Least ${name}` : "Least"),
        max: (name: string) => (name ? `Most ${name}` : "Most"),
        add: "Add attribute",
        /** The button that takes a row away, for assistive technology and as its hover text. */
        remove: (name: string) => (name ? `Remove ${name}` : "Remove this row"),
      },
      /** Saving the filters in effect, and the sort, under a name of the user's own; the names stay as typed. */
      saved: {
        /** The button that starts saving, and its hover text. */
        save: "Save",
        saveTitle: "Save the filters and the sort in effect under a name",
        /** The name input, for assistive technology, and the hint in it while it is empty. */
        name: "Name of the saved filter",
        namePlaceholder: "Filter name",
        ok: "OK",
        cancel: "Cancel",
        /** The select of the saved filters: its name, and what it shows while none is the one in effect. */
        select: "Saved filters",
        delete: "Delete",
        /** The name and hover text of Delete; `name` is the saved filter's. */
        deleteTitle: (name: string) => `Delete the saved filter: ${name}`,
        /** The question when the name is taken; `name` is the one typed. */
        replaceQuestion: (name: string) => `A saved filter named “${name}” already exists. Replace it?`,
        replace: "Replace",
        /** When the name is a new one and `max` filters are saved already. */
        full: (max: number) =>
          `Up to ${max} filters can be saved. Delete one first, or use the name of a saved filter to replace it.`,
      },
    },
  },

  /** The staff list. */
  staffList: {
    /** The entry in the sidebar. */
    nav: "Staff",
    /** In the status line, once connected. */
    count: (total: number) => `${format(total)} staff`,
    search: "Search staff by name or ID",
    summary: (total: number, shown: number) =>
      total > shown
        ? `${format(total)} staff · showing the top ${shown} by current ability`
        : `${format(total)} staff`,
    /** The message under an empty table; `filtered` is whether any filter is in effect. */
    empty: (query: string, filtered: boolean) => {
      if (query === "") {
        return filtered ? "No staff match these filters." : "No staff found.";
      }
      return filtered ? `No staff match “${query}” with these filters.` : `No staff match “${query}”.`;
    },
    columns: {
      name: "Name",
      age: "Age",
      job: "Job",
      club: "Club",
      nation: "Nation",
      born: "Born",
      currentAbility: "CA",
      potentialAbility: "PA",
      id: "ID",
    },
    filters: {
      job: "Job",
      /** The entry of the job select that is no filter. */
      anyJob: "Any",
      unemployedOnly: "Unemployed only",
    },
  },

  /** The club profile: what the player and staff panels do not have. */
  clubProfile: {
    // Header
    womensClub: "Women's club",
    /** "Founded 1882", in the line under the name. */
    founded: (year: number) => `Founded ${year}`,
    reputationShort: "REP",
    reputationTitle: "Reputation",

    // The tabs under the header: what the club has, and its squad (see `squad`).
    /** The name of the tabs for assistive technology. */
    tabsLabel: "Club sections",
    tabs: { overview: "Overview", squad: "Squad" },
    /** Hover text of the Squad tab while the club is edited: its values are on the Overview. */
    squadLocked: "Finish editing to open the squad",

    facilities: "Facilities",

    // Supporters
    supporters: "Supporters",
    supporterMix: "Supporter mix",
    /** A share of the supporters; `value` is already a percentage (35 for 35%). */
    percent: (value: number) => `${percents.format(value)}%`,
    /** Hover text of a segment of the supporter-mix bar. */
    mixTooltip: (kind: string, percent: string) => `${kind} · ${percent}`,

    // Finances
    finances: "Finances",
    balance: "Balance",
    transferBudget: "Transfer budget",
    wageBudget: "Wage budget (spending)",
    totalWageBudget: "Total wage budget",
    ticketPrice: "Average ticket price",
    /** Under the labels of the two wage budgets, which are amounts per week. */
    perWeek: "per week",
    /** Clubs outside the leagues being played have no finance record in memory. */
    noFinances: "FM keeps finances only for clubs in the leagues being played.",
    /** Freezing the club's money, while the game can be written to, and what that does. */
    freeze: "Freeze money",
    freezeNote:
      "While the app is open and connected, the balance does not go down: what the game takes is put back, and " +
      "income still counts. The app remembers this for this save, and freezes it again when it connects to it.",

    // Stadium
    stadium: "Stadium",
    capacity: "Capacity",
    seating: "Seated",
    used: "In use",
    /** The capacity in use when the game does not limit it (stored as 0). */
    usedAll: "All of it",
    usedTitle: "The part of the capacity the game lets in, when it limits it (for example while seats are closed); 0 means all of it",
    expansion: "Can grow to",
    /** When the layout of this build does not know where the stadium is, or the club's stadium did not check out. */
    noStadium: "The stadium could not be read for this club.",

    // Club info
    info: "Club info",
    seasonTickets: "Season tickets",
    socialMedia: "Social media followers",
  },

  /** The club list, with the sidebar entry and the status-line count that go with it. */
  clubList: {
    /** The entry in the sidebar. */
    nav: "Clubs",
    /** In the status line, once connected. */
    count: (total: number) => `${format(total)} clubs`,
    search: "Search clubs by name or UID",
    summary: (total: number, shown: number) =>
      total > shown
        ? `${format(total)} clubs · showing the top ${shown} by reputation`
        : `${format(total)} clubs`,
    /** The message under an empty table; `filtered` is whether a filter is in effect. */
    empty: (query: string, filtered: boolean) => {
      if (query === "") {
        return filtered ? "No clubs match this filter." : "No clubs found.";
      }
      return filtered ? `No clubs match “${query}” with this filter.` : `No clubs match “${query}”.`;
    },
    /** The small tag on a women's club. */
    women: "Women",
    columns: {
      name: "Name",
      reputation: "Reputation",
      founded: "Founded",
      uid: "UID",
    },
    filters: {
      /** The name of the select, which has no label of its own. */
      kind: "Clubs to show",
      all: "All clubs",
      men: "Men's clubs",
      women: "Women's clubs",
    },
  },

  /** The app around the lists: the sidebar, the status line and the connect panel. */
  app: {
    /** The small line under the name in the sidebar. */
    stage: "beta",
    /** The settings menu at the right of the masthead: its name, and the headings of its two lists. */
    settingsLabel: "Settings",
    languageLabel: "Language",
    currencyLabel: "Currency",

    // The note at the foot of the sidebar; which one shows depends on the connection (see `ConnectionInfo.editable`).
    /** Connected, and the game was opened for writing. */
    noteEditable: "Edits reach the game only when you apply them. Back up your save first.",
    /** Connected, but Windows did not allow writing. */
    noteReadOnly: "Read-only: Windows did not let FMLibreEditor write to the game.",
    /** Read-only because the game is a version FMLibreEditor was not checked with (see `compatibility`). */
    noteUnknownBuild: "Read-only: this version of the game is new to FMLibreEditor.",
    noteNotConnected: "Nothing in the game changes until you edit and apply.",

    // The status line and the busy texts beside it
    notConnected: "Not connected",
    /** Beside the status line in a plain browser, where fixtures stand in for the game. */
    previewTag: "browser preview · sample data",
    /** In place of the game's date when it could not be read, and the note it shows on hover. */
    noDate: "No in-game date",
    noDateTitle:
      "FMLibreEditor could not read the in-game date in this version of the game, so ages are not shown and age " +
      "filters find no one. Check for updates.",
    /** The button that reads the game again, once connected. */
    reload: "Reload data",
    /** The button that looks for the game again, while not connected. */
    refresh: "Refresh",
    detecting: "Looking for Football Manager…",
    connecting: "Reading players, staff and clubs…",
    reloading: "Reloading players, staff and clubs…",

    /** The notice after connecting to a save in which something was frozen before (`FrozenNotice`). */
    refrozen: {
      title: "Frozen again from last time",
      /** When nothing could be frozen again. */
      waitingTitle: "What was frozen waits for now",
      /** `names` are the players' names, set apart by commas. */
      players: (names: string) => `Attributes: ${names}`,
      clubs: (names: string) => `Money: ${names}`,
      /** After the first few names. */
      more: (count: number) => `and ${format(count)} more`,
      /** What was left for later: an update of the game, say. */
      waiting: (count: number) =>
        `${count === 1 ? "1 is" : `${format(count)} are`} remembered but not frozen now: FMLibreEditor cannot write ` +
        "to this version of the game yet.",
      dismiss: "Dismiss",
    },

    /** The panel shown while not connected. */
    connect: {
      title: "Connect to Football Manager 27",
      intro: "FMLibreEditor reads the game's memory while it runs. Start the game and load a save, then connect.",
      notRunning: "Football Manager 27 is not running.",
      /** `error` is the answer of the Rust side, which stays in English. */
      openFailed: (error: string) => `Could not open the game: ${error}`,
      game: "Game",
      gameData: "Game data",
      loaded: "Loaded",
      stillLoading: "Still loading; wait for the main menu",
      process: "Process",
      pid: (pid: number) => `pid ${pid}`,
      several: "Several copies of the game are running; the first one is used.",
      button: "Connect and read players, staff and clubs",

      /** macOS: the bridge FM27 has to load before the app can reach it, and setting it up. */
      bridge: {
        title: "The bridge (macOS)",
        intro:
          "macOS lets no app into another app's memory, so FM27 has to hand its memory over itself. It does once it " +
          "loads FMLibreEditor's bridge: a small library that hooks and changes nothing in the game and gives its " +
          "memory to this app only. A launch option in Steam has FM27 load it.",
        library: "Bridge",
        installed: "Installed",
        missing: "Not installed",
        launchOption: "Launch option",
        set: "Set in Steam",
        notSet: "Not set",
        ready: "Set up. Start FM27 from Steam (quit it and start it again if it is running), load a save, then connect.",
        steamRunning:
          "Steam is running, and keeps the launch options while it does. Quit Steam to have the launch option set " +
          "for you, or enter it in Steam yourself.",
        setUp: "Set up the bridge",
        remove: "Remove the bridge",
        manual: "Or, in Steam, right-click Football Manager 27 › Properties › General › Launch Options, and enter:",
        copy: "Copy",
        copied: "Copied",
      },
    },
  },

  /** The graphics packs the pictures (club logos, faces, flags) come from: their status at the foot of the sidebar. */
  graphics: {
    /** While the app is still reading the packs, which takes a moment after it starts. */
    reading: "Reading graphics packs…",
    /** What the packs hold: "Graphics: 68,131 club logos · 250 flags · 0 faces". */
    summary: ({ clubLogos, flags, faces }: Pick<GraphicsCounts, "clubLogos" | "flags" | "faces">) =>
      `Graphics: ${format(clubLogos)} club ${clubLogos === 1 ? "logo" : "logos"} · ` +
      `${format(flags)} ${flags === 1 ? "flag" : "flags"} · ${format(faces)} ${faces === 1 ? "face" : "faces"}`,
    /** When the app found no pack, and under it where packs go. The folder itself is the hover text of both lines. */
    none: "No graphics packs found",
    noneHint: "Logo and face packs go in the FM27 graphics folder.",
  },

  /**
   * The notice under the masthead when the game is a version FMLibreEditor has no profile for, or some of the checks
   * it makes before writing did not pass (`CompatibilityNotice`).
   */
  compatibility: {
    /** The headline for a version without a profile; `game` as the status line names it. */
    unknownBuild: (game: string) => `FMLibreEditor has not been checked with ${game} yet`,
    unknownBuildText:
      "The game has probably been updated. FMLibreEditor found the game's data and checked it, but it does not " +
      "write to a version it was not tested with until you allow it. A new FMLibreEditor usually follows within days.",
    /** Once Edit anyway was pressed. */
    allowedText: "Editing is on for this session, as far as the checks allow. Keep a backup of your save.",
    /** The headline when checks did not pass on a version the editor knows, and what may help. */
    failedTitle: "Some of the game's data did not check out",
    reloadHint: "If a save was still loading, Reload data checks again.",
    /** The in-game date did not check out: shown apart, as it leaves nothing read-only. */
    noDate: "The in-game date did not check out, so no ages are shown.",
    /** The other checks that did not pass, their names joined (see `checks`). */
    failed: (names: string) => `Left read-only: ${names}.`,
    /** Joins the names of the checks that did not pass. */
    join: (names: string[]) =>
      names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`,
    allow: "Edit anyway",
    allowTitle: "Turn editing on until FMLibreEditor is closed or connects again. Back up your save first.",
  },

  /** What each check is about (`CheckKey`), as the notice lists the ones that did not pass and the errors name them. */
  checks: {
    gameDate: "the in-game date",
    players: "players' details",
    positions: "positions",
    attributes: "attributes",
    personality: "personality",
    liveValues: "energy, match sharpness, jadedness and morale",
    contracts: "contracts",
    teams: "teams",
    staff: "staff",
    clubs: "clubs",
  } satisfies Record<CheckKey, string>,

  /** New versions: the notice under the masthead, and the version and Check for updates at the foot of the window. */
  update: {
    /** The notice's headline, and what a check by hand found. */
    available: (version: string) => `FMLibreEditor ${version} is available`,
    youHave: (version: string) => `You have ${version}.`,
    /** Opens the release's page in the browser. */
    download: "Download",
    /** Downloads the new version's installer and runs it, where the app can update itself (see `can_self_update`). */
    install: "Update",
    installTitle: "Download and install the new version; FMLibreEditor closes and opens again with it",
    preparing: "Preparing…",
    /** `percent` is null while the size of the download is not known. */
    downloading: (percent: number | null) => (percent === null ? "Downloading…" : `Downloading… ${percent}%`),
    installing: "Installing: FMLibreEditor closes and opens again with the new version.",
    installFailed: (reason: string) => `Could not update: ${reason}. Download it from its page instead.`,
    notInstallable: "This version cannot be installed from here. Download it from its page instead.",
    /** Hides the notice until the app starts again. */
    later: "Later",
    check: "Check for updates",
    checking: "Checking for updates…",
    upToDate: "You have the latest version.",
    failed: "Could not check for updates.",
  },

  /** Editing a person or a club: the Edit button, the inputs, and the footer under the profile. */
  edit: {
    /** A nation field's value whose name the app has not read: one no one in the lists belongs to. */
    unknownNation: "Unknown nation",
    /** The button in the header of a profile that can be edited. */
    edit: "Edit",
    editTitle: "Change this profile's values in the game",
    /** Why editing did not start: the field table or the values could not be read. */
    startFailed: (reason: string) => `Could not start editing: ${reason}`,
    /** The name of a position's field, e.g. "ST rating"; `position` is its entry in `positions`. */
    positionRating: (position: string) => `${position} rating`,
    /** Hover text of a changed input: the value it started from, as shown. */
    was: (value: string) => `was ${value}`,
    /** Hover text of an input that cannot be applied; `min` and `max` are the values it takes, as shown. */
    invalid: (min: number, max: number) => `Enter a whole number from ${min} to ${max}`,
    /** The same for a date input; `from` and `to` are the earliest and the latest date it takes, as dates are shown. */
    invalidDate: (from: string, to: string) => `Enter a date from ${from} to ${to}`,
    /**
     * The same for an amount of money, in whole units of the chosen currency; `from` and `to` are the least and the
     * most it takes, as amounts are shown.
     */
    invalidMoney: (from: string, to: string) => `Enter a whole amount from ${from} to ${to}`,
    /** The same for a percentage, in whole percent; `from` and `to` are the least and the most it takes, as shown. */
    invalidPercentage: (from: string, to: string) => `Enter a whole percentage from ${from} to ${to}`,
    /** After the input of a percentage: the game shows energy and match sharpness as 0–100%. */
    percent: "%",
    /** The two values of a yes-or-no field, as the lists of changes and the hover text of its checkbox say them. */
    yes: "Yes",
    no: "No",
    /**
     * What an input that may be left empty reads as then, in its hint, the hover text and the lists of changes:
     * "Squad number 20 → none". The profile itself shows a dash for it (`profile.none`).
     */
    none: "none",

    // The footer
    footer: "Editing",
    changes: changeCount,
    /** After the number of changes, while some inputs hold values that cannot be applied. */
    invalidCount: (count: number) => `${count} invalid`,
    /** Opens the list of the changes Apply would write. */
    review: "Review",
    reviewList: "Changes to apply",
    /** Puts the inputs back to the values the game has. */
    discard: "Discard",
    apply: "Apply",
    applying: "Applying…",
    /** Hover text of Apply while an input holds a value that cannot be written. */
    applyBlocked: "Fix the invalid values first",
    /** Leaves edit mode. */
    done: "Done",
    /** Takes the place of the buttons when leaving (Done, close, another row) would lose `count` changes. */
    confirmDiscard: (count: number) => `Discard ${changeCount(count)}?`,
    keepEditing: "Keep editing",

    // After Apply
    applied: (count: number) => `Applied ${changeCount(count)}`,
    /** Every value asked for was the game's already. */
    nothingToChange: "Nothing to change: the game already has these values.",
    /** A change the game refused; `label` is the field's name (see `fieldLabel`) and `reason` the game's answer. */
    refused: (label: string, reason: string) => `${label}: ${reason}`,
    rereadFailed: (reason: string) => `Could not read the values back: ${reason}`,
    dismiss: "Dismiss",
  },

  /** The Changes view: what was written to the game this session. */
  changes: {
    /** The entry in the sidebar. */
    nav: "Changes",
    title: "Changes this session",
    hint: "Newest first. A change can be undone only while the game still holds the value it wrote.",
    /** Under the hint: a change shows in the game only after it has moved on once. */
    continueHint: "The game shows a change once it moves on: press Continue in the game.",
    /** Under a move to another club that was a swap: the player who went the other way. */
    swappedWith: (name: string) => `Swapped with ${name}`,
    /** Under a transfer that had a fee: the amount, written out. */
    fee: (amount: string) => `Fee ${amount}`,
    /** What a heal changed, in the place of its values: `count` is how many injuries the player had. */
    healed: (count: number) => (count === 1 ? "Healed 1 injury" : `Healed ${format(count)} injuries`),
    /** The same for lifting bans: `count` is how many bans the player had. */
    lifted: (count: number) => (count === 1 ? "Lifted 1 ban" : `Lifted ${format(count)} bans`),
    /** What keeping a player from retiring changed: the date he was to retire on, or none when only his traits changed. */
    keptPlaying: (date: string | null) => (date === null ? "Will play on" : `Retirement on ${date} prevented`),
    /** The line beside the title; `undone` of the `total` changes were undone. */
    count: (total: number, undone: number) => {
      const count = changeCount(total);
      return undone === 0 ? count : `${count} · ${undone} undone`;
    },
    empty: "No changes yet. Open a player, a member of staff or a club and choose Edit, or use Mass edit in a list.",
    columns: {
      time: "Time",
      /** The player, member of staff or club the change was made to. */
      name: "Name",
      field: "Field",
      change: "Change",
      status: "Status",
    },
    /** The small tag after a name. */
    kinds: { player: "Player", staff: "Staff", club: "Club" } satisfies Record<Entity, string>,
    /** Hover text of a change of an attribute: the values as stored; `change` is from `valueChange`. */
    stored: (change: string) => `stored ${change}`,
    undone: (time: string) => `Undone at ${time}`,
    undo: "Undo",
    /** Hover text of Undo; `label` is the field's name. */
    undoTitle: (label: string) => `Write the old value of ${label} back to the game`,
    /** The small tag after the fields a mass edit changed: a mass edit is one row of the list. */
    batch: "Mass edit",
    /** Under those fields: how many changes the mass edit made, and how many of them are not undone. */
    batchCount: (total: number, remaining: number) =>
      remaining === 0
        ? `${changeCount(total)} · all undone`
        : `${changeCount(total)} · ${format(remaining)} not undone`,
    /** Opens the list of the changes of a mass edit under its row, and closes it again. */
    showChanges: "Show changes",
    hideChanges: "Hide changes",
    /** Undoes the whole mass edit. */
    undoBatch: "Undo mass edit",
    /** Hover text of Undo mass edit; `remaining` is how many of its changes are not undone yet. */
    undoBatchTitle: (remaining: number) =>
      `Write the old values of this mass edit back to the game (${format(remaining)} still in place)`,

    // Pages: the list, and the changes of a mass edit that is open, are shown a page at a time.
    /** The names of the two groups of buttons for assistive technology. */
    pages: "Pages of the list",
    batchPages: "Pages of the changes of this mass edit",
    previous: "Previous",
    next: "Next",
    /** Between the buttons: the rows on show and how many there are, e.g. "101–200 of 450". */
    range: (first: number, last: number, total: number) => `${format(first)}–${format(last)} of ${format(total)}`,
  },

  /** Exporting players to a file: the button in the toolbar of the player list and the dialog it opens. */
  export: {
    button: "Export",
    buttonTitle: "Write the players the list shows to a CSV or JSON file, for a spreadsheet or a script",
    title: "Export players",
    /** What the export covers: everything the list's search and filters select, in its order. */
    scope: (count: number) =>
      count === 0
        ? "No player matches the search and the filters."
        : `${entityCount.player(count)}: what the list's search and filters select, in its order.`,
    formatLabel: "Format",
    formats: {
      csv: "CSV, comma-separated",
      csvSemicolon: "CSV, semicolon-separated",
      json: "JSON",
    } satisfies Record<ExportFormat, string>,
    formatHints: {
      csv: "For most spreadsheets and scripts",
      csvSemicolon: "For Excel where decimals are written with a comma: in Turkish, Spanish or German, say",
      json: "For scripts: the positions, attributes and personality as objects of their own",
    } satisfies Record<ExportFormat, string>,
    contents:
      "Each player's abilities, positions and position ratings, attributes on the 1–20 scale (the hidden ones too), " +
      "personality, reputation, caps, and contract with its clauses, with the in-game date. Money is in pounds, as " +
      "the game keeps it. Nothing in the game changes.",
    export: "Export",
    exporting: "Exporting…",
    /** After the export: what was written, and where. */
    done: (count: number, file: string) => `Exported ${entityCount.player(count)} to ${file}`,
    folder: (folder: string) => `in ${folder}`,
    skipped: (count: number) =>
      `${entityCount.player(count)} changed in the game while ${count === 1 ? "he was" : "they were"} read, and ` +
      `${count === 1 ? "was" : "were"} left out.`,
    open: "Open",
    openTitle: "Open the file in the app your system opens it with",
    show: "Show in folder",
    showTitle: "Show the file in its folder",
    close: "Close",
  },

  /** Mass editing: the button in the toolbar of a list and the dialog it opens. */
  massEdit: {
    /** The button in the toolbar of the player, staff and club lists. */
    button: "Mass edit",
    buttonTitle: "Change values of everything the list shows, with a preview first",
    title: {
      player: "Mass edit players",
      staff: "Mass edit staff",
      club: "Mass edit clubs",
    } satisfies Record<Entity, string>,

    // What it applies to
    /** `total` is the list's: the search and the filters of the list select them. */
    scope: (entity: Entity, total: number) =>
      `The ${entityCount[entity](total)} the list shows now (search and filters)`,
    /** After the scope, when the list shows only the first `shown` rows of its `total`. */
    scopeAll: (shown: number) => `That is every match, not only the first ${format(shown)} rows on screen.`,
    scopeNone: (entity: Entity) =>
      `No ${entityNouns[entity]} match the search and filters, so there is nothing to change.`,
    /** `limit` is the most one mass edit takes. */
    scopeTooMany: (entity: Entity, total: number, limit: number) =>
      `The ${entityCount[entity](total)} the list shows are more than one mass edit takes (${format(limit)}). ` +
      "Narrow the search or the filters first.",
    loadingFields: "Reading the fields…",
    fieldsFailed: (reason: string) => `Could not read the fields: ${reason}`,

    // The fields to change
    /** The groups of the field select, in the order the dialog lists them. */
    groups: {
      ability: "Ability",
      technical: "Technical attributes",
      mental: "Mental attributes",
      physical: "Physical attributes",
      goalkeeping: "Goalkeeping attributes",
      hidden: "Hidden attributes",
      feet: "Feet",
      coaching: "Coaching attributes",
      knowledge: "Knowledge attributes",
      medical: "Medical attributes",
      positions: "Positions",
      personality: "Personality",
      reputation: "Reputation",
      international: "International",
      contract: "Contract",
      facilities: "Facilities",
      finances: "Finances",
      stadium: "Stadium",
      traits: "Traits",
      /** A player's energy, match sharpness and morale: the Medical group of his profile. */
      health: "Medical",
      /** Whatever the other groups do not have, e.g. a player's height. */
      other: "Other",
    },
    fieldsLabel: "Fields to change",
    /** The name of a row of the dialog for assistive technology; `position` counts from 1. */
    row: (position: number) => `Change ${position}`,
    field: "Field",
    operation: "Operation",
    operations: { set: "Set to", add: "Add", scale: "Scale to %" } satisfies Record<MassOperationKind["op"], string>,
    /** The name of the value input, by operation. */
    values: { set: "Value", add: "Amount", scale: "Percent" } satisfies Record<MassOperationKind["op"], string>,
    /** Hover text of the amount of an Add. */
    addTitle: "Added to every value as shown; a negative number takes away",
    /** The same for a percentage: the amount is in percentage points, not a percent of the value (that is Scale). */
    addPointsTitle: "Percentage points added to every value (70% plus 10 is 80%); a negative number takes away",
    /** The hint in an empty value input: what it takes. */
    rangeHint: (min: number, max: number) => `${format(min)}–${format(max)}`,
    /** The same for an amount, which may be negative: up to `max` either way. */
    amountHint: (max: number) => `±${format(max)}`,
    /** After the input of a Scale: the number is a percent of the value the game has now. */
    ofCurrent: "% of current",
    percentTitle: "A percent of the current value: 100 keeps it, 110 raises it by a tenth, 50 halves it",
    /** Hover text of an amount that cannot be applied; `min` and `max` are what it takes. */
    invalidAdd: (min: number, max: number) => `Enter a whole number from ${format(min)} to ${format(max)}`,
    invalidPercent: (min: number, max: number) => `Enter a whole percent from ${min} to ${max}`,
    /** A date cannot be added to or scaled. */
    dateSetOnly: "A date can only be set",
    addField: "Add a field",
    /** Hover text of Add a field when the rows are full; `max` is how many fields one mass edit changes. */
    addFieldFull: (max: number) => `A mass edit changes up to ${max} fields`,
    remove: "Remove this field",
    /** Hover text of Remove on the only row. */
    removeLast: "A mass edit needs at least one field",

    // The preview
    preview: "Preview",
    previewing: "Previewing…",
    /** Beside Preview while it cannot be pressed. */
    previewBlocked: "Fill in every field with a valid value to preview",
    /** "312 changes for 140 of 237 players · 97 already have these values · 12 values left alone". */
    summary: (entity: Entity, preview: MassPreview) =>
      [
        preview.changes === 0
          ? "No changes"
          : `${changeCount(preview.changes)} for ${format(preview.targets - preview.unchanged)} of ` +
            entityCount[entity](preview.targets),
        preview.unchanged > 0 &&
          (preview.unchanged === 1
            ? "1 already has these values"
            : `${format(preview.unchanged)} already have these values`),
        preview.skippedCount > 0 && valuesLeftAlone(preview.skippedCount),
      ]
        .filter(Boolean)
        .join(" · "),
    tableLabel: "Changes the mass edit would make",
    columns: { name: "Name", field: "Field", change: "Change", reason: "Reason" },
    /** Under a table or a list that shows only the first rows; `count` is how many more there are. */
    more: (count: number) => `and ${format(count)} more`,
    /** The line that opens the list of the values left alone. */
    skippedHeading: valuesLeftAlone,
    skippedLabel: "Values the mass edit leaves alone",

    // Apply and undo
    apply: "Apply",
    applying: "Applying…",
    /** Hover text of Apply; `changes` is how many values it writes. */
    applyTitle: (changes: number) => `Write ${changeCount(changes)} to the game`,
    applyFirst: "Preview the mass edit first",
    applyNothing: "The preview has no changes to write",
    /** Nothing changes in the game until Apply. */
    hint: "Nothing changes in the game until you apply.",
    applied: (count: number) => (count === 0 ? "No changes were written" : `Applied ${changeCount(count)}`),
    /** A change the game refused: who, which field (see `fieldLabel`) and the game's answer. */
    failure: (name: string, label: string, reason: string) => `${name} · ${label}: ${reason}`,
    undo: "Undo this mass edit",
    undoing: "Undoing…",
    undoTitle: "Write the old values of this mass edit back to the game",
    undone: (count: number) => (count === 0 ? "Nothing was undone" : `Undid ${changeCount(count)}`),
    /** A change an undo could not take back: `who` names the person and the field, or the change by its number. */
    undoFailure: (who: string, reason: string) => `${who}: ${reason}`,
    changeNumber: (id: number) => `Change ${id}`,
    close: "Close",
  },

  /** Comparing players: the button in a player's profile, the tray under the player list and the dialog. */
  comparison: {
    /** The button in the header of a player's profile. */
    compare: "Compare",
    /** Hover text of that button while the player is not in the comparison, and while they are. */
    add: "Add to comparison",
    remove: "Remove from comparison",
    /** Hover text of the button while the comparison is full and cannot take this player; `max` is its size. */
    full: (max: number) => `A comparison holds up to ${max} players. Remove one to add this player.`,

    // The tray under the player list
    trayLabel: "Players to compare",
    /** The name and hover text of the × on a player's chip. */
    removePlayer: (name: string) => `Remove from comparison: ${name}`,
    clear: "Clear",
    /** The button that opens the dialog; `count` is how many players are picked. */
    open: (count: number) => `Compare (${count})`,

    // The dialog
    title: "Comparison",
    /** Under the title: what the highlight in the table means. */
    hint: "The best value in each row is highlighted: the highest, or the lowest where lower is better.",
    /** What the dialog says when fewer than two players are picked. */
    tooFew: "Add at least two players to compare them.",
    loading: "Loading the players…",
    tableLabel: "Values of the compared players",
    /** Said after the highlighted value of a row, for assistive technology. */
    highest: "highest",
    lowest: "lowest",
    /** The heading of the rows with the positions, height, reputation and contract. */
    profile: "Profile",
    close: "Close",
  },

  /**
   * Moving a player to another club, or swapping him with a player of another club: the button in his profile and the
   * dialog it opens.
   */
  move: {
    /** The button in the header of a player's profile. */
    button: "Transfer",
    buttonTitle: "Transfer this player to another club in the game, for a fee if you like",

    // The dialog
    title: "Transfer",
    /** The club the player is at, and the club he moves to (or, in a swap, goes to). */
    from: "From",
    to: "To",

    // The switch at the top of the dialog: a move to a club, or a swap with one of its players.
    /** Its name for assistive technology. */
    modeLabel: "Transfer or swap",
    modeMove: "Transfer to a club",
    modeSwap: "Swap with a player",

    // Choosing the club
    /** The name of the search box, and of the list of clubs under it, for assistive technology. */
    searchLabel: "Search for the club to transfer to",
    resultsLabel: "Clubs found",
    searching: "Searching clubs…",
    searchFailed: (reason: string) => `Could not search the clubs: ${reason}`,
    /** Under the list when the search found more clubs than it lists; `count` is how many more. */
    more: (count: number) => `and ${format(count)} more; type to narrow the search`,
    /** Takes the place of the search once a club is picked: the button that brings it back. */
    change: "Choose another club",

    // The fee
    feeHeading: "Fee",
    fee: "Transfer fee",
    /** Under the fee input while it can be sent, and while it cannot. */
    feeHint: "Leave it empty for a free transfer",
    /** `max` is the most a fee can be, as amounts are shown. */
    feeInvalid: (max: string) => `Enter a whole amount, from 0 to ${max}`,
    /**
     * What the fee does to the clubs' money, a line each in the plan. `fee` is the amount, `balance` and `budget` a
     * change written out ("£9,492,232 → £10,726,799"); `budget` is null when the club has no transfer budget set.
     */
    pays: (club: string, fee: string, balance: string, budget: string | null) =>
      `${club} pays ${fee}: balance ${balance}${budget === null ? "" : `, transfer budget ${budget}`}`,
    receives: (club: string, fee: string, balance: string) => `${club} receives ${fee}: balance ${balance}`,
    /** For a club outside the leagues being played, which the game keeps no finances for. */
    noFinances: (club: string) => `${club} has no finances in the game: its money stays as it is`,

    // The contract
    /** Under an input that cannot be sent. */
    wageInvalid: "Enter a whole amount, 0 or more",
    expiresInvalid: "Enter a date",

    // What the dialog says about the move itself
    chooseClub: "Choose the club to transfer the player to.",
    fixTerms: "Fix the fee or the contract values first.",
    checking: "Checking the transfer…",
    /** The move can be made; `from` and `to` are the names of the clubs. */
    route: (from: string, to: string) => `${from} → ${to}`,
    doesHeading: "What the transfer does",
    /** What the game does to the player, one line each. */
    does: [
      "Joins the senior team of the new club",
      "Contract dated from the game's date; squad number cleared",
      "Comes off the transfer and loan lists",
      "Wage and contract end change only if you set new ones",
      "The fee comes out of the buying club's balance and transfer budget, and goes into the selling club's balance",
      "Any captaincy at the old club is left empty",
      "The game's transfer history does not list it yet",
      "Listed under Changes, where one undo takes back the transfer and the fee",
    ],

    // Swapping with a player of the club instead: the title, and the section that picks the player (the club is
    // chosen as for a move).
    swapTitle: "Swap with a player",
    /** The player who goes the other way. */
    swapWith: "Swap with",
    /** The name of the search box of the club's players, its hint, and the name of the list under it. */
    playerSearchLabel: "Search for the player to swap with",
    playerSearch: "Search this club's players by name",
    playersLabel: "Players found",
    playersSearching: "Searching players…",
    playersSearchFailed: (reason: string) => `Could not search the players: ${reason}`,
    /** Under the list when it is empty: `query` is what was typed. */
    playersEmpty: (query: string) =>
      query === "" ? "This club has no players." : `No player of this club matches “${query}”.`,
    /** Takes the place of the list once a player is picked: the button that brings it back. */
    changePlayer: "Choose another player",

    // What the dialog says about the swap
    /** A swap has no contract terms to set. */
    swapContract: "Each player keeps their own contract; wages and contract ends do not change.",
    // Moving a member of staff, who has neither a fee nor terms to set, and no swap.
    staffButtonTitle: "Move this member of staff to another club in the game",
    staffChooseClub: "Choose the club to move this member of staff to.",
    staffContract: "Keeps the job, the wage and the contract end; the contract is dated from the game's date.",
    staffDoes: [
      "Joins the new club in the departments they work in (medical, coaching, scouting)",
      "Same job, wage and contract end; the contract is dated from the game's date",
      "A team's manager, whom the team itself points at, is left to the game",
      "Listed under Changes, where it can be undone",
    ],
    swapChooseClub: "Choose the club of the player to swap with.",
    swapChoosePlayer: "Choose the player to swap with.",
    swapChecking: "Checking the swap…",
    /** The swap can be made: who goes where, a line each. `from` is the club of the player, `to` that of the other. */
    swapRoute: (player: string, from: string, to: string, other: string) =>
      `${player}: ${from} → ${to}\n${other}: ${to} → ${from}`,
    swapDoesHeading: "What the swap does",
    swapDoes: [
      "Each joins the senior team of the other's club",
      "Contracts dated from the game's date; squad numbers cleared",
      "Both come off the transfer and loan lists",
      "Any captaincy at their old clubs is left empty",
      "No fees are paid; career history is not updated",
      "Listed under Changes as one change, which undoes both moves",
    ],

    // The foot
    /** Nothing changes in the game until Transfer, or Swap. */
    hint: "Nothing changes in the game until you press Transfer.",
    move: "Transfer",
    moving: "Transferring…",
    cancel: "Cancel",
    swapHint: "Nothing changes in the game until you press Swap.",
    swap: "Swap",
    swapping: "Swapping…",
  },

  /**
   * A player's ties to nations and clubs: their secondary nationalities, and the nations and clubs they were trained
   * in, which decide whether they count as homegrown under a competition's rules. The group in the profile and its
   * dialog.
   */
  ties: {
    heading: "Nationality and homegrown",
    nationalities: "Secondary nationalities",
    trainedInNation: "Trained in nation",
    trainedAtClub: "Trained at club",
    none: "None",
    /** The game's names of its homegrown rules, by code; `rule` names one it has no name for here. */
    rules: {
      1: "Homegrown 15-21",
      2: "Homegrown 0-21",
      5: "Homegrown 15-21 (excluding loans)",
      10: "Homegrown 0-19 (1 year)",
    } as Readonly<Record<number, string>>,
    rule: (code: number) => `Homegrown rule ${format(code)}`,

    // The button under the group, and the dialog it opens
    change: "Change",
    changeTitle: "Change this player's secondary nationalities and homegrown status in the game",
    title: "Nationality and homegrown",
    hint: "Each change is written to the game at once, and listed under Changes, where it can be undone.",
    /** When the player's list has no room for another tie. */
    full:
      "The game made this player's list just big enough for what it holds: a nationality or a training can be " +
      "changed or removed, but not added.",
    /** The control of a row, for assistive technology: `name` is the nation's or club's. */
    nationOf: (name: string) => `Nation instead of ${name}`,
    ruleOf: (name: string) => `Homegrown rule for ${name}`,
    remove: "Remove",
    removeTitle: (name: string) => `Remove ${name}`,
    /** The rows that add a tie, where the list has room. */
    addNationality: "Add a nationality…",
    addNation: "Add a nation…",
    newRule: "Homegrown rule of the new nation",
    add: "Add",
    /** Under the clubs: what the dialog cannot do with them. */
    clubNote: "A club can be given another rule or removed; the game itself adds clubs.",
    working: "Writing to the game…",
    close: "Close",
  },

  /** Changing a contract's bonuses and clauses: the button under them in the profile, and the dialog it opens. */
  clauses: {
    change: "Change",
    changeTitle: "Change this player's bonuses and clauses in the game",
    title: "Bonuses and clauses",
    hint: "Each change is written to the game at once, and listed under Changes, where it can be undone.",
    /** When the contract has no release clause and its list has no room for one. */
    full:
      "The game made this contract's list just big enough for what it holds: a bonus or clause can be changed or " +
      "removed, but a release clause cannot be added.",
    /** The inputs of a row, for assistive technology: `name` is the clause's. */
    amountOf: (name: string) => `Amount of ${name}`,
    conditionOf: (name: string) => `Condition of ${name}`,
    save: "Save",
    remove: "Remove",
    removeTitle: (name: string) => `Remove ${name}`,
    /** The row that adds a release clause, where the list has room and the contract has none. */
    addRelease: "Add a release clause",
    releaseAmount: "Amount of the new release clause",
    add: "Add",
    /** When an amount or condition typed is not a whole number in range: `max` is the most it may be. */
    /** `max` is written out already: an amount as amounts are shown, or a number. */
    outOfRange: (max: string) => `Enter a whole number from 0 to ${max}.`,
    working: "Writing to the game…",
    close: "Close",
  },

  /** Releasing a player from their club, which leaves them a free agent: the button beside Transfer and its dialog. */
  release: {
    /** The button in the header of a player's profile, beside Transfer. */
    button: "Release",
    buttonTitle: "Release this player from their club in the game: they become a free agent",

    // The dialog
    title: "Release",
    /** The club the player leaves. */
    from: "Leaves",
    checking: "Checking the release…",
    /** The player can be released; `club` is the name of their club. */
    ready: (club: string) => `${club} → free agent`,
    doesHeading: "What the release does",
    /** What the game does to the player, one line each. */
    does: [
      "Leaves every team of the club, and the contract ends: a free agent any club can sign",
      "No one is paid anything",
      "Any captaincy at the club is left empty",
      "The game's transfer history does not list it",
      "Listed under Changes, where one undo brings the player back on the same contract",
    ],

    // The foot
    /** Nothing changes in the game until Release. */
    hint: "Nothing changes in the game until you press Release.",
    release: "Release",
    releasing: "Releasing…",
    cancel: "Cancel",
  },

  /**
   * A club's squad: the tab of the club profile that lists the players of each of its teams, with the actions on a
   * whole team and the captains.
   */
  squad: {
    // The switch between the club's teams
    /** The name of the switch for assistive technology. */
    teamsLabel: "Team",
    /**
     * The names of the teams (see `teamLabel` in labels.ts): the first team, a B team, a team with an age limit, and
     * any other, which is named by its place in the club's list (`place` counts from 1, the first team being the
     * first).
     */
    teams: {
      first: "First team",
      b: "B team",
      age: (limit: number) => `U${limit}`,
      other: (place: number) => `Team ${place}`,
    },
    /** When the game lists no team for the club. */
    noTeams: "This club has no teams.",
    loading: "Reading the squad…",
    /** The message under an empty table. */
    empty: "No players in this team.",

    // Above the table
    players: (count: number) => (count === 1 ? "1 player" : `${format(count)} players`),
    /** `age` is written out already, with one decimal. */
    averageAge: (age: string) => `average age ${age}`,
    /** `captain` and `viceCaptain` are names, or `profile.none` for nobody. */
    captains: (captain: string, viceCaptain: string) => `Captain: ${captain} · Vice-captain: ${viceCaptain}`,

    // The actions on the whole team
    /** The name of the group of buttons for assistive technology. */
    actionsLabel: "Actions on the whole team",
    /** `injured` is how many of the team's players have an injury. */
    healAll: (injured: number) => (injured === 0 ? "Heal all" : `Heal all (${format(injured)} injured)`),
    healAllTitle: "Heal every injury of every player in this team",
    /** Hover text of Heal all while nobody in the team is injured. */
    healNone: "Nobody in this team is injured",
    /** `banned` is how many of the team's players have a ban. */
    liftAll: (banned: number) => (banned === 0 ? "Lift bans" : `Lift bans (${format(banned)} banned)`),
    liftAllTitle: "Lift every ban of every player in this team",
    /** Hover text of Lift bans while nobody in the team is banned. */
    liftNone: "Nobody in this team is banned",
    inspireAll: "Inspire all",
    inspireAllTitle: "Set the morale of every player in this team to 20, the highest, and remove their reasons to be unhappy",
    refreshAll: "Refresh all",
    refreshAllTitle: "Set the energy and match sharpness of every player in this team to 100%, and rest them fully (jadedness -500)",
    maxAll: "Max attributes",
    maxAllTitle:
      "Set every attribute of every player in this team to its best: 20, and 1 for injury proneness and dirtiness",
    /** Beside the buttons: whom they cover, and where undoing is. */
    hint: "The actions cover every player in the list, those out on loan too. Undo is in the Changes view as well.",

    // What an action did, under the buttons
    /** `count` is how many values were written. */
    written: (count: number) => `${changeCount(count)} written`,
    /** A change the game refused: `name` is the player's, `reason` the game's answer (it names the value). */
    refused: (name: string, reason: string) => `${name}: ${reason}`,
    /** Takes back what the line beside it says was written. */
    undo: "Undo",
    undoTitle: "Write the old values of these changes back to the game",

    // Captains
    /** The badges after the name of the captain and of the vice-captain; their hover texts are the roles' names. */
    captainShort: "C",
    viceCaptainShort: "VC",
    /** The menu button at the end of a row: its name for assistive technology (`name` is the player's), hover text. */
    menuLabel: (name: string) => `Captaincy of ${name}`,
    menuTitle: "Captaincy",
    makeCaptain: "Make captain",
    makeViceCaptain: "Make vice-captain",
    /** Who holds a role now: said after a change, and in the Changes view under a captaincy that moved the other. */
    nowCaptain: (name: string) => `${name} is now captain`,
    nowViceCaptain: (name: string) => `${name} is now vice-captain`,
    /** The same when there was nobody to take the role the new holder left, so that it stands empty. */
    noCaptain: "Nobody is captain now",
    noViceCaptain: "Nobody is vice-captain now",

    // The table
    /** The table's name for assistive technology; `team` is the name of the team. */
    tableLabel: (team: string) => `Players of ${team}`,
    columns: {
      name: "Name",
      position: "Pos",
      age: "Age",
      currentAbility: "CA",
      potentialAbility: "PA",
      condition: "Energy",
      matchSharpness: "Sharpness",
      jadedness: "Jaded.",
      morale: "Morale",
      /** The last column has no heading but this one, for assistive technology: it holds the captaincy menus. */
      actions: "Captaincy",
    } satisfies Record<SquadSort | "actions", string>,
    /** Hover text of a column header that sorts the table; `by` is a name from `sortNames`. */
    sortBy: (by: string) => `Sort by ${by}`,
    sortNames: {
      name: "name",
      position: "position",
      age: "age",
      currentAbility: "current ability",
      potentialAbility: "potential ability",
      condition: "energy",
      matchSharpness: "match sharpness",
      jadedness: "jadedness",
      morale: "morale",
    } satisfies Record<SquadSort, string>,

    // The tags after a name, with what each means as hover text
    injured: "Injured",
    /** `count` is how many injuries he has. */
    injuredTitle: (count: number) => (count === 1 ? "1 injury" : `${format(count)} injuries`),
    banned: "Banned",
    /** `count` is how many bans he has. */
    bannedTitle: (count: number) => (count === 1 ? "1 ban" : `${format(count)} bans`),
    onLoan: "On loan",
    onLoanTitle: "Out on loan to another club",
    loanee: "Loanee",
    loaneeTitle: "Here on loan from another club",
    elsewhere: "Elsewhere",
    elsewhereTitle: "Plays for another team of the club",
  },

  /** The game, as `describeGame` in `format.ts` names it. */
  game: {
    /** The game's name when its edition is not known: "FM27" otherwise. */
    name: "Football Manager",
    storefronts: {
      gamePass: "Game Pass",
      steam: "Steam",
      epic: "Epic Games",
      unknown: "Unknown store",
    } satisfies Record<Storefront, string>,
    /** Steam's build id of the install, e.g. `"build 26227640`". */
    steamBuild: (id: string) => `build ${id}`,
  },

  errors,
};

/** What a dictionary has to provide. */
export type Strings = typeof en;
