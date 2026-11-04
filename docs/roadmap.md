# Roadmap

Each phase ends with something that runs. Release builds of FM27 move data around,
so every phase keeps game-specific addresses in data, not code, and checks them
before trusting them.

## Phase 0: reconnaissance (done)

- [x] Read-only probe: find `fm.exe`, tell Steam / Epic / Game Pass apart, attach,
  list modules, read `game_plugin.dll` headers from memory. Attaching to the Game
  Pass build works without administrator rights.
- [x] Locate the entity arrays (players, staff, clubs) in `game_plugin.dll` by
  scanning for `(begin, end)` pointer pairs and counting element vtables.
- [x] Confirm on the Game Pass build that object layouts match the Steam notes in
  `docs/recon/` (player, staff and club layouts).
- [x] Tauri app shell that builds and shows whether the game is detected.

## Phase 1: memory core (done)

- [x] Build profiles and object layouts as data files in `profiles/`, matched by
  the `game_plugin.dll` fingerprint.
- [x] Automatic calibration: check the profile's arrays, or find them by scanning
  when there is no profile or it does not check out, validated by decoding names.
- [x] Decoders for FM strings, name-table entries and dates.
- [x] First read-only player list in the app: search by name or UID, accents
  ignored.
- [x] Attribute scale and the rest of the player fields in the data model:
  attributes, positions, personality, reputation, caps, contract; player-coaches
  handled.
- [x] Player profile panel in the app.
- [x] Locate the in-game date; ages in the list and the profile.

## Phase 2: data model (done)

- [x] Players: names, ages, attributes, CA/PA, positions, personality, contracts.
- [x] Staff: names, ages, jobs, employers, attributes, personality, contracts,
  including the human manager.
- [x] Clubs: reputation, founding year, facilities, supporters, finances.
- Every field needs two independent confirmations before it becomes writable.

## Phase 3: read-only MVP (done)

- [x] Search and player / staff / club profiles in the app.
- [x] Player filters (position, age, CA/PA, nation, club, free agents, contract
  end) and sortable columns; staff filters (job, unemployed); club filter
  (men's / women's).
- [x] A local release build: `npm run release` in `app/` makes a stand-alone exe
  with its own icon, no installer. The first public release is the maintainer's
  call.

## Phase 4: editing (done)

- [x] Guarded writes, heap only. Editable fields for players are CA/PA,
  attributes, positions, personality, height, reputation and caps. For staff they
  are CA/PA, attributes, personality and reputation.
  - Every write re-checks the target and the field's range, and is read back.
  - Undo works when the game has not changed the value since.
  - The probe has `fields`, `get` and `set`. Each field was written, read back and
    restored live on the test save.
- [x] Editing in the app:
  - an Edit mode in the player and staff profiles that marks changed and
    invalid values;
  - a review of the pending changes;
  - a Changes view that logs every change of the session, with Undo.
- [x] Contracts and clubs, in the probe and the app:
  - player and staff contracts (wage, end date);
  - club reputation, facilities and finances.

  Each record is checked before it is written: a contract must point back at its
  owner, the senior team at its club, and finances must be the full finance record.
- [x] Mass editing with a preview:
  - **Targets:** the players, staff or clubs that the list's search and filters
    select, up to 10,000.
  - **Operations:** set a field, add to it, or change it by a percentage.
  - **Preview:** lists every old → new value and what is left alone.
  - **Apply:** writes exactly the previewed changes, each only while the game still
    holds the previewed value.
  - **Undo:** the whole batch at once, from the Changes view.

## Phase 5: polish and reach (in progress)

- [x] Turkish and English UI:
  - an EN | TR switch in the sidebar;
  - dates and numbers follow the language;
  - the connection and the change log survive the switch.
- [x] Spanish, and flags for the languages:
  - a menu in the masthead, under the flag of the language in use, lists each language with its flag;
  - the system's language is the default where the app has it, English otherwise;
  - the Windows installer offers Spanish too.
- [x] A settings menu under a gear in the masthead, with the language and the currency money is shown in: pounds,
  euros, US dollars, Turkish lira, Brazilian reals, Argentine and Mexican pesos. The game keeps every amount in pounds;
  the app converts at FM27's own rates (its 2025 ones, the last its database holds) and writes the nearest whole pound.
