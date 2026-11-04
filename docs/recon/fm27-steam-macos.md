# FM27 on macOS: the Steam build 26227640

Observed on 2026-10-31 on an Apple silicon Mac with macOS 27.0.1 and System Integrity
Protection on, from the Steam install under
`~/Library/Application Support/Steam/steamapps/common/Football Manager 27/` (app 4530370,
build 26227640, depot 4530373). Steam gives the Mac build the same build id as the Windows
one. The game had not been started on this Mac before; the layout below was then measured on
a new save (Tyrone Demarcus at Arsenal, 14 July 2026), with the game started by Steam through
the bridge's launcher.

## The app

`fm.app` is a Unity 6000.3.18f1 player, universal (arm64 and x86_64):

| | |
|---|---|
| Bundle id | `com.SportsInteractive.FootballManager27`, version 27.0.0.2486716 |
| Executable | `fm.app/Contents/MacOS/Football Manager 27`, the process name too |
| Game plugin | `fm.app/Contents/PlugIns/game_plugin.bundle/Contents/MacOS/game_plugin`, a Mach-O bundle |
| Other modules | `UnityPlayer.dylib` and `GameAssembly.dylib` in `Contents/Frameworks` |

`game_plugin` has a `LC_UUID` per architecture, which identifies the build as the PE header
does on Windows:

| | arm64 | x86_64 |
|---|---|---|
| `LC_UUID` | `9E8E47DE-F704-314C-917D-C32D12637678` | `22CFE5C3-B5CF-3C00-8043-1EA190A69B89` |

The arm64 image is `0x58F4000` bytes: `__TEXT` `0x54B0000`, `__DATA_CONST` `0x1F4000`,
`__DATA` `0x9C000` (with `__common` at `0x56D10D0` and `__bss` at `0x5721BA0`) and
`__LINKEDIT`. The `(begin, end)` pairs of the entity arrays are globals, so they should be in
`__DATA`; `calibrate --scan` scans the writable segments as it scans `.data` on Windows.

## Why macOS keeps the editor out

The app and `game_plugin` are signed by SEGA's Developer ID (`3JJX9QL35J`), notarized, and
built with the **hardened runtime**. Their entitlements:

```text
com.apple.security.cs.allow-dyld-environment-variables   true
com.apple.security.cs.disable-library-validation         true
com.apple.security.device.camera                         true
com.apple.security.personal-information.photos-library   true
```

There is no `com.apple.security.get-task-allow`, so macOS hands the game's task port, the
handle to its memory, to no debugger. A test process signed the same way confirmed it:
`task_for_pid` from the same user fails with `KERN_FAILURE` (5) while SIP is on. That is why
earlier Mac editors asked players to turn SIP off.

The first two entitlements are the way in. With them, dyld loads the libraries named in
`DYLD_INSERT_LIBRARIES`, signed by anyone; Steam relies on them for its overlay. FMRTE 27 for
Mac no longer needs SIP off either: its notes speak of a plug-in, set up through the
launchers' settings, that only loads after Steam has been quit.

## The bridge

`crates/fmlibre-bridge` builds `libfmlibre_bridge.dylib`. Loaded, it checks that the process
is Football Manager, checks in the Mach service `io.github.tozmoz.fmlibreeditor.bridge.<pid>`
and waits on it in a thread of its own. A request from a process of the same user, by the
audit token the kernel attaches, gets `mach_task_self()` back as a port descriptor; anyone
else gets an empty answer. The editor checks with `pid_for_task` that the port it got is the
game's. It hooks nothing and reads nothing of the game.

What the test process showed on macOS 27:

- `bootstrap_check_in` of a name launchd has never heard of works for a process of the GUI
  session, as Chromium uses it, and `bootstrap_look_up` finds it from another one.
