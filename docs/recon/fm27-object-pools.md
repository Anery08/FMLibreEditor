# FM27: the game's pools of objects, and signing a free agent

How the game keeps its contracts, and how the editor makes one for a free agent it signs. Read on the Windows Game
Pass build 0.9.2409.0, on a save of August 2027 played on for a few days (see `crates/fmlibre-core/src/object_pool.rs`
and `signing.rs`, the probe's `pools`, `instances --fields` and `move`).

## Free agents

A free agent has no team and no contract: both pointers of his player object are null (`+0x130`, `+0x330`), as the
editor leaves a player it releases. Nothing else points at him but the game's list of players: no list of free agents
was found. To sign one, the editor needs a contract for him, which the game keeps as an object of its own.

## The pools

The game keeps the objects of many of its classes in pools, statics of `game_plugin.dll`'s writable data. From where a
pool keeps the list of its chunks (`[pool]` in `layout.toml`):

| Offset | What |
|---|---|
| `+0x00` | the list `(begin, end, capacity)` of pointers to its chunks |
| `+0x18` | the first free slot, null when none is free; the first 8 bytes of each free slot point at the next, the last's at nothing |
| `+0x20` | `u32` slots free, then `u32` slots used |
| `+0x28` | `u32` bytes per slot, then `u32` slots of the first chunk |
| `+0x30` | `u32` slots of each later chunk, then `u32` 100 |

The first chunk is as large as the save loaded needed; each later one has a fixed number of slots (16 to 1,024). Before
`+0x00`, the contracts' pool and the one after it hold a code with its top bit set, a pointer and 0x1000.

**The scan.** Every 8-byte place of the plugin's writable data, but its large writable and executable section, read as
a pool: a list of 1 to 4,096 chunks, slots of 8 bytes to 1 MiB, free and used slots that add up to the chunks' slots, and
a first free slot just when some are free. That found 279 pools in 0.01 s. For each, the chain of free slots was
followed from the first: in all 279 it ran through exactly as many slots as the pool counts free, each a slot of one of
its chunks, and ended on null. Among them, by the class of the objects in their first chunk:

| Slot | Class | Slots | Free | Used |
|---|---|---|---|---|
| 200 | `db::FULL_CONTRACT` | 12,810 + 1,024 | 1,010 | 12,824 |
| 256 | `db::LOAN_CONTRACT` | 2 chunks, 183 | 121 | 62 |
| 104 | `db::B_CLUB_CONTRACT` | 71 | 0 | 71 |
| 40 | `db::BASIC_CONTRACT` | 1,577 | 0 | 1,577 |
| 32 | `db::FAILED_CONTRACT_NEGOTIATION_INFO` | 2 chunks, 291 | 123 | 168 |

Pools take slots back: the loan contracts' had 121 free, of loans that ended.

## The contracts' pool

At `game_plugin.dll+0x5672020` on this build (found by the scan each time; the place is not in the build profiles).
12,824 slots were used, as many as memory held `db::FULL_CONTRACT` objects (`instances`). The first chunk held 12,810 of
them one after another with no gap, the second the other 14 in its first 14 slots, and its 15th slot was the first
free one, each free slot pointing at the next. So the game had made 14 contracts since the load and let go of none.

What the 12,824 contracts hold, by 8-byte place (`instances db::FULL_CONTRACT --fields --span 0xd0`): `+0x08` (owner),
`+0x10` and `+0x18` (teams) always point into the heap; `+0x30` (unhappiness) does in 1,063; the clauses' list
(`+0x68`) is empty in 2,285, the competition bonuses' (`+0x80`) in 12,237; `+0x28` is zero in 11,392, small numbers in
1,273 and a pointer in 159; `+0x98` points somewhere in 204 and `+0xA0` in 43. The slot after the last contract of the
first chunk read 0, and the one after the 14th of the second pointed at the next slot.

Squad lists are not in pools. Arsenal's 25 player pointers sat in 200 bytes with another block right after them, as
the save laid them out when it was loaded; no pool's chunks held them.

## Signing

`Session::plan_signing` works out, and `apply_club_move` writes:
1. the pool: its first free slot becomes the next one, one slot fewer free and one more used, in one write of 16 bytes
   (`Process::write_static`, which writes only a module's writable data, and only at the statics of a pool the editor
   found);
2. the slot: a copy of the contract of the player of the club's senior team, under a plain contract with it, whose
   current ability is nearest the free agent's, among those whose squad status fits him: a goalkeeper's (15, 16, 17,
   20, 21) for a goalkeeper and an outfield player's otherwise (1 to 5, 7, 9), and for one of 21 or more no youngster's
   status (10, 11, 13) and no youth contract. With none fitting, the nearest of all, as Squad Player (Backup for a
   goalkeeper). The copy is his: owner, both teams the senior team, job 1, signed and joined on the game's date (the
   dates keep their flags), the end date given or 30 June at the end of next season, the wage given or the other's,
   no loyalty bonus, no squad number, off the transfer and loan lists, no unhappiness record, no clauses or
   competition bonuses, and zero at `+0x28`, `+0x98` and `+0xA0` (`cleared` in `layout.toml`). Its kind of contract,
   squad status and happiness are the other's;