- [x] Pitch position map.
- [x] Pictures from the user's graphics packs:
  - club logos, flags and faces, in the lists and the profiles;
  - read from the packs' `config.xml` mappings in the FM27 graphics folder;
  - initials stand in where a pack has no picture.
- [x] Player comparisons and saved filters:
  - up to four players side by side, with the best value of each row marked;
  - player filters and sort saved under a name.
- [x] The Steam build on Windows (build 26227640), with its own build profile. Every
  release from here on is checked on both Game Pass and Steam.
- [x] The Game Pass update 0.9.2409.0 (November 2026), whose in-game date moved away from the arrays (see the
  [notes on it](recon/fm27-gamepass-0.9.2409.md)).
- [x] The same update on Steam, build 26340721 (27.0.0): its own profile, as on Game Pass (see the
  [notes on it](recon/fm27-steam-26340721.md)). On macOS, new profiles for both halves of the game, whose data stayed
  where the Launch Preview kept it (see the [macOS notes](recon/fm27-steam-macos.md#2700-steam-build-26340721)).
- [x] Safeguards for the next update (see [After an update of the game](DEVELOPING.md#after-an-update-of-the-game)):
  - a version of the game without a build profile is read-only until Edit anyway, with a notice that says so;
  - checks of the layout against the running game before anything is written: what does not check out stays
    read-only, and a date that does not fit the game's contracts is not used, so no age is shown wrong;
  - `fmlibre-probe health` shows what the checks find.
- [x] macOS, the Steam build (see the [macOS notes](recon/fm27-steam-macos.md)):
  - memory access through a task port that the game hands over: a small bridge library,
    which the game loads as it does Steam's overlay, through a launcher that a Steam launch
    option names. System Integrity Protection stays on;
  - the same guarded, heap-only writes as on Windows: a module's data is refused even once
    the game has written to it;
  - the app sets the bridge up and takes it out again, and gives the launch option to
    enter in Steam by hand while Steam runs;
  - a universal bridge and launcher, so that Intel builds of the game load it too;
  - the Mac build's own object layout (`layout-macos.toml`), checked on a save: reads,
    edits, captaincies, swaps and moves;
  - build profiles for both halves of the universal `game_plugin`, with the in-game date
    the Mac build keeps apart;
  - the game's own allocator, with the same size classes as on Windows, so a move can use
    the room a full squad list's block has past its capacity.
- [ ] Epic; possibly Linux/Proton.

## Phase 6: Game Pass completeness (in progress)

- [x] Move a player to another club's senior team, on his contract or new terms,
  with undo. Nothing is allocated in the game, so the new club's squad list must
  have room in its block. Loans and free agents are refused. A player at a human manager's
  club also leaves its team selections (see Transfers in Phase 7).
- [x] Make room in a full squad list: the dialog offers to release one of the club's
  players in the same transfer (the weakest who is neither injured nor a captain, by
  default), who leaves his place in the list to the player who joins; or to make it a
  swap with him. One change, one undo. Growing the list the way the game does is left
  for later.
- [x] The rough edges of what shipped:
  - opening a mass edit asks about unapplied profile edits;
  - the Changes view pages and folds mass edits;
  - a language switch keeps the view, the filters and the open profile;
  - the Rust side's errors appear in Turkish too;
  - faces are checked with a test pack, and `FMLIBRE_GRAPHICS` points the app at
    another graphics folder.
- [x] Check in the game that moved players play for their new club and that the
  following days run normally. Arda Güler was moved to the human manager's club;
  the game ran on for several days and took a work permit application for him
  without trouble.
- [x] More of what FM Live Editor and FMRTE users reach for, as far as data-only
  writes allow:
  - a player's squad number, squad status, and transfer and loan listing;
  - swapping two players between clubs, with undo;
  - healing injuries, with undo; setting energy, match sharpness and morale, one
    player at a time or in a mass edit.
- [x] A squad tab in the club profile, like FM Live Editor's Teams tab:
  - each team's players with their fitness, morale, injuries and loans;
  - captain and vice-captain;
  - heal all, inspire all (morale to 20) and refresh all (energy and match
    sharpness to 100%), each undone as one batch.
- [ ] Next: suspensions ("Unban All"), and the squad status codes past 5 (youth and
  backup roles), once the game's own data names them.
- [ ] Team cohesion and tactical familiarity (FMLE's "Max Cohesion" and "Max
  Tactics"). Set aside: no single stored value matched ten clubs' readings, so they
  look derived (see the Steam notes). The probe's `related`, `nearby` and
  `team-average` searches are there for another try.

## Phase 7: what FMRTE, FM Live Editor and FM27€0 users reach for (in progress)

FMRTE 27, FM Live Editor 27 and FM27€0 (a free editor on sortitoutsi) set what players expect from a live
editor, and FM27€0's comments ask for more. Each item lands with the same guarded writes, a preview where it
changes many at once, and undo.

- Wave 1, what is already mapped or needs no new memory research:
  - [x] Filter the player and staff lists by any attribute (at least, at most) and the player list by the
    transfer and loan lists. The mass edit follows the same filters, as FMRTE's does.
  - [x] Date of birth (age), asking price and nationality, editable. Nationality is a pointer to a nation
    object: only another object of the same class takes its place, and the app offers the nations of the
    people in its lists.
  - [x] One click in a club's squad tab to max out its players' attributes.
  - [x] Freeze a club's money: while the app runs, its balance does not go down.
  - [x] The same for one player ([#70](https://github.com/tozmoz/FMLibreEditor/issues/70)): Max attributes in his
    profile, undone as one batch, and Freeze attributes: while the app runs, what the game takes from an attribute
    is put back and what it adds stays (injury proneness and dirtiness the other way round). A value written in the
    editor, or undone, becomes the one held. His nationality, birth date and height are edited at the top of the
    profile, where the header shows them.
  - [x] What is frozen is remembered per save (`frozen.json` in the app's data folder; a save is its storefront and
    the UIDs of its human managers) and frozen again on connecting, from the values then, with a notice. Only on a
    build with a profile and where the checks pass: after an update of the game the freezes wait, remembered, and
    nothing is written. Players gone from the game are forgotten. A reload after the game loaded another save stops
    holding the old save's freezes and picks up the new one's.
  - [x] Freeze a whole team from its squad tab ([#82](https://github.com/tozmoz/FMLibreEditor/issues/82)): one box for
    the players' attributes and one for their energy and match sharpness, which a player's profile also has for
    him alone. A box is half ticked, with a count, while some of the team are frozen; frozen players are tagged in
    the table. Energy and sharpness are held from what they were, and rise with the player: one frozen at 100%
    stays there. Injuries are not held: healing them the moment they happen needs looking into first.
  - [x] Export the player list ([#71](https://github.com/tozmoz/FMLibreEditor/issues/71)): what its search, filters
    and order select, to CSV (commas, or semicolons for Excel where decimals take a comma; UTF-8 with a byte order
    mark) or JSON, in `Documents\FMLibreEditor\Exports`, named after the in-game date. A row or object per player:
    abilities, positions and position ratings, attributes on the 1–20 scale, personality, reputation, caps, contract
    and clauses, money in pounds, the in-game date on every row. Only reads; the whole Steam save (37,971 players)
    takes under a second. The probe writes the same with `players --export FILE`. Staff and clubs could follow.
  - [x] Updates from inside the app: an installed Windows copy downloads the new installer, checks its signature
    (Tauri's updater, the key in the repository's secrets) and runs it, then opens again; the release workflow
    signs the installer and writes `latest.json`. Portable copies keep the Download link.
  - [x] The same for the macOS app: the notarized app in a signed `.tar.gz` takes the place of the running one's
    bundle, and the app opens again; at startup the installed bridge and launcher become the ones it came with.
    Max and Freeze attributes, the frozen file, Export and editing in place were checked on the Mac Steam build.
  - Checked on the Mac Steam build and on the Windows Steam and Game Pass builds: the filters on a real save,
    and each new field written, read back and restored. Next: freezing money through a game day.
- Asked for in the issues, on SortItOutSI and on Reddit:
  - [x] A player's name in a club's squad tab opens his profile in the player list. The club keeps its squad tab
    meanwhile, so the Clubs tab leads back to it.
  - [x] Men or women in the player and staff lists: a flag in the person's identity block, set for women (see the
    [macOS notes](recon/fm27-steam-macos.md#men-and-women)). On the Mac Steam build and both Windows builds; the
    lists offer the choice only where the layout places the flag.
  - [x] The staff list filters as the player list does
    ([#80](https://github.com/tozmoz/FMLibreEditor/issues/80)): age, current and potential ability, nation, club,
    contract end and men or women, besides the job, the unemployed and the attributes, behind the same Filters
    button. The mass edit follows them. As in the player list, they can be saved under a name, with the sort a
    column header was clicked for (name, age, club, nation, CA or PA).
- Transfers, which users asked for next:
  - [x] A move with a fee: the buying club pays it out of its balance and transfer budget, the selling
    club's balance takes it, and one undo takes back the move and the fee (the money by what it changed, as
    the game moves money on every day). Checked on the Mac Steam build and both Windows builds.
  - [x] Players out of a club a human manager runs: a move, a release or a swap also empties the player's
    places in the club's team selections, as the game does when he leaves, so that its tactics screen shows
    "None" there; an undo puts him back in each one nothing has changed since. The match engine keeps them by
    the game's person id in several copies, found by their class in a few seconds (see the
    [transfer notes](recon/fm27-transfers.md#a-club-a-human-manager-runs)). Checked on the Mac Steam build: Declan
    Rice, Arsenal's captain and a regular starter, moved to Ipswich; the next match and the days after it went as
    usual. On Windows the class is found from MSVC's descriptors and the threads' stacks are left out; checked
    on the Game Pass build with Bruno Fernandes, Manchester United's captain, moved to Juventus and back, and on
    the Steam build with a player of a club whose new manager had no selection yet.
  - [ ] The transfer in the game's history. When the game makes a transfer it writes events (date, fee,
    player, clubs) into a stream that nothing points at one by one: see the
    [transfer notes](recon/fm27-transfers.md).
  - [ ] Transfers agreed for a later date.
- Wave 2, new memory research:
  - [x] Traits (preferred moves): a `u64` bitmask at player `+0x348`, bit n the n-th of FMRTE's list read row by
    row; checked against Messi, Olise, Gvardiol, Kane and Güler. The profile lists them and edits each as a checkbox;
    the mass edit has them as a group. 62 are named; bits 62 and 63 by number. On the Mac at `+0x308`, where Messi
    reads the same bits.
  - [x] Prevent retirement. The game's retirement manager (`RETIREMENT_MANAGER`, from a static each build profile
    places) lists the retirements it has planned twice: pointers to 24-byte entries (the person's id, which a player
    keeps at `+0x290`, and the date he retires at `+0x0C`) and an index of them by person id. The profile shows the
    date; "Prevent retirement" takes his entry out of both and gives him the trait "Will play football as long as
    possible" in place of "Will retire at top", one change Changes undoes. Matched against FMRTE's list (Ronaldo,
    Wass, Aspas, Kobayashi, Billy Sharp, Hugo Broos) on the Game Pass build. On Steam the static is 0xDAC0 before
    the players pair, not 0xED60 as on Game Pass, so each Windows build profile places it too. A second list of the manager (5 entries, flag 4, short windows) looks like international
    retirements and is left alone. Checked in the game over three days (6 to 9 September): Meshal Al-Ajmi, kept,
    still played and was not planned again; Cristian Tello and Adel Taarabt, planned for 7 and 8 September, retired
    and left both lists. As the game shifts the lists that way, an undo after a Continue puts the entry back in date
    order, and into the index by id, instead of writing back the bytes it found. Clause edits (#57) held over the
    same days, as FMRTE showed them. On the Mac the manager is laid out alike, but its static is a variable of its
    own, which the build profiles place: read on the arm64 half (Ronaldo, Wass, Aspas kept and restored), found in
    the file for the Intel half (see the [macOS notes](recon/fm27-steam-macos.md)).
  - [x] Move a member of staff to another club, keeping the job and the contract, and change a job. A club
    keeps its staff in three department lists (medical, coaching, scouting); a move takes them out of the
    old club's and into the new club's, and a new job moves them between departments. Staff whom the club or
    a team points at directly, such as a team's manager, are left to the game, and a full list is refused.
    Checked on the Mac Steam build and both Windows builds, each change restored.
  - [x] Release a player on a free: he leaves his club's lists, and his team and contract pointers are
    cleared, as the game's own free agents have them. A captaincy he held is left empty; so is one a player
    gives up by moving. Checked on the Mac Steam build and both Windows builds, restored.
  - [x] Contract bonuses and release clauses: read, edited and removed, and a release clause added where the list
    has room (see the contract extras below).
  - [x] Suspensions: lift a player's bans, or all of a squad's. A player's bans are listed in the record his
    injuries hang off, with his other absences; lifting takes them out of that list and keeps the others, as
    healing does with injuries. Checked on the Mac Steam build and both Windows builds, restored: see the
    [ban notes](recon/fm27-bans.md).
  - [x] Secondary nationalities and homegrown status: the nations and clubs a player was trained in, under the
    rule each meets (15-21, 0-21, ...). They are entries of the person's list of relations; the editor changes,
    removes and, where the list has room, adds them. Checked on the Mac Steam build against the game's eligibility
    page, and on both Windows builds: see the [nationality notes](recon/fm27-nationality.md).
  - [ ] Place of birth: a pointer to a city record (`+0x2C8` on macOS), whose nation the game shows.
  - [ ] Appearance. FM27 keeps a person's looks as dozens of 3D face values for the match engine
    (`MATCH_PERSON_APPEARANCE_INPUT`: skin tone, hair and eye colours, face shape); set aside.
  - [x] Stadium capacity: a club's senior team points at its stadium (`db::STADIUM`, team `+0x78`), whose capacity,
    seats, capacity in use and expansion ceiling the club profile shows and edits. Checked on the Windows Game Pass
    build (Old Trafford 74,879; the Emirates 60,704) and on the Mac Steam build, where stadiums are laid out alike.
  - [ ] Sponsors, ticket prices and league prize money (`sicomps::PRIZE_MONEY_PROVIDER`).
  - [x] Jadedness: how worn out a player is by playing, which rest takes away (an `i16` at player `+0x25A`,
    -500 when rested). Found from the numbers FMRTE shows for three players, read without editing in FMRTE;
    shown in the profile and the squad tab, editable, and a team's Refresh rests it to -500. Checked on the
    Windows Game Pass build, and on the Mac Steam build at `+0x252` (all players from -500 to 643).
- Wave 3, what the others find hard:
  - [x] Clear a player's unhappiness, not only his morale. His happiness and his happiness with his playing time,
    as FMRTE shows them, are signed bytes of his contract (`+0x5A`, `+0x5C`): the app edits them (below). An earlier
    search missed them because the probe took the eight bytes around them for a pointer; it now checks that a
    pointer points into readable memory. His reasons to be unhappy (FMRTE's "Unhappiness") are a record his contract
    points at (`+0x30`: a count, then pointers to 28-byte entries); "Remove all" in his profile and the squad tab's
    Inspire set the count to none, which an undo puts back. Three motives are named so far. The contract is laid out
    alike on the Mac, where these and the extras below were read and written too.
  - [x] Contract extras: the loyalty bonus (`+0x38`), happiness and playing time happiness, editable, and the list of
    clauses and bonuses (`+0x68`: amount, condition and kind), shown by name. Kinds named against FMRTE's contract
    page for Kane, Haaland, Alex Scott, Courtois and Olise.
  - [x] Edit the clauses and bonuses: an entry's amount or condition (a condition only for the kinds whose meaning is
    known: goals, assists, international matches, years, a percentage), take an entry out, and add a release clause
    to a contract without one. The editor allocates nothing, so a release clause goes only where the list's capacity
    has room: 384 of 53,356 contracts on the Game Pass save. Checked there with Kane, Mbappé and Bisseck, restored.
    The competition bonuses (`+0x80`) are not named or edited yet.
  - [x] Keep a player from retiring (see Wave 2 above).
  - [ ] Team cohesion and tactical familiarity (see Phase 6).
  - [ ] Epic.
