# FM27 Game Pass build 0.9.2409.0

Observed on 2 November 2026, right after the Xbox app installed this update. The package is
`SportsInteractive.FootballManager27_0.9.2409.0_x64__5w3tn6tb6stnm`, run from
`D:\Games\Football Manager 27\Content\`. The test save was on 9 September 2026, with 59,287 players, 29,512 staff
and 31,233 clubs.

In the app, the update showed up as a missing in-game date. With no date there were no ages, so the age column and
the profiles' ages were blank. Planned retirements were hidden too, because nothing placed the retirement manager.
Everything else read as before. `profiles/fm27/gamepass-0.9.2409.0.toml` now places all three.

## The binary

`game_plugin.dll` as mapped in memory:

| | 0.9.2409.0 | 0.9.2355.0 |
|---|---|---|
| Size of image | `0x175DA000` | `0x19436000` |
| Link timestamp | `0x6AE563A1` (31 October 2026) | `0x6ADFB161` (26 October 2026) |

The protector has renamed and reordered the sections again:
- the entity arrays' pairs, the in-game date and the classes' type descriptors are in `.00cfg` (read-write, 1 MiB at
  `0x55E9000`);
- the vtables are in `.trace` (read-only);
- the large read-write-execute section is `.rsrc` (282 MiB).

None of these names can be relied on from one build to the next.

## What moved

- **Entity arrays:** 0x2000 further than in 0.9.2355.0:
  - players at `0x5683DC0`;
  - staff at `0x5683E08`;
  - clubs at `0x5683F78`.

  With no profile, `calibrate` found them by scanning, and every sampled element decoded.
- **Retirement manager:** the static pointer is at `0x5675060`, still 0xED60 before the players pair. It is the only
  pointer to the one `RETIREMENT_MANAGER` object, which `instances` finds by its type name.
- **In-game date:** the date that sits with the arrays (`+0x848` from the players pair) read `01 00 6C 07` with the
  save loaded. That is day 1 of 1900, an unset date, so the reader gave no date at all.
  - The date is now a variable of its own, at `0x56257C8`. It reads `FC 3A EA 07`: day 252 of 2026 (the low 9 bits of
    `0x3AFC`), which is 9 September 2026. The game's UI held the text "9th September 2026" at the same time.
  - In the plugin's writable sections outside `.rsrc`, the only other date in 2026 is the database's timestamp. It
    sits at `+0x638` from the players pair (14 October 2026), as in 0.9.2355.0.
  - The arm64 Mac build keeps its date the same way (see the [macOS notes](fm27-steam-macos.md)). There, the field
    with the arrays stayed unset after a save was loaded, even once the game had moved on a day, while the variable
    followed the game. That was not watched over a day on this build.

## Unchanged

`profiles/fm27/layout.toml` holds unchanged. With `fields --stats`, every player, staff and club field read in its
range across all objects. The exceptions are the ones known before: youth facilities of 255 ("not set") at a few
hundred clubs, and one member of staff's contract end. These were read as on 0.9.2355.0:

- **Lionel Messi:** born 24 June 1987 (39 on the save's date), 207 caps and 125 goals, 18 and 14 for the U21s. His
  contract pays £404,321 a week from 1 December 2025 to 31 December 2028, with squad number 10.
- **Manchester United:** Bruno Fernandes captain and Lisandro Martínez vice-captain. Their list of 29 players includes
  André Onana and Altay Bayındır, both out on loan.
- **Tottenham Hotspur:** Micky van de Ven and Pedro Porro as captains, with live values that vary from player to
  player. Dejan Kulusevski, Xavi Simons and Wilson Odobert are injured.
- **Records reached from a player:**
  - Elliot Watt's ban, 4 matches from 29 June 2026;
  - Kenan Yıldız's six ties;
  - Kylian Mbappé's clauses, including his release clause of £859,031,872;
  - the reasons to be unhappy of 1,265 players;
  - once the manager was placed, 25 planned retirements, among them Cristiano Ronaldo on 30 June 2027 and Daniel
    Wass on 1 July 2027.

## Lists are full after a load

`squads` found no team list with room past its length: 0 of 5,931 non-empty lists. The save had been loaded, not
started in the running game. Clause and tie lists are the same, so no contract had room for a release clause and Achraf
Hakimi had no room for another tie. The editor refuses those additions, as it should. On 0.9.2355.0 the game had been
running since the new game was started, and 384 contracts had room.

The allocator's size classes are unchanged. The 1,429 lists of 19 to 64 pointers sit in the blocks `layout.toml`
names, and the rest of each block is zero. So moves, which use the room in the block past a list's capacity, still
work.

## The app

The release build was run against this save and driven over CDP. Every change was undone.
- **Connecting:** it connected with the new profile. The connection line read "FM27 · Game Pass 0.9.2409.0", and
  the masthead read "9 Sept 2026" ("9 Eyl 2026" in Turkish).
- **Ages:** Messi was 39 in the players list and in his profile.
- **Retirements:** Cristiano Ronaldo's retirement on 30 June 2027 was prevented with the profile's button and undone.
- **The standard release checks:**
  - edits;
  - mass edits;
  - a transfer, and a swap through the dialog;
  - healing (Dejan Kulusevski), live values and contract fields;
  - captains and the Squad tab's heal, inspire and refresh.
- **The features since the Mac work:**
  - filters and max attributes;
  - frozen money and a transfer fee;
  - staff moves and jobs, and releasing a player;
  - lifting one player's bans and a team's (Borussia Dortmund);
  - changing and removing ties.
- **The rest:** stadiums, the contract's extras, unhappiness, traits, jadedness, planned retirements, and changing
  or removing clauses.

Some witnesses from September no longer held, because the save had moved on and been loaded since. The checks used
other witnesses instead:
- Elliot Watt has served one of his two bans;
- the jadedness FMRTE showed in July has changed;
- Fulham have nobody banned;
- every list is full, as above.