- `mach_task_self()` of a third-party app may be sent to another process, which Chromium and
  Electron apps rely on. The **read** port, `TASK_READ_PORT`, may not: sending it killed the
  process with `EXC_GUARD` (`ILLEGAL_MOVE`). The bridge never sends it.
  `task_get_special_port(TASK_KERNEL_PORT)` is refused (`KERN_DENIED`).
- With the port, `mach_vm_read_overwrite`, `mach_vm_write`, `mach_vm_region_recurse` and
  `task_info(TASK_DYLD_INFO)` work as for a debugger. An 8-byte read takes about 0.9 µs, the
  list of 84 modules 3 ms.
- dyld stops the game before it starts when an inserted library is missing or has no slice
  for the game's architecture (`terminating because inserted dylib ... could not be loaded`).
  So the bridge is universal, it is replaced with a new file rather than overwritten, and
  removing it takes the launch option out first.
- SIP strips the `DYLD_*` variables from the environment of protected programs, and so
  from what they start: `DYLD_INSERT_LIBRARIES=... arch -x86_64 game` loses it on the way,
  `arch -x86_64 -e DYLD_INSERT_LIBRARIES=... game` does not.

## Heap-only writes

`mach_vm_region_recurse` reports a module's `__DATA` page that the process has written to as
private memory that no file backs: the copy-on-write copy is the process's own. So the write
guard also refuses any range that overlaps a module, as dyld lists them (read again after
30 seconds). `proc_regionfilename` was tried first: it names the module for such a page and
fails with `EINVAL` for heap memory. Under Rosetta, though, it names
`/usr/libexec/rosetta/runtime` for every region of the game, heap included, which would
refuse every write.

The game's objects live in memory it gets from macOS's allocator: the players' pool in
`MALLOC_LARGE` regions (tag 3); the teams' lists, under Rosetta, in a `MALLOC_MEDIUM` one
(tag 12), and natively in `MALLOC_SMALL` ones (tag 2) of 4 MiB. The lists themselves come
from the game's own allocator (see [below](#the-games-allocator)).

## Steam's launch options

Steam on macOS starts a game's app bundle (`'…/fm.app'` in its logs). It runs **no shell** for
a launch option: it replaces `%command%` with the bundle's path, in single quotes, splits the
option into words and starts the first word as a program. The first launch option of the
bridge, `DYLD_INSERT_LIBRARIES="…" %command%`, which a shell would take, made it fail:

```text
Failed running GameID 4530370: "DYLD_INSERT_LIBRARIES="…/libfmlibre_bridge.dylib" '…/fm.app'" (OS Error 260)
```

Error 260 is Cocoa's "no such file": the variable was taken for the program. So the launch
option is `'…/fmlibre-launch' %command%`, quoted the way Steam quotes the game. The launcher
is a small program of `fmlibre-bridge`: it finds the bundle's executable from its
`Info.plist`, puts the bridge in front of the libraries `DYLD_INSERT_LIBRARIES` already names,
and `exec`s the game, which keeps the process id Steam follows. Without the bridge beside it,
it starts the game as it is. Started that way, FM27 (pid 14183) loaded the bridge next to the
two libraries Steam names, `steamloader.dylib` and `gameoverlayrenderer.dylib`, and the probe
attached to it with SIP on.

Steam starts the launch option's program as **Intel code**: FM27, started through a launcher
that simply `exec`'d it, ran under Rosetta, with the Intel half of `game_plugin` (UUID
`22CFE5C3-…`), though Steam itself and the game are universal. The launcher now becomes the
game with `posix_spawn`, `POSIX_SPAWN_SETEXEC` and the Mac's own architecture first: started
as Intel code itself, it brought a stand-in for the game up natively, with the bridge and the
other inserted library.

Why Intel code: `steamclient.dylib` (both halves) starts the program with `posix_spawn` and
`posix_spawnattr_setbinpref_np` set to x86_64, then arm64. That function keeps only the pid,
so when the start fails Steam shows errno, which `posix_spawn` leaves at 0. An M4 Mac, most
likely without Rosetta, got "Failed to start process for this game: OS Error 0" with the
universal launcher (November 2026). A stand-in for Steam's start on this Mac showed why:

