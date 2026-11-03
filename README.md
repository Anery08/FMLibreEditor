# FMLibreEditor

A free, open-source live editor for **Football Manager 27**. Edit players, staff and clubs
while the game runs.

Works on **Windows** (Xbox / Game Pass and Steam) and **macOS** (Steam).

[![Latest release](https://img.shields.io/github/v/release/tozmoz/FMLibreEditor?label=release)](https://github.com/tozmoz/FMLibreEditor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/tozmoz/FMLibreEditor/total)](https://github.com/tozmoz/FMLibreEditor/releases)
[![License: GPL-3.0](https://img.shields.io/github/license/tozmoz/FMLibreEditor)](LICENSE)

![The player list and a player's profile](docs/images/players.png)

## Download

- **Windows 10 or 11:**
  [FMLibreEditor-Setup.exe](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-Setup.exe)
  or the [portable zip](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-portable.zip)
- **macOS:**
  [FMLibreEditor-macOS.zip](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-macOS.zip)

How to install and use it: [docs/INSTALL.md](docs/INSTALL.md).

## What it does

- Browse, search and filter every player, member of staff and club.
- Edit attributes, abilities, positions, personality, traits, contracts with their bonuses and
  clauses, reputation, finances, stadiums and more.
- Heal injuries, lift bans, remove unhappiness, prevent retirement, raise morale and fitness,
  max out attributes, set captains, for one player or a whole team.
- Freeze a player's attributes or a club's money: while the app runs, they do not go down,
  and the app freezes them again when you connect to that save another time.
- Transfer, swap or release players, and move staff between clubs.
- Mass edit many at once, with a preview; undo any change.
- Export the player list, with its search and filters, to CSV or JSON for a spreadsheet or
  your own tools: attributes, positions, personality, contract and more, with the in-game date.
- Checks how it reads the game before it writes, and stays read-only on a version of FM27 it
  has not been checked with yet.
- English, Turkish and Spanish; logos, flags and faces from your graphics packs.

The game shows a change once you press **Continue** in FM.

![Editing a player: a change waits, highlighted, until you apply it](docs/images/edit.png)

> **Status: beta.** Use it with offline, single-player saves, and back up your save
> before editing.

## For developers

How it works, building, releasing and the command-line probe:
[docs/DEVELOPING.md](docs/DEVELOPING.md).

FMLibreEditor is not affiliated with or endorsed by Sports Interactive or SEGA. Memory-layout
leads come from GPL-3.0 project:
[fm-editor](https://github.com/barak14/fm-editor) by barak14

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). The app's typeface,
[Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type, is bundled under the SIL
Open Font License 1.1 ([app/licenses/Archivo-OFL.txt](app/licenses/Archivo-OFL.txt)).
