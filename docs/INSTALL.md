# Installing FMLibreEditor

FMLibreEditor is a free program that edits the players, staff and clubs of Football Manager
27 while the game runs. It works on Windows with the Xbox / Game Pass and Steam builds, and
on macOS with the Steam build.

**Before you start, save your game under a new name in FM.**

## Windows

1. Download
   [FMLibreEditor-Setup.exe](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-Setup.exe)
   and run it.
2. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
   The program is not signed yet.
3. Pick a language, then click **Next** and **Install**. No administrator rights are needed.

To use it without installing, download the
[portable zip](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-portable.zip),
extract it and run **FMLibreEditor.exe**.

## macOS

1. Download
   [FMLibreEditor-macOS.zip](https://github.com/tozmoz/FMLibreEditor/releases/latest/download/FMLibreEditor-macOS.zip),
   open it and move **FMLibreEditor** to **Applications**.
2. Open it. The app is signed and notarized by Apple, so macOS opens it without a warning.
3. Quit Steam (**Steam › Quit Steam**), then click **Set up the bridge** in FMLibreEditor.
   This lets FM27 share its memory with the app when Steam starts it. System Integrity
   Protection stays on.

## Using it

1. Start FM27 (on macOS, from Steam) and load a save. The main menu is not enough.
2. Open FMLibreEditor and click **Connect**.
3. Open a player, a member of staff or a club, click **Edit**, change values and click
   **Apply**.

The game shows a change after you press **Continue** in FM. The **Changes** view lists what
you did, and **Undo** puts the old value back.

**Export**, above the player list, writes the players the list shows (with its search, filters
and order) to a CSV or JSON file in `Documents\FMLibreEditor\Exports`
(`Documents/FMLibreEditor/Exports` on macOS), named after the in-game date. Pick **CSV,
semicolon-separated** if Excel puts every value in one column, as it does where decimals are
written with a comma. Exporting only reads the game.

**Freeze attributes** (in a player's profile) and **Freeze money** (in a club's) hold what
the game would take away while FMLibreEditor is open and connected. The app remembers them
for that save: when you connect to it again, after a restart, they are frozen again and a
notice says so. After an update of FM27 they wait, still remembered, until FMLibreEditor
can write to the new version.

## Updating and removing

When a new version is out, FMLibreEditor says so at the top of its window when it starts.
**Check for updates**, at the foot of the window, asks again. To check, the app asks GitHub
for the latest release; it sends nothing else.

- **Windows, installed with the installer:** **Update** downloads the new installer, checks
  that it was signed with FMLibreEditor's key, and runs it: the app closes and opens again
  with the new version. (Versions up to 0.4.1 have no Update: download the next one by hand.)
  To remove the app, go to Settings › Apps.
- **Windows, portable:** **Download** opens the release's page; put the new
  `FMLibreEditor.exe` in place of the old one.
- **macOS:** **Update** downloads the new app, checks that it was signed with FMLibreEditor's
  key, and puts it in place of the old one: the app closes and opens again with the new
  version. macOS may ask for your password if your account cannot change the Applications
  folder. (Versions up to 0.4.1 have no Update: download the next one by hand and put it in
  Applications in place of the old one.) To remove it, quit Steam, click **Remove the
  bridge**, then move the app to the Bin.

## If something goes wrong

- **It says FM27 is not running, or the player list was not found:** load a save and try
  again.
- **Windows: it opened read-only:** open it again; if that does not help, right-click it and
  choose **Run as administrator**.
- **After an update of FM27, it says it has not been checked with this version of the game:**
  look for a newer FMLibreEditor with **Check for updates**; one usually follows within days.
  Until then it only reads the game. **Edit anyway** turns editing on for that session, as far
  as its checks allow: back up your save first.
- **It says some of the game's data did not check out:** if a save was still loading, press
  **Reload data**. Otherwise what the notice lists stays read-only until a newer version.
- **Your antivirus flags it:** tools that read another program's memory are sometimes
  flagged by mistake. FMLibreEditor is open source; you can allow it in your antivirus.
- **macOS: it cannot get into the game:** quit FM27 and start it again from Steam.