- a universal program ran as x86_64 under Rosetta, an arm64-only one natively;
- a `#!/bin/sh` script ran under Rosetta too: `/bin/sh` and `/usr/bin/arch` still have an
  x86_64 half on macOS 27;
- a start the kernel refused returned 86 (`EBADARCH`), with errno still 0.

So the editor installs only the launcher's half for the Mac's own architecture, cut out of the
universal one as `lipo -thin` does; each half has its own signature. A stand-in for the game
started through the universal launcher also kept `P_AFFINITY` (0x10000 in `ps -o flags`), the
kernel's mark to prefer x86_64, as FM27 did (0x14004). Started through the arm64 half, it did
not. On 2026-11-04 Steam started FM27 through the arm64 half of the 0.4.2 launcher (Developer
ID, cut out by the probe's `bridge setup`): flags 0x4004, the arm64 `game_plugin`, the bridge
and both of Steam's libraries loaded, and `health` passed all ten checks.

The release build signs the launcher with the hardened runtime, which notarization requires.
dyld then takes every `DYLD_*` variable out of the launcher's environment before it runs: a
launcher signed that way (ad hoc, with `--options runtime`) passed only the bridge on, and a
stand-in for the game lost the library a stand-in for Steam had named. The kernel's copy of
the environment the program was started with (`sysctl` `KERN_PROCARGS2`) still holds them, so
the launcher reads back the `DYLD_*` variables missing from its own and passes them on. It
loads none of them itself. The entitlement that lets dyld keep them
(`com.apple.security.cs.allow-dyld-environment-variables`) would also have the launcher load
Steam's libraries, which another team signs, so library validation would have to be turned
off as well.

Each Steam account keeps them in
`~/Library/Application Support/Steam/userdata/<account>/config/localconfig.vdf`, under
`UserLocalConfigStore/Software/Valve/Steam/apps/4530370/LaunchOptions`. Steam reads the file
when it starts and writes it back when it quits, so the editor changes it only while Steam is
closed, keeps a `.fmlibre-backup` of the first version it changed, and edits the one value in
place. Set up and taken out again on a copy of a real file, it came back byte for byte.

## The object layout

`calibrate` found the arrays where Windows has them relative to each other: players at
`game_plugin+0x5C891C8` (38,007, the same as the Windows Steam test save), staff `0x48` and
clubs `0x1B8` after them. With the Windows layout no name decoded, as clang lays classes with
virtual bases out by the Itanium C++ ABI, not MSVC's. `profiles/fm27/layout-macos.toml` holds
the Mac offsets:

| | Windows | macOS |
|---|---|---|
| Player's own fields (positions, attributes, CA/PA, condition, morale, team, injuries) | | 8 bytes earlier: no vbptr |
| Person (names, nation, personality, birth date, contract, caps) | after the identity block, `+0x2B0` | first, `+0x278`; its fields 0x40 earlier |
| Identity block (UID; what contracts and captaincies point at) | `+0x288`, before the person | `+0x388`, after it |
| Player-coach shift | `0xF8` | `0xF8` (Paul Ifill's UID at `+0x48C`) |
| Staff's own fields (attributes, reputation, CA/PA) | | the same |
| Staff person / identity block | `+0x128` / `+0x100` | `+0xF8` / `+0x208` |
| Human manager shift | `0x340` | `0x340` (the save's own manager) |
| In-game date | `+0x848` from the players pair | a variable of its own (below) |

Contracts, clubs, club info, club finances, teams, nations and injuries are laid out as on
Windows. Witnesses on the running game:

- Lionel Messi: born 24 June 1987, 207 caps and 125 goals, 18 and 14 for the U21s, his
  positions and attributes, a contract that ends on 31 December 2028 with squad number 10.
- Tottenham Hotspur: 50,000 season tickets, founded 1882, supporter traits 18/14/7/14/7/14,
  £65 tickets, corporate facilities 20, reputation 7650; captain Micky van de Ven and
  vice-captain Pedro Porro, whose captaincies point at their identity blocks.
- Injuries: David Wotherspoon's moderate calf muscle strain, among others.

With the build profile of the Intel half, `calibrate` decoded 100% of the sampled players,
staff and clubs. The probe then wrote, read back and restored right away: Messi's finishing,
his ambition and his squad number; Pedro Porro as Tottenham's captain (the two captains
swap); Mikel Arteta's tactical attribute; Tottenham's balance; and a swap of Ben Davies with
Tom Heaton (14 writes).

## Natively, on Apple silicon

Started again from Steam through the native-first launcher, FM27 (pid 17731) ran natively,
with the arm64 half of `game_plugin` (UUID `9E8E47DE-F704-314C-917D-C32D12637678`). With no
profile yet, `calibrate` found its arrays by scanning, at `0x56D2E18`, `0x56D2E60` and
`0x56D2FD0`, 100% decoded with the same layout, which clang lays out alike for both
architectures. The reads and the restored writes above passed again (the swap took 10
writes this time).

The in-game date is not with the arrays, though. At `+0x908` from the players pair the arm64
half held an unset date (1 January 1900) right after the save was loaded; the Intel half had
read 14 July 2026 there in a new game. The date itself is a variable of its own: 14 July 2026
at `0x56B1DB8` on arm64, the only such value in `__DATA` besides the database's timestamp. The
Intel half had the same value at `0x5C69700`, at about the same place among the globals. The
build profiles name these (`current_date`); without a profile the reader falls back to the
cluster's field. When the game moved on a day, the variable read 15 July 2026, and the
cluster's field stayed unset.

## The game's allocator

Before it was measured, the Mac layout let no list grow past its capacity, and moves to
most clubs were refused: moving Ben Davies to Juventus, Manchester United and five other
clubs failed. Natively, the 4,096 team lists with a buffer sat in 21 `MALLOC_SMALL` regions,
but not in malloc's blocks: lists of one pointer sit 8 bytes apart, while malloc's blocks are
16-byte aligned and at least 16 bytes long. The game carves the chunks it gets from malloc
into blocks of its own size classes, the same as on Windows. `squads` groups the lists by
capacity, which decides the block:

- **Spacing:** buffers of one capacity are spaced by their class on shared pages. That is
  144 bytes for 17 and 18 pointers, 160 for 19 and 20, 192 for 21 to 24, and so on up to 512.
- **Zeroed blocks:** after the capacity, the rest of the class's block is zero. This held
  for 837 of the 853 lists from 145 to 512 bytes.
- **Old data:** the other 16 had grown past their length (13 players with room for 26, 25
  with room for 50, …). They held old data after their capacity, at their class's spacing.
  The editor leaves such a block at the list's capacity.

So `layout-macos.toml` takes Windows' `heap.block_sizes`. Moves then worked, each undone
right away:

- **Juventus:** Ben Davies joined their 34 players, whose list sits in a 288-byte block.
- **FC Bayern München:** 22 players in a 192-byte block. During the move the list read 23 of
  23, with him in the slot after the old capacity.
- **After the undo:** both blocks were byte for byte as before.
- **Manchester United:** the 28 pointers fill their 224-byte block, so a move there is still
  refused.

These sizes were measured on the arm64 half only. The Intel half, which Intel Macs and Rosetta run, was not measured.

## The features first mapped on Windows

Jadedness, traits, the contract's extras, the reasons to be unhappy, stadiums and planned retirements were first
mapped on the Windows Game Pass build. On 2026-11-01 they were read on the Mac, natively, on the maintainer's save
(Arsenal, autumn 2026). Each write below was restored right away.

| Feature | Where on the Mac | Read and written |
|---|---|---|
| Jadedness | player `+0x252`, 8 bytes before Windows' `+0x25A` | all 37,980 players from -500 to 643, 1,835 at -500; Arsenal's regular starters 255 to 391, its injured -500. Alex Scott 258 → -500 → 258. |
| Traits | player `+0x308`, 0x40 before Windows' `+0x348` | Messi's bits 7 10 16 17 19 20 49 51, as FMRTE shows them. Harry Kane's bit 49 set and cleared. |
| Loyalty bonus, happiness | the contract, as on Windows | Kylian Mbappé's loyalty bonus 50,098 a week and Erling Haaland's 43,634, as on Windows. Mbappé's happiness 60 → 100 → 60, his loyalty bonus 50,098 → 60,000 → 50,098. |
| Clauses and bonuses | the contract's `+0x68`, as on Windows | Mbappé's release clause (859,031,872 pounds) and three bonuses. Kane's goal bonus changed; Mbappé's first and last entries removed; his list then read as before. |
| Reasons to be unhappy | the contract's `+0x30`, as on Windows | 1,998 players have a record, of 1 to 6 entries. Mbappé's count 1 → 0 → 1. |
| Stadium | the senior team's `+0x78`, and `db::STADIUM`, as on Windows | Old Trafford 74,879 (74,310 in use, up to 95,285), the Emirates 60,704, the Tottenham Hotspur Stadium 62,850, the Amex 31,876. Across all 24,471 stadiums, no seats above the capacity and 28 ceilings below it (31 on Windows). Old Trafford 74,879 → 80,000 → 74,879. |
| Planned retirements | below | |

No contract on this save has room in its list of clauses: 0 of 33,770, where the Game Pass save had 384 of 53,356. A
release clause can therefore not be added here, and the editor refuses it, as it does for a full list on Windows.

### The retirement manager

The probe's `types` and `instances` now read Itanium type info on the Mac (`fmlibre_core::rtti`). `RETIREMENT_MANAGER`
(`18RETIREMENT_MANAGER`) has one vtable, `game_plugin+0x55F7DA0`, and one object. It is laid out as on Windows:

- the planned retirements at `+0x30`: 13 pointers to 24-byte entries;
- their index by person id at `+0x90`;
- a second list at `+0x18`, of 6, with its own index at `+0x78`.

The entries match those on Windows: Cristiano Ronaldo on 30 June 2027, Daniel Wass on 1 July 2027, Iago Aspas, and
Hugo Broos (staff). A player keeps the game's id of the person 8 bytes into his identity block, at `+0x390`.

One pointer leads to the manager: `game_plugin+0x56A82A8`, in `__DATA`. That is 0x2AB70 before the players pair,
where Windows keeps it 0xED60 (Game Pass) or 0xDAC0 (Steam) before. Like the date, it is a variable of its own, so
the arm64 build profile names it (`retirement_manager`), as the Windows ones now do. Ronaldo, Wass and Aspas were each
kept from retiring and restored, and the list then read as before.

The Intel half was not running, so its static was found in the file:

1. Both halves keep their functions in the same order. Strings that each half references once gave 19,461 matching
   addresses to map one half's code onto the other's.
2. The arm64 half loads `0x56A82A8` at 48 places. Mapped over, 46 of them sit next to a load of `0x5C5FEF0`. That
   global is loaded only 60 times in the whole Intel half.
3. The calls that follow those loads go to the same methods in both halves, a few hundred bytes from where the
   mapping puts them.

The x86_64 build profile takes `0x5C5FEF0`; it was not read in a running game. The editor checks the manager's class
before it uses it, so a wrong static would only hide the feature.

## Men and women

A person's identity block holds a byte of flags 0x19 in: player `+0x3A1`, staff `+0x221`. The flag `0x10` is set for
women. It was found on the maintainer's save (Arsenal, November 2026) by sorting the players by their club's women's
flag (club `+0xB9`) and looking for a byte of the player object whose values never overlap between the two:

| Players | `0x10` set | `0x10` clear |
|---|---|---|
| of women's clubs | 6,964 | 0 |
| of men's clubs | 0 | 26,476 |
| without a club | 1,325 (Sophia Wilson, Emma Sears, Cristiane) | 3,203 (Christian Eriksen, Karim Benzema) |

Every player reads one way or the other: 8,289 women and 29,679 men of 37,968. Among staff, the flag is set for
Sarina Wiegman, Emma Hayes, Sonia Bompastor, Pia Sundhage and Renée Slegers, and clear for the 947 men who work for
women's clubs, so it is the person's, not the club's. The other flags are not known: `0x02` is set for about half the
players and for staff such as Pep Guardiola and Jürgen Klopp, `0x01` for Alex Ferguson and some chairmen and owners,
and `0x20`, `0x40` and `0x80` for a few hundred people.

The layout's `gender` places the byte (`fmlibre_core::is_woman` reads it), and the player and staff lists filter on it.
On Windows the identity block sits at player `+0x288` and staff `+0x100` (see the table above), and the byte 0x19 in,
at `+0x2A1` and `+0x119`, as `layout.toml` places it:

- Steam build 26340721, on a save with women's football (1 July 2027), against the clubs' women's flag:

  | Players | `0x10` set | `0x10` clear |
  |---|---|---|
  | of women's clubs | 6,434 | 0 |
  | of men's clubs | 0 | 26,948 |
  | without a club | 1,956 | 4,931 |

  Every player reads one way or the other: 8,390 women and 31,879 men of 40,269. Among staff it is set for 2,548 of
  25,776 (Emma Hayes, Sarina Wiegman, Jill Ellis), and clear for the 846 men who work for women's clubs.
- Game Pass 0.9.2409.0, on a save without women's football (15 September 2026): no player has the flag, so all
  59,284 read as men, and the byte's other flags read as on the Mac: `0x02` for about half the players, `0x40` and
  `0x80` for a few hundred. Among staff it is set for 851 of 29,512, all women: Carolina Morace, Ria Ledwaba and Isha
  Johansen among them.

`fmlibre-probe players --women` and `--men` list each.

## 27.0.0 (Steam build 26340721)

The release that followed the Launch Preview, on 2 November 2026, gave both halves of `game_plugin` new UUIDs: arm64
`F4540355-…`, Intel `0981AB31-…`. With no profile for them the app found the arrays by scanning but read no date, so
it showed no ages.

- **arm64:** `calibrate --scan` found the arrays at the Launch Preview's RVAs. The date variable was still at
  `0x56B1DB8`: 16 November 2026 on a save whose screens read 16/11/2026, then 17 November once the game moved on a
  day. The retirement manager's static, `0x56A82A8`, listed the planned retirements (Cristiano Ronaldo and Karim
  Benzema among them).
- **Intel:** not run; checked in the file. Its code's RIP-relative loads still peak at the Launch Preview's RVAs:
  7,730 at the date `0x5C69700`, 184 and 170 at the players' begin and end, 18 and 18 at the staff's, 105 and 93 at
  the clubs', 61 at the retirement manager's static. The arm64 half loads the same variables 6,977, 123, 18, 104 and
  50 times.

The new profiles take the Launch Preview's RVAs with the new UUIDs.

With the arm64 profile, on a save dated 15 November 2026, the checks the editor makes before it writes
(`fmlibre-probe health`) all passed, in 62 ms. Their gaps were close to Game Pass's:
- **Players:** goalkeeping 43, finishing 36, tackling 35.
- **Staff:** goalkeeping 45, physiotherapy 49, judging potential 32.
- **Contracts:** 1,790 of 1,790 pointed back at their players, and 727 were signed after the player joined.
- **Date:** none of the 3,580 contract dates came after it; the latest came 4 days before it.
