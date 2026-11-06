# Smoke tests

These tests start the built app, drive it against the running game over the Chrome DevTools Protocol (CDP) of its
WebView2, and check what it shows and writes with `fmlibre-probe`, which reads the game on its own. They are the
checks every release goes through, the same on Game Pass and on Steam.

## What you need

- Windows, Node.js 22 or later (the tests use its built-in `fetch` and `WebSocket`, and no packages).
- The app and the probe, built:

  ```powershell
  cd app; npm run release; cd ..          # target\release\FMLibreEditor.exe
  cargo build --release -p fmlibre-probe  # target\release\fmlibre-probe.exe
  ```

- FM27 running, with a save loaded.

## Running them

```powershell
node tools/smoke/run.mjs                     # the tests that only read
node tools/smoke/run.mjs --writes            # all of them, on a save you can lose
node tools/smoke/run.mjs --only connect,unknown
node tools/smoke/run.mjs --exe C:\path\to\FMLibreEditor.exe --probe C:\path\to\fmlibre-probe.exe
```

Each check prints a line: `PASS`, `FAIL` or `SKIP`. The screenshots and `results.json` go to
`tools/smoke/out/<date-time>/`, which git ignores. The run exits with 1 when a check failed.

The copy of the app the tests start has its own WebView2 profile and its own data folder (`FMLIBRE_DATA`) under that
folder, so it neither joins the copy you have open nor touches your `frozen.json`. It debugs on port 9341, and the
copy for the unknown build on 9342 (`--port` moves both).

## What they write

By default nothing that changes the game. With `--writes`, the tests change the game and undo every change:
- only on a save you can lose, such as a test save, never your career;
- not while you play: if the game moves on a day meanwhile, an undo can meet a value the game has changed. At the end
  the runner undoes whatever a test left and says what it could not put back.

| Test | Writes | What it checks |
|---|---|---|
| `connect` | no | The build is known, every check passes, the in-game date and ages, the players', staff and clubs' lists, a player's and a club's profile, an empty change log |
| `dialog` | no | A player opened from a club's squad as a dialog: focus kept in it, Escape, the Transfer dialog over it, the question before unapplied edits are thrown away |
| `edit` | yes | Edits through the app's commands, read back by the probe and undone; one attribute through Edit mode, undone from the Changes tab |
| `mass` | yes | A mass edit over a club's players, applied, read back and undone as one batch |
| `move` | yes | A transfer the app agrees to, and the undo that moves the player back |
| `medical` | yes | Healing an injured player, and keeping a player from retiring, each undone |
| `loan` | yes | A loan's terms, as the app and the probe read them; recalling a player on loan: the game's date becomes the loan's last day, as the probe reads it, his profile says his return is pending, the option to buy is taken away (and written back by the undo), and the dialog says what the terms would not allow in the game; a day the game has finished is refused; making the loan permanent, its fee starting as the option to buy; each undone |
| `stadium` | yes | Renaming a stadium: a name over 80 bytes and one with a space at its start refused; a name of the same block's size (written over the old one), one of another size and a shared stadium name (each in a string of the editor's own), each read back by the probe and undone; then the same through the club's Stadium tab (Rename, the length as it is typed, Save); the name remembered in `frozen.json`, given back within seconds after the probe writes the old one back (as the game does when it loads the save), forgotten and left alone once undone |
| `ties` | yes | Clubs a player was trained at: one pointed at another club, one added in place of a club he favours or dislikes where his list is full (adding refused, a relation that is not such a club refused), each read back by the probe and undone; then Change club through his profile's dialog (the search, Escape giving up only the search, Enter on the club found) |
| `freeze` | yes | Frozen attributes put back after the probe changes one as the game would; unfrozen, a changed value stays |
| `unknown` | no | The day of an update rehearsed (`FMLIBRE_IGNORE_PROFILES=1`): the build is new to the app, which finds the in-game date and the planned retirements by itself and writes nothing until Edit anyway |

The players and clubs they use are picked from the save on each run: the best known clubs and their best players, the
first injured player among them, the first player the game plans to retire, the first transfer the app agrees to.
Fixed ones went stale as saves moved on.

## Before a release

Run them with `--writes` on both storefronts' test saves, with the release build. After an update of the game, the
`unknown` test shows how the released app meets the new build before it has a profile; see
[After an update of the game](../../docs/DEVELOPING.md#after-an-update-of-the-game).

## Writing a test

A test is a module in `tests/` that exports `name`, `writes` and `run({ app, report, probe, connection, known })`, and
is listed in `TESTS` in `run.mjs`:
- `app` drives the app: `must(command, args)` calls one of its commands, `click`, `setInput`, `press` and `waitFor`
  work the page, `openTab(name)` opens a masthead tab by its English name ("Players", "Staff", "Clubs", "Changes"),
  `openClub(name)` a club's profile, and `shot` saves a screenshot (see `lib/app.mjs`);
- `report.check(name, ok, detail)` records a check;
- `probe.get(entity, uid, fields)` reads what the game holds, apart from the app.

Undo everything a test writes, and pick its players with `lib/witness.mjs` rather than fixed UIDs. Go by names rather
than places on screen too: builds differ in their tabs (one with a Scouting tab has it before Changes). Lessons from
CDP:
- `innerText` follows the style sheet, which upper-cases the tables' headers, for one: compare `textContent`;
- a reload cuts short the calls to the app that are out, and the console check then fails on "IPC custom protocol
  failed" and "Couldn't find callback id": `App.start` switches to English only once the first page is done starting;
- the list views that are not shown keep their layout under `visibility: hidden`, so look for elements that are on
  screen with `VIS` and `SHOWN`;
- `Runtime.evaluate` cannot hand a DOM node back by value;
- mouse coordinates are CSS pixels, right at any display scaling;
- missing logos and faces show up as failed requests to `fmgfx.localhost`, which is expected without a graphics pack.