3. the senior team's list: the player in its first free slot, or, when its block is full (as every one is after a
   load), a list grown into memory the editor takes, with room for three more (see `own_memory.rs`);
4. the player: his contract and his team.

The undo writes it all back: the player a free agent, the list in its old buffer, the slot a free one with its pointer
to the next, first in the chain again, and the pool's counts. It is refused once the game has made or let go of a
contract (the pool's first free slot or counts have changed). The game should be paused while the editor writes: a
contract the game made at the same moment would take the same slot.

With no slot free, which is the case from a load until the game makes its first contract, the signing is refused; the
game takes a new chunk only when it makes a contract itself.

A full squad list is grown the same way for a transfer and a swap now. Where the editor cannot grow it, the dialog
still offers to make room.

## On the Mac

The Mac Steam build (26340721, arm64) keeps its pools the same way, laid out as on Windows (`[pool]` in
`layout-macos.toml`). On the Arsenal save of 5 July 2027, `pools --walk` found 279 in the plugin's data, every chain
of free slots as counted. The contracts' pool sits at `game_plugin+0x56AFE10`, with 200-byte slots: a first chunk of
48,700 and a second of 1,024, 48,949 used and 775 free, as the game had made contracts since the save was loaded. The
contracts are laid out as on Windows too: of the 48,949, `+0x98` holds a pointer in 375 and `+0xA0` in 336, and `+0x28`
none, so `[contract] cleared` is the same. `+0xA8` looks like a pointer in a few (`0x00000073_0000051A`), but holds two
`u32`s.

`Process::write_static` on macOS writes only within a module's segment mapped writable and not executable (the
plugin's `__DATA`), in pages the game can write now, never `__DATA_CONST`, its code or the heap.

With the probe, Jack Grealish (a free agent, CA 145) was signed for Liverpool, whose squad list of 32 was full: five
writes, the list grown into memory of the editor's own, a contract of £150,000 a week to 30 June 2029, Fringe Player,
no squad number; moved back, the pool read 775 free and 48,949 used again.

## Checked

With the probe on Game Pass 0.9.2409.0, each signing undone and the pool read back as before (1,010 free, the chain as
counted):

| Who | To | Contract | Squad list |
|---|---|---|---|
| Brahim Díaz (CA 145) | Arsenal | £140,000 a week (an outfield player's), to 30 June 2029, Squad Player | 25 → 26, grown (room for 32) |
| Brahim Díaz | Juventus, £50,000 a week to 30 June 2030 | as given, Regular Starter | grown |
| Onuralp Balcıoğlu (16) | Beşiktaş (a human manager's) | £401 a week, Youngster | had room |
| Stanley Nwabali (goalkeeper) | Arsenal, Beşiktaş | £40,000 and £10,608 a week, Backup | grown, had room |
| Gabriel (a transfer) | Arsenal → Juventus | his own | grown |

Before the squad statuses were matched, Díaz was modelled on Kepa Arrizabalaga, the nearest in ability, whose status
is Domestic Cup Goalkeeper (17).

Not checked yet: the game playing on, saving, loading and quitting with a signed player; the game letting go of such
a contract (it is one of its own, so it goes back to the pool as any other); the game growing a squad list the editor
grew; Steam; the Intel half of the Mac build, where the pools have not been looked for.
