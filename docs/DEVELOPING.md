# Developing FMLibreEditor

How the editor works, how to build and release it, and how to use the command-line probe.
For installing and using the app, see [INSTALL.md](INSTALL.md).

## Goals

- Attach to a running FM27 and edit players, staff and clubs live, in the spirit of
  FMRTE and FM Live Editor, but free and open source.
- First-class support for the **Game Pass / Microsoft Store** and **Steam** builds; Epic
  later. The **Steam build on macOS** too.
- A modern interface that feels like FM: attribute colours, a pitch position map,
  faces and logos from your installed graphics packs, mass editing with a preview,
  and an undo history.
- Survive game patches: find the game's data again automatically, and fall back to
  read-only whenever something does not check out.

## How it works

FM27's interface is Unity (IL2CPP), but the game itself, its database and
simulation, lives in a native, anti-tamper protected module: `game_plugin.dll`.
FMLibreEditor runs as a separate process and reads that module's heap data with
`ReadProcessMemory`. To edit, it writes values back with `WriteProcessMemory`, and
only into the game's heap. It never patches the game's code and never allocates
memory in the game. On Windows it puts no code of its own in the game either; on macOS
the game loads one small library of ours, the bridge (see [On macOS](#on-macos)).

Before every write it checks four things:
- the object still belongs to the same person;
- the new value is one the field can take;
- the current value looks like that field's (otherwise the layout does not fit);
- the value reads back as written.

If any check fails, nothing changes.

### After an update of the game

Each build of the game moves its static data. A build profile in `profiles/` (identified by `game_plugin`'s headers)
places the entity arrays, the in-game date and the retirement manager for each build the editor was checked with.
For a build without one, the editor still finds the arrays by scanning, and then:
- **No writes by default.** The app says that this version of the game is new to it. It writes nothing until the user
  presses Edit anyway, which lasts until the app is closed or connects again.
- **Checks before any write** (`crates/fmlibre-core/src/health.rs`), on every build. Each check samples up to 2,000
  players, members of staff or clubs, and looks for what a layout that reads the wrong bytes cannot fake:
  - every player rates 20 in his natural position;
  - goalkeepers are better at goalkeeping than outfield players, strikers at finishing and centre-backs at tackling;
  - goalkeeping coaches, physios and scouts are better than others at what their job is about;
  - contracts point back at their players, and some were signed after the player joined;
  - teams list their players, and clubs' senior teams point back at them.

  A check that does not pass leaves what it covers read-only: its fields, or for the contracts, teams, staff and clubs,
  every change to the game's lists and records. The app lists such checks under the masthead.
- **No date read from the wrong place.** The in-game date is only used when nearly every sampled contract was signed
  before it, and the latest not long before. Otherwise the app shows no ages, rather than wrong ones.

Each check was tried against a layout broken on purpose (a field group moved by a byte or a pointer's width), and each
such layout failed its check. After an update, `fmlibre-probe health` shows what the checks find, and `calibrate`
where the arrays are. A new build profile takes their RVAs and the date's, which `find` locates as in the
[Game Pass 0.9.2409.0 notes](recon/fm27-gamepass-0.9.2409.md), or on macOS as in the
[notes on 27.0.0 there](recon/fm27-steam-macos.md#2700-steam-build-26340721).

### On macOS

macOS lets no app read another app's memory unless the other app allows debugging, and
Football Manager does not: it is signed with Apple's hardened runtime. Unless System
Integrity Protection is turned off, macOS lets no other app attach to it. What the game
does allow is loading extra libraries named in `DYLD_INSERT_LIBRARIES` (Steam's overlay uses
the same door), so FMLibreEditor comes with a small one, the bridge (`crates/fmlibre-bridge`).

Steam on macOS runs a launch option as a program, with the game among its arguments, so the
launch option names a small launcher, `fmlibre-launch`, that comes with the bridge. The
launcher puts the bridge in `DYLD_INSERT_LIBRARIES` (in front of the libraries Steam names
there) and then turns into the game, so Steam keeps following the process it started. The
bridge hooks nothing, patches nothing and reads none of the game's data. It only answers the editor of the
same user with the game's task port, macOS's handle to a process's memory. From there the
editor works as it does on Windows: it reads with `mach_vm_read_overwrite`, writes with
`mach_vm_write` into the game's heap only, and makes the same four checks before every write.

The connect panel of the app sets the bridge up (**Set up the bridge**) or takes it out
again. Setting up copies the bridge and the launcher to
`~/Library/Application Support/FMLibreEditor/` and puts the launcher in front of FM27's
launch options in Steam, which only works while Steam is closed; Steam keeps the launch
options to itself while it runs. With Steam open, set the launch option yourself: right-click
Football Manager 27 in Steam, then **Properties › General › Launch Options**, and enter

```text
'/Users/<you>/Library/Application Support/FMLibreEditor/fmlibre-launch' %command%
```

The panel shows the line with your own folder in it. Launch options you already have stay,
behind the launcher; another tool's launcher among them is started in turn.

> **Before you delete these files by hand,** take the launch option out: Steam cannot start
> the game through a launcher that is not there. **Remove the bridge** in the app does both,
> in the right order. Without the bridge library, the launcher starts the game as it is.

## Repository layout

| Path | Contents |
|---|---|
| `crates/fmlibre-mem` | Process access on Windows and macOS: processes, modules, memory regions, PE and Mach-O headers, guarded writes |
| `crates/fmlibre-bridge` | macOS: the library the game loads to hand its memory to the editor, and the launcher Steam starts the game through |
| `crates/fmlibre-core` | Football Manager logic: game detection, calibration, decoders, editable fields |
| `crates/fmlibre-probe` | Command-line probe |
| `profiles/` | Object layouts per edition and addresses per game build |
| `app/` | Tauri 2 desktop app (React + TypeScript) |
| `docs/` | Install guide, roadmap and reverse-engineering notes (`recon/`) |
| `docs/design/` | The interface's design system (`DESIGN.md`) and product notes (`PRODUCT.md`) |

## Building

Requirements: Windows 10/11, Rust stable (via [rustup](https://rustup.rs)),
Visual Studio Build Tools with the C++ workload, and Node.js 20+ for the app.

```powershell
cargo build --release -p fmlibre-probe
cd app; npm install; npm run tauri dev     # run the desktop app
npm run release                            # build target\release\FMLibreEditor.exe
```

`npm run release` builds a stand-alone `FMLibreEditor.exe` without an installer. It
needs the WebView2 runtime, which Windows 10 and 11 already have.

On macOS: Xcode's command line tools, Rust stable with the Intel target as well
(`rustup target add x86_64-apple-darwin`, for the bridge to load in Intel builds of the
game), and Node.js 20+.

```sh
cargo build --release -p fmlibre-probe -p fmlibre-bridge
cd app; npm install; npm run tauri dev     # run the desktop app
npm run release:mac                        # build FMLibreEditor.app, universal, with the bridge
```

`npm run release:mac` writes the app to
`target/universal-apple-darwin/release/bundle/macos/FMLibreEditor.app`, signed ad hoc: it
has no Developer ID and is not notarized. macOS opens a copy downloaded from the internet
only once it is allowed in **System Settings › Privacy & Security** (**Open Anyway**).

`npm run dev` in `app/` serves the interface in a plain browser with made-up sample
players, for working on the UI without the game.

The app reads graphics packs from
`Documents\Sports Interactive\Football Manager 27\graphics` on Windows and from
`~/Library/Application Support/Sports Interactive/Football Manager 27/graphics` on macOS.
If FM keeps its user data somewhere else, set the environment variable `FMLIBRE_GRAPHICS`
to that graphics folder before starting the app.

The app remembers what was frozen in each save in `frozen.json` in its data folder
(`%APPDATA%\io.github.tozmoz.fmlibreeditor` on Windows,
`~/Library/Application Support/io.github.tozmoz.fmlibreeditor` on macOS). A save is told
apart by the storefront and the UIDs of its human managers. To test without touching that
file, set `FMLIBRE_DATA` to another folder before starting the app.

Exports go to `Documents\FMLibreEditor\Exports` (`~/Documents/FMLibreEditor/Exports` on
macOS); `FMLIBRE_EXPORTS` names another folder. The columns and the JSON keys are in
`crates/fmlibre-core/src/export.rs`.

### Releasing

1. **Bump the version** in three places:
   - `version` in the root `Cargo.toml` (`[workspace.package]`);
   - `app/package.json`;
   - `app/src-tauri/tauri.conf.json`.

   Commit the bump.
2. **Tag it and push the tag:** `git tag v0.1.0` and `git push origin v0.1.0`.
3. **The `Release` workflow** (`.github/workflows/release.yml`) runs the checks and builds,
   on GitHub's Windows and macOS machines:
   - `FMLibreEditor-Setup.exe`, a per-user NSIS installer in English, Turkish and Spanish;
   - `FMLibreEditor-portable.zip`;
   - `FMLibreEditor-macOS.zip`, the universal app with the bridge and its launcher;
   - `FMLibreEditor-macOS.app.tar.gz`, the same app, which installed macOS apps update from.

   It opens a **draft** release with these files, `latest.json` and
   `docs/release-notes.md` as its text.
4. **Write what is new in the draft and publish it.** From then on, installed Windows copies
   and macOS apps of a version with the updater (any after 0.4.1) offer **Update** in their
   notice.

The download links in the README point at the latest published release. People outside the
repository can use them once it is public.

#### Updates from inside the app

A copy the Windows installer put in place, and the macOS app, update themselves with Tauri's
updater plugin: it reads `latest.json` from the latest published release (the endpoint in
`app/src-tauri/tauri.conf.json`), downloads the file it names for the system, and checks its
signature against the public key in the same file.

- **Windows:** the installer runs in passive mode; the app closes and the installer opens
  the new version.
- **macOS:** the app in `FMLibreEditor-macOS.app.tar.gz` takes the place of the running
  one's bundle (macOS asks for an administrator's password where the user may not change
  it), and the app starts again (`restart_app`). At startup an app run from its bundle puts
  its bridge and launcher in place of the installed ones where they differ
  (`bridge_setup::refresh`), so the game loads the new bridge the next time it starts.

Portable copies, a macOS app that macOS runs from where it was downloaded (App
Translocation) and development builds open the release's page instead (`can_self_update`).

The workflow signs the installer and the macOS archive with the private key in the
repository's secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
and writes `latest.json` from the signatures. The maintainer keeps a copy of the key and its
password outside the repository: a release signed with another key is refused by every
installed copy, which would then have to be updated by hand once. The macOS archive is made
after the app is notarized, so its build makes no updater files itself
(`tauri.bridge.conf.json`); a local `npm run release` or `npm run release:mac` needs no
key.

## Using the probe

Start FM27, load a save, then run:

```powershell
fmlibre-probe info                                   # process, storefront, modules, game_plugin.dll layout
fmlibre-probe calibrate                              # identify the build and locate players, staff, clubs
fmlibre-probe health                                 # the checks the editor makes before it writes, and what each found
fmlibre-probe players "arda guler"                   # search players (accents ignored), best first
fmlibre-probe players --position st --max-age 20 --min-pa 170 --sort pa   # wonderkid strikers
fmlibre-probe players --max-age 21 --export young.csv   # every match to a file, as the app's Export writes it (.json: JSON; --semicolon)
fmlibre-probe player 7458500                         # everything read for one player
fmlibre-probe staff arteta                           # search staff; staff-member <id> for details
fmlibre-probe clubs tottenham                        # search clubs; club <uid> for details
fmlibre-probe fields player                          # what the editor can change (also: staff)
fmlibre-probe get player 7458500                     # those fields' values for one player
fmlibre-probe set player 7458500 attribute.finishing 18 --shown   # change one: this writes to the game
fmlibre-probe move 13200568 1139 --restore           # move a player to a club and back: this writes too
fmlibre-probe swap 13200568 72048035 --restore       # two players swap clubs and back: this writes too
fmlibre-probe release 91100466 --restore             # release a player from his club and back: this writes too
fmlibre-probe staff-move 4000571 1139 --restore      # move a member of staff to a club and back: this writes too
fmlibre-probe staff-job 4000571 14 --restore         # give a member of staff another job and back: this writes too
fmlibre-probe injuries 728                           # the current injuries of a club's players
fmlibre-probe heal 37055843 --heal --restore         # heal a player and list his injuries again: this writes too
fmlibre-probe bans                                   # every player with a ban; bans <uid> for one player's
fmlibre-probe bans 29120248 --lift --restore         # lift a player's bans and list them again: this writes too
fmlibre-probe ties 2000138835                        # secondary nationalities and homegrown status, numbered
fmlibre-probe tie-set 2000138835 0 --nation 765 --restore   # point tie 0 at England and back: this writes too
fmlibre-probe teams 680                              # a club's teams: kinds, captains, players' fitness and morale
fmlibre-probe captain 680 43425040 --restore         # make a player captain (--vice: vice-captain) and back
fmlibre-probe scan                                   # find arrays of game objects in game_plugin.dll
fmlibre-probe refs 0x1a5a5396990 --span 0x3c8        # every pointer into an object (holders, lists, squads too)
fmlibre-probe dump game_plugin.dll+0x1000 --len 0x100
fmlibre-probe element game_plugin.dll+0x5681dc0 0    # follow an array and dump element 0
fmlibre-probe column game_plugin.dll+0x5681dc0 0x294 --find 7458500   # find a player by UID
fmlibre-probe find "18 July 2026"                    # search memory for text (UTF-8 and UTF-16)
fmlibre-probe find "c7 80 ea 07" --as hex --module game_plugin.dll
```

Addresses and lengths are hexadecimal. Add `--json report.json` to `info` or `scan`
to save the results. `calibrate --scan` ignores the build profile and finds the
arrays the way it would on an unknown build.

Only `set`, `move`, `swap`, `release`, `staff-move`, `staff-job`, `heal --heal`,
`bans --lift`, `tie-set`, `tie-add`, `tie-remove` and `captain` write to the game. Unlike the app, the probe writes to
a build without a profile too, as far as the checks allow, so that a new build can be mapped.
- `set` changes one field after the checks above. Values are as stored:
  attributes run 0–100, or 1–20 with `--shown`.
- `move` moves a player to a club's senior team; `release` leaves him a free agent.
- With `--restore`, each one puts the old values back straight away, to test
  without changing the save. `set`, `move`, `release`, `heal`, `bans`, the `tie`
  commands and `captain` also take `--hold <seconds>` to wait first, so the change
  can be looked at in the game.

If Windows denies access, run the probe from an administrator terminal.

On macOS, `fmlibre-probe bridge` shows whether the game loads the bridge;
`fmlibre-probe bridge setup` installs the bridge and the launcher built next to the probe
and sets the launch option (quit Steam first), and `fmlibre-probe bridge remove` takes them
out again.
Then start FM27 from Steam: the other commands work as on Windows, with `game_plugin` in
place of `game_plugin.dll` in addresses.

