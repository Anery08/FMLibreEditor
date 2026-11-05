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

## Who has one

On the save, 3,596 players had a loan contract, and every one of them passed the editor's checks (class and owner).
5,637 players had the record, so 2,041 have one without a loan. 5,624 players play for a team of another club than
their contract's: 3,594 of them are on loan; nearly all the rest belong to a club's second team, which the game keeps
as a club of its own (such as "VfB Stuttgart II" or "FC Twente/Heracles Academie").

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
