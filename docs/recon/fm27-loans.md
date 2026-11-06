# FM27: loans

Notes behind showing a player's loan and recalling him from it. Read on the Windows Game Pass build (0.9.2409.0), on
a save of 17 September 2026 whose manager runs Manchester United, with the probe (`refs`, `dump`, `loans`).

## The loan contract

A player on loan keeps his contract with his own club (`player+0x330`) and has a second one with the team he is on
loan to, of its own class, `db::LOAN_CONTRACT` (his own is a `db::FULL_CONTRACT`). It is reached through the pointer
right after his contract:

| Where | What |
| --- | --- |
| player `+0x338` | pointer to a record of his other contracts, shifted with the contract for player-coaches |
| record `+0x00` | pointer to the loan contract, null when he is not on loan |
| record `+0x30` | a `db::BASIC_CONTRACT` of a person who is not a player (likely his agent's) |

Only the player points at the record, and only the record points at the loan contract. The loan contract is laid
out as a contract up to the squad number (`[contract]` in `profiles/fm27/layout.toml`):

| Offset | Field | André Onana, Manchester United → Trabzonspor |
| --- | --- | --- |
| `+0x08` | owner: the player's identity block | Onana |
| `+0x10`, `+0x18` | the team he is on loan to | Trabzonspor |
| `+0x20` | `i32` wage, pounds per week | 113,300 (110,000 in his own contract) |
| `+0x44` | from (the contract's `signed`) | 29 June 2026 |
| `+0x48` | until (`expires`) | 30 June 2027 |
| `+0x4C` | joined | 29 June 2026 |
| `+0x54` | squad status there | 2 |
| `+0x5D` | squad number there | 24, as he wears it at Trabzonspor |

The bytes after the squad number (`+0x60` to `+0x100`) hold the loan's own terms; they are not mapped yet. Onana's
read 3,212 twice at `+0xA0` and `+0xA8`, 58,333 twice at `+0xCC`, his wage again at `+0xD4`, and 180 and 270 at
`+0xD8`.

The record is 32 bytes, laid out one after another with the others of its kind, so reading past its end shows the
next player's:

| Offset | What | Records holding one |
| --- | --- | --- |
| `+0x00` | the loan contract (`db::LOAN_CONTRACT`) | 3,598 |
| `+0x08` | a contract with a club's B team (`db::B_CLUB_CONTRACT`) | 2,189 |
| `+0x10` | a basic or full contract (a few player-coaches) | 11 |
| `+0x18` | another contract with a B team | 60 |

When the game ended the loans of Onana and Bayındır, whose records held nothing else, it left them without a record:
null at `+0x338`. Their team (`+0x130`) pointed at Manchester United's again, while `+0x138` kept Trabzonspor's, the
last team they played for.

## Who has one

On the save, 3,596 players had a loan contract, and every one of them passed the editor's checks (class and owner).
5,637 players had the record, so 2,041 have one without a loan. 5,624 players play for a team of another club than
their contract's: 3,594 of them are on loan; nearly all the rest belong to a club's second team, which the game keeps
as a club of its own (such as "VfB Stuttgart II" or "FC Twente/Heracles Academie").

## The terms

Past the fields it shares with a contract, the loan contract keeps the terms the game's Loan Club tab shows. RootTourist
mapped them on the Steam build 26340721 against 17 loans in the English UI (in a comment on PR #101); the layout places
them as `[loan.terms]`:

| Offset | Type | In the game |
| --- | --- | --- |
| `+0xB0` | `u16` flags | bit 0 "Can play against own team", bit 1 "Can play in cup matches", bit 2 "Can be recalled", bit 12 "Loan cannot be terminated"; bits 3, 8, 13 and 15 occur, and the game shows nothing for them |
| `+0xC0` | `i32` pounds | "Optional Future Fee", the option to buy; -1 for none |
| `+0xCC` | `i32` pounds | "Monthly playing fee"; -1 for none |
| `+0xD0` | `i32` pounds | "Unused Monthly Fee"; -1 for none |
| `+0xD4` | `i32` pounds | the wage again, as at `+0x20` (on 351 of 371 loans) |

On the Steam save of 15 August 2027, 113 of 371 loans could not be recalled in the game and 94 could not be
terminated, 71 neither. Anton Kade's, from FC Augsburg to Liverpool, holds flags `0x1002` (cup matches, no recall, not
to be terminated), an option to buy of £23,245,368 and monthly fees of £371,665 (played) and £725,477 (unused). The
profile lists the terms, the recall dialog says what they would not allow in the game, and Make permanent starts its
fee from the option to buy.

## Recalling a player

The editor never ends a loan itself: the game would have to take him out of one team's list and put him in another,
free the loan contract and tell both clubs. It moves the loan's end (`loan.expires`) instead, and lets the game end
the loan, as at the end of any loan.

**The end is the loan's last day.** In the game, André Onana and Altay Bayındır (Manchester United's goalkeepers on
loan at Trabzonspor and Celta) were recalled with their end moved to the day after the game's date: both came back,
two days on. A loan "until 30 June" is one he plays through 30 June, back at his club on 1 July. So a recall makes the
game's date the loan's last day, and the player is back the next day: one day on.

A day the game has finished would never be one again, and a loan whose last day it was might never end, so the editor
writes only the game's date or a later one. While a loan ends on the game's date, the profile says his return is
pending instead of offering the recall; a loan whose end has passed while he is still away gets a warning and the
recall again.

The game's own recall needs "Can be recalled" (see [The terms](#the-terms)). The editor's does not go through it: it
moves the loan's last day, and the game ends the loan when that day is over.

**A loan that ends may become a transfer.** Anton Kade, recalled by the editor on 15 August 2027 (no recall, not to be
terminated, an option to buy of £23,245,368), was not back at FC Augsburg the next day: Liverpool had signed him for his
option. Its balance and transfer budget were both £23,245,368 lower, and he was on a new contract of £105,519 a week
until 30 June 2033, signed that day. So a recall takes the option to buy away too (`loan.option_fee`, written -1),
which its undo writes back with the loan's end, and the recall dialog says so.

## Making a loan permanent

A player on loan is in a list of the team he plays for, at the club he is on loan to, and in a list of his own club:
its senior team's, or for a youngster the youth team's he played for (Mirza Ćatović, on loan from VfB Stuttgart to
Barcelona, is in Stuttgart's under-19s' list and not in its senior team's). Making the loan permanent (`plan_loan_permanent`)
leaves him where he plays, and writes:

1. his own contract: both team pointers to the senior team of the club he stays at, signed and joined on the game's
   date, the wage and end when given, the squad number and squad status his loan contract has there, and off the
   transfer and loan lists;
2. his own club: a captaincy he holds is left empty, and every list that holds him loses him;
3. the loan, let go as the game lets one go: null at `+0x338` when the record holds nothing else, the loan contract's
   slot in the record otherwise. The loan contract and the record are left with nothing pointing at them.

Each write keeps the bytes it found, so one undo puts the loan back. Checked with the probe's `permanent 2000332528
--restore` (9 writes): while made permanent he read as Barcelona's, not on loan, with the squad status of his loan
contract (13), and afterwards as on loan again from Stuttgart until 30 June 2027. Whether the game takes him as
Barcelona's over the next days is to be checked in the game.
