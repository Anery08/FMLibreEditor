# FM27: how the game records transfers

Notes towards a transfer with a fee that shows in the game's history. They were read from
the Mac Steam build, on a save in July 2026 ("Tyrone Demarcus - Arsenal"), with the probe
(`refs`, `find --as u32`, `holders`, `dump`, `column`). They are a start; nothing is written
yet.

## A person's internal ID

The identity block of a person, which contracts and captaincies point at (`object+0x388` on
macOS), holds after its class pointer:

| Offset | Field | Viktor Gyökeres |
| --- | --- | --- |
| `+0x08` | `u32` internal person ID | 23637 |
| `+0x0C` | `u32` UID | 93070271 |

Internal IDs are not indexes into the players array (index 23637 is someone else).

## The transfer history

The game keeps one list of transfers for the whole game: 48-byte records, laid out one after
another and sorted by the person's internal ID. A transfer made in this save sits among the
ones from the database. Anel Ahmedhodžić's move from Sheffield United to Burnley on
13 July 2026 is the record just before Gyökeres'.

| Offset | Field | Gyökeres, Sporting → Arsenal |
| --- | --- | --- |
| `+0x00` | buying club (club object) | Arsenal |
| `+0x08` | selling club (club object) | Sporting CP |
| `+0x10` | date | 2025-07-26, the contract's `joined` |
| `+0x14` | a second date, unset (1 January 1900) here | |
| `+0x18` | `u32`, an amount | 833,333 |
| `+0x1C` | `u32` internal person ID | 23637 |
| `+0x20` | `u32` flags | `0x250C` |
| `+0x24` | zero | |

- The amounts of neighbouring records are 107,378, 208,333, 833,333 and 2,083,333. The last
  three are 2.5, 10 and 25 million over 12, and every flags word ends in `0x0C`, which is 12.
- The amount is not the fee. The game shows £54M for Gyökeres' move and £6M for Anel
  Ahmedhodžić's (Sheffield United → Burnley, 13 July 2026, the record before his), against
  833,333 and 107,378: no one factor turns both into their fee.
- £54M occurs as a plain `u32` only in a library constant and in what looks like a contract's
  clauses (next to 60M, 20M and 1.5M). Near every place 26 July 2025 occurs, no plain fee in
  pounds or thousands shows up.
- So these records may be something other than the history the game shows: pending add-ons
  or instalments between clubs (payer, payee, from when, a monthly amount, the person, and a
  count of months), say. Where the shown fee lives is still open.
- An array of pointers to the records, one per record, sits elsewhere (`0x7629dac3e0` on this
  save): the list is reached through it.

The player object also holds his previous club (`+0x350`: Sporting) and dates around it
(`+0x360` on: 26 July 2025).

## Watching a transfer the game made

The maintainer bought Luke Bell (UID 2000039902, internal ID 24941), a Coventry City
goalkeeper, for £1.2M, a fee easy to find in memory. Memory was read with the deal agreed
but not yet accepted, then again once Accept and Continue had made the move (25 July 2026).

