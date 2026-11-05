# FM27: tactics and transfer value

Research for a scouting tab that suggests players for the human manager's tactic. Read on the Windows Steam build
26340721 (save of 15 August 2027, human club AC Monza, UID 1149), against what the game's screens showed.

## Transfer value

A player's transfer value is the `i32` at **`player +0x234`**, in pounds, next to the asking price (`+0x238`, `-1`
when not set). The game shows it in euros, at about 1.166 euros a pound, and as a range when the club's scouts do not
know the player fully: the range starts at the stored value.

| Player | Stored | Game |
| --- | --- | --- |
| Erling Haaland | 226,496,256 | €264M – €287M |
| Arda Güler | 148,461,582 | €173M – €213M |
| Rafael Pinto Pedrosa | 21,647,602 | €25M – €30M |
| Gustavo Varela | 7,428,563 | €8.6M – €11M |
| Ricardo Mangas | 3,562,563 | €2.5M – €5.4M |
| Andrea Colpani | 4,416,109 | €4.1M |
| Dany Mota | 3,367,850 | €3.1M |
| Semuel Pizzignacco | 6,355 | €2.5K – €12K |
| Lionel Messi | 300,000,000 | "Not for Sale" |

300,000,000 marks a player who is not for sale (Messi; Saka and Mbappé read it too). Colpani's and Mota's single
values sit below the conversion (0.80 of it): how the game rounds a fully known value is not worked out.

## Where a club's tactic is

The match engine's selections (`simatch::PREPARED_TACTICS_CREATOR_ARRAY`, see `fm27-transfers.md`) keep a list at
`+0x08` whose entry points at the **tactic block**. When the manager leaves the tactics screen after a change, the
game writes the block, or builds a new one and points the selection at it; until then the tactics screen works on
its own copy, which it frees afterwards. Monza's two selections each pointed at an up-to-date block; a block an
older selection had pointed at stayed in memory with the old roles.

The same block layout holds every club's tactic: the game's ready-made "Positive 4-3-3 DM Wide - Control Possession"
was in memory 39 times with Monza's exact eleven slots.

| Offset | Field |
| --- | --- |
| `+0x000` | 11 records of 16 bytes, one per slot, and a 12th at `+0xB0`: they follow the style template, not the roles (team and player instruction settings, not decoded) |
| `+0x0E0` | 10 bytes of flags that change with the template |
| `+0x100` | `u32` style tag, as text backwards: `CONT` (Control Possession), `TIKI` (Tiki-Taka), `DIRE` (Direct) |
| `+0x148` | 11 in-possession slot entries, `0x48` bytes each (their role masks at `+0x158`, `+0x1A0`, …) |
| `+0x468` | 11 out-of-possession slot entries, `0x48` bytes each (role masks from `+0x478`) |
| `+0x798` | bytes `00 01 … 0a` after `1b`: a one-to-one slot table, probably in-possession to out-of-possession |
| `+0x7D0` | a second copy of the records and entries (its slot entries changed with the first) |

A slot entry: `+0x00` and `+0x08` zero, **`+0x10` `u64` role mask**, `+0x18` a `u64` mask that changes with the
template (not the position), `+0x20` a list `(begin, end, capacity)` of 24-byte items that changes with the role (its
instruction options), `+0x38` `1`. The last slot's entry stops after its role mask. The slots are in the order of
the selection's person ids and of the game's tactic table (goalkeeper first).

### Role masks

Every role mask holds two bits: one of bits 21, 22 and 23, and one other that names the role. The in-possession and
out-of-possession roles are numbered apart. Read on Monza's tactic in three rounds (4-3-3 twice, then 5-2-2-1); the
names are the game's English abbreviations.

In possession (bit / bit 21–23):

| Bit | Role | Bit | Role | Bit | Role | Bit | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 / 21 | CB | 11 / 23 | CFD | 27 / 23 | IF | 46 / 22 | BBP |
| 2 / 22 | FB | 12 / 22 | BGK | 29 / 21 | NCB | 48 / 22 | WCM |
| 3 / 22 | WB | 14 / 21 | ACB | 35 / 21 | HB | 52 / 21 | IFB |
| 4 / 21 | DM | 16 / 22 | BBM | 38 / 23 | AWB | 53 / 21 | NGK |
| 7 / 22 | W | 17 / 23 | AP | 43 / 22 | PW | 54 / 23 | OCB |
| 9 / 23 | AM | 19 / 23 | P | 44 / 21 | IWB | 55 / 22 | PWB |
| 10 / 23 | DLF | 24 / 21 | BCB | 45 / 23 | WFD | 56 / 23 | CHM |

Out of possession:

| Bit | Role | Bit | Role | Bit | Role | Bit | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 / 23 | SK | 9 / 21 | FB | 16 / 21 | DDM | 32 / 23 | OAM |
| 2 / 21 | LHK | 10 / 22 | PFB | 17 / 22 | PDM | 38 / 22 | W |
| 3 / 21 | CB | 11 / 21 | HFB | 20 / 22 | CM | 39 / 21 | TW |
| 4 / 21 | SCB | 12 / 21 | WB | 27 / 23 | PCM | 40 / 23 | IOW |
| 5 / 21 | CCB | 14 / 21 | HWB | 28 / 21 | SCM | 42 / 22 | CFD |
| 6 / 21 | WCB | 15 / 21 | DM | | | 43 / 21 | TCF |
| | | | | | | 44 / 23 | OCF |

The out-of-possession roles run in pitch order (goalkeepers, centre-backs, full-backs, wing-backs, defensive
midfielders, midfielders, attacking midfielders, wingers, forwards), which leaves the gaps for the roles not seen
yet. A role seen in two slots or moved between slots kept its mask (PFB, PCM, TW, OAM, CB).

**On Game Pass** (0.9.2409.0, save of 17 September 2026, human club Manchester United) the block reads the same:
three selections pointed at copies of one Gegenpress block (`GEGE`), whose eleven slots came out as BGK / SK, WB / FB,
BCB / CB, CB / CB, FB / FB, AM / ?, DM / DM, ? / PDM, ? / ?, IF / ?, CFD / CFD with Lammens, Dalot, Yoro, Martínez,
Shaw, Güler, Tielemans, Baleba, Mbeumo, Rashford and Šeško in them. Four masks there are not named yet:
in possession `0x408000` (bit 15 / 22) and `0x2000000400000` (bit 49 / 22), out of possession `0x40400000`
(bit 30 / 22) and `0x800400000` (bit 35 / 22, in two slots).

### Not found yet

- **Positions** (D (R), DM, AM (L) …). They are not an array of codes in the block, in Monza's
  `TACTICS_CREATOR_ARRAY` objects or next to them (searched across 4-3-3 and 5-2-2-1). A role names the line it plays
  in, so a scouting tab can start from the role and the side of the player who holds the slot.
- The roles not yet seen, the meaning of bits 21–23 and of the second mask.

## How it was found

The probe gained `dump --out FILE` (raw bytes) and `pages OUT [--against OLD]`, which hashes every 4 KiB page of the
game's memory (5.4 GB in 2.5 s) and saves the pages that changed. Hashing every five seconds while the manager changed
one role back and forth (in-possession full-back to inverted full-back and back, leaving the screen each time) gave
the moments of the edits, and the ready-made tactic's copies gave the block layout. Each witness round then changed
the roles of one phase, left the screen and read the block.