**While agreed.** The deal is held in objects that name the player's identity block, the
buying team (Arsenal's, twice), the selling team and the fee as a `u32` in pounds.
A list of 32-byte entries also holds Coventry, the date, the person's ID and the fee, as a
`u64` in pounds.

**Once made.** The game writes events of its own into a game-wide stream of mixed records:
small objects of several classes, laid out one after another, which nothing points at one by
one. Three were new:

| Class (`game_plugin+`) | Fields after the class pointer |
| --- | --- |
| `0x559FFB8`, 64 bytes | `+0x08` date, `+0x10` fee in pounds, `+0x18` the player's identity block, `+0x20` a pointer, `+0x28` buying club, `+0x30` selling club |
| `0x55A0020` | date, fee, the player, the selling club (Coventry's sale) |
| `0x55A0088` | date, fee, the player, the buying club (Arsenal's purchase) |

- The date is 8 bytes: a sequence byte, then the `u16` day of the year with flags (`0x44CE`
  is day 206 of 2026, 25 July), then the `u16` year.
- The stream holds 2,748 events of the first class, all from transfers made in this save. The
  database's own transfers, such as Gyökeres', are not among them; they are kept elsewhere.
- No `(begin, end)` pair covers the stream, and no pointer leads to an event. To add one, the
  game's write position and the room after it have to be found first. This is the riskiest
  kind of write: a mistake would break the save's history.

## Free agents, and releasing a player

The game's own free agents have a null team (`+0x128` on macOS) and a null contract pointer
(`+0x2F0`). Nothing else ties them to a club: no game-wide list of free agents was found.

The player object keeps the club he left last at `+0x350`, and the day he left it at `+0x364`
(the `u16` day of the year, then the `u16` year):

| Player | `+0x350` | `+0x364` | `+0x368` |
| --- | --- | --- | --- |
| Viktor Gyökeres, at Arsenal | Sporting CP | 26 July 2025 | 24 July 2026 |
| Yassine Bounou, free agent | his last club | 19 July 2026 | 19 July 2026 |
| Riyad Mahrez, free agent | his last club | 30 June 2026 | 30 June 2026 |
| Francesco Acerbi, free agent | his last club | 1 June 2026 | his birth date |

What else points at a player was read for Maximilian Arnold, Wolfsburg's captain (`refs` over
his object):
- his team's list of players, and the team's captain pointer (`team+0x88`);
- his contract (`contract+0x08`, the owner);
- lists of identity blocks that hold players of many clubs, and free agents too: not the
  club's;
- small records with his identity and Wolfsburg's senior team, likely his history there, and
  records of other clubs' interest in him.

The editor's release (`plan_release`) takes him out of every list of his club's teams that
holds him and empties a captaincy he holds, then clears his team and contract pointers, in that
order: nothing reaches him through his club once the pointers are cleared. The contract is
left as it was, since only the player points at it. A move also empties the captaincies the
player leaves. The release does not set `+0x350` or the dates, so the game still names the
club before as his last one; that belongs with the transfer history.

Checked on the Mac Steam build with `release --restore`: while released, Wolfsburg had no
captain and one player fewer, and both came back.

## A club a human manager runs

Read on the Mac Steam build (27.0.0, arm64), on the Arsenal save in January 2027, with the probe and a scratch tool
that names the class of whatever points at a player (the nearest vtable before the pointer, and the `(begin, end)`
lists that hold it).

**What points at a player there.** Gabriel, a regular starter, had about 250 pointers into his object; Micky van de
Ven, a starter at Tottenham, 22. The extra ones:

- about 160 objects of the assistant's advice (`backroom_advice_*::*_ADVICE_SUGGESTION`): the assistant's identity
  block at `+0x08`, the player's at `+0x10`;
- inbox items, team meeting records and match records, which players who have left keep too;
- a list of 16-byte entries (an identity block, then flags) at `+0x100` of `CLUB_HUMAN_MANAGER_DETAILS`, which held
  nine players;
- `TRAINING_EDIT_SESSION+0xc8`, the senior players at the club. It is the training screen's: once the manager went
  to another screen, its memory held something else.

**What the game does when a player leaves.** The manager put Remy Mitchell in goal and released him (both in the
game, then reloaded without saving). From one game day to the next, the game:

- took him out of the senior team's list, the later players moving up one;
- freed his contract, whose block another player's contract took at once;
- set his last club (`+0x350`) and the day he left (`+0x364`);
- emptied his slot in the team selection (below), which the tactics screen then showed as "None" in goal.

It left the advice objects and the manager's details pointing at him.

**The team selections.** The match engine keeps what the manager picked, for each tactic, as objects of
`simatch::PREPARED_TACTICS_CREATOR_ARRAY`:

| Offset | Field |
| --- | --- |
| `+0x00` | vtable |
| `+0x08` | a list `(begin, end, capacity)` |
| `+0x20` | flags: their low 16 bits read `0xff01` in the manager's, `0xff00` in other clubs' |
| `+0x28` | 26 `u32` slots of the game's person ids (a player's identity block `+0x08`): the eleven in the order of the formation's positions, then the substitutes; `0xFFFFFFFF` is empty |

- The save had 38 such objects. Three held the manager's current selection. The game emptied Mitchell's slot in one
  of them and left him in the other two.
- When the manager moved Kepa from the bench into goal, all three changed: the goal slot got Kepa's id, the first
  substitute's slot `0xFFFFFFFF`. Other copies were made for the screen and on a thread's stack.
- Nothing else in an object holds person ids: the set pieces are not among them.
- One object read 0 for the list's begin and had no player in its slots, as a block the allocator has taken back. All
  the others held a sound list.

**What the editor does.** A move, release or swap out of such a club first empties the player's slot in every copy
that holds him and whose filled slots are mostly players of the club's teams. A national team's selection, which
holds him among players of other clubs, is left alone. It finds the copies by their class, in one pass over the
game's memory: 3 to 4 seconds in a release build. It leaves the stacks out, and any object without a sound list. An
undo writes a copy's slots back only while they are what the move left there.

Checked on that save:

- Ezri Konsa was moved to Ipswich and held there for five minutes. The tactics screen showed "None" in his place, and
  he was not in the squad. He came back to all nine copies that had held him, with his squad number.
- Declan Rice, Arsenal's captain and a starter, was moved to Ipswich from the app. The next match and the following
  days went as usual. No copy held him afterwards, and Arsenal's captaincy stayed empty for the manager to fill.

**On Windows.** The editor reads only the Itanium type info of the Mac build, so on Windows it does not find the
class, and still refuses to move a player out of a club a human manager runs. The probe already finds vtables there
from MSVC's type descriptors (`class_vtables`); the layout of the objects is to be checked.

## Still to find

- Where the game keeps the fee it shows in a player's transfer history. The surest way: watch
  memory while the game makes a transfer itself, before and after the day it goes through.
- What the amount and the flags of the 48-byte records mean.
- Who owns the records and the pointer array, and their capacities. Adding a transfer means
  inserting a record in person order without allocating.
- Where the transfer events' stream keeps its write position and its room.
- Where agreed future transfers are kept: the agreed-deal objects above are a start.
