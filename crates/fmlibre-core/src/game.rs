use std::path::{Path, PathBuf};

use fmlibre_mem::Process;
use serde::{Deserialize, Serialize};

/// Executable name of Football Manager on Windows (Steam, Epic and Game Pass alike).
#[cfg(windows)]
pub const GAME_EXE: &str = "fm.exe";

/// Executable name of Football Manager 27 on macOS, inside `fm.app/Contents/MacOS`.
#[cfg(target_os = "macos")]
pub const GAME_EXE: &str = "Football Manager 27";

/// Native module that holds the game database and simulation.
#[cfg(windows)]
pub const GAME_PLUGIN: &str = "game_plugin.dll";

/// Native module that holds the game database and simulation: the executable of
/// `game_plugin.bundle`, in the app's plug-ins.
#[cfg(target_os = "macos")]
pub const GAME_PLUGIN: &str = "game_plugin";

/// Where the running copy of the game was installed from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Storefront {
    GamePass,
    Steam,
    Epic,
    Unknown,
}

impl Storefront {
    /// Guesses the storefront from the package identity and the install path.
    pub fn detect(exe_path: &Path, package_full_name: Option<&str>) -> Self {
        // Windows and macOS paths alike, with forward slashes.
        let path = exe_path.to_string_lossy().to_ascii_lowercase().replace('\\', "/");
        let gdk_config = exe_path.parent().is_some_and(|dir| dir.join("MicrosoftGame.config").exists());

        if package_full_name.is_some() || gdk_config || path.contains("/windowsapps/") || path.contains("/xboxgames/") {
            Storefront::GamePass
        } else if path.contains("/steamapps/") {
            Storefront::Steam
        } else if path.contains("/epic games/") {
            Storefront::Epic
        } else {
            Storefront::Unknown
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Storefront::GamePass => "Game Pass / Microsoft Store",
            Storefront::Steam => "Steam",
            Storefront::Epic => "Epic Games Store",
            Storefront::Unknown => "unknown",
        }
    }
}

/// What can be told about a running game process before touching its data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub pid: u32,
    pub exe_path: PathBuf,
    pub storefront: Storefront,
    /// Football Manager edition, e.g. 27, when the package name or path reveals it.
    pub edition: Option<u32>,
    pub package_full_name: Option<String>,
    /// Package version of a Game Pass install, e.g. "0.9.2355.0".
    pub package_version: Option<String>,
    /// Steam's build id of a Steam install, e.g. "26227640", from its app manifest.
    pub steam_build: Option<String>,
}

impl GameInfo {
    pub fn inspect(process: &Process) -> fmlibre_mem::Result<Self> {
        let exe_path = process.image_path()?;
        let package_full_name = process.package_full_name()?;
        let storefront = Storefront::detect(&exe_path, package_full_name.as_deref());

        // Package full names look like "Name_Version_Arch_ResourceId_PublisherId".
        let package_version = package_full_name.as_deref().and_then(|name| name.split('_').nth(1)).map(str::to_owned);
        let edition = package_full_name
            .as_deref()
            .and_then(|name| number_after(name, "FootballManager"))
            .or_else(|| number_after(&exe_path.to_string_lossy(), "Football Manager "));
        let steam_build = (storefront == Storefront::Steam).then(|| steam_build(&exe_path)).flatten();

        Ok(Self { pid: process.pid(), exe_path, storefront, edition, package_full_name, package_version, steam_build })
    }

    /// The game and its build as the editor names them: "FM27 Game Pass 0.9.2409.0", "FM27 Steam build 26340721".
    pub fn name(&self) -> String {
        let edition = self.edition.map_or_else(|| "FM".to_owned(), |edition| format!("FM{edition}"));
        match (&self.package_version, &self.steam_build) {
            (Some(version), _) => format!("{edition} Game Pass {version}"),
            (None, Some(build)) => format!("{edition} Steam build {build}"),
            (None, None) => format!("{edition} ({})", self.storefront.label()),
        }
    }
}

/// The build id Steam records for the install that `exe_path` is in: one of the
/// `steamapps\appmanifest_*.acf` files names the install folder and its build.
fn steam_build(exe_path: &Path) -> Option<String> {
    let install = steam_install(exe_path)?;
    let folder = install.file_name()?.to_str()?;
    let steamapps = install.parent()?.parent()?;
    std::fs::read_dir(steamapps).ok()?.flatten().find_map(|entry| {
        let name = entry.file_name();
        let name = name.to_str()?;
        if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
            return None;
        }
        let text = std::fs::read_to_string(entry.path()).ok()?;
        acf_value(&text, "installdir")?.eq_ignore_ascii_case(folder).then(|| acf_value(&text, "buildid")).flatten()
    })
}

/// The install folder in `steamapps\common` that `exe_path` is in: it holds `fm.exe` on
/// Windows, and `fm.app`, which holds the executable, on macOS.
fn steam_install(exe_path: &Path) -> Option<&Path> {
    exe_path
        .ancestors()
        .find(|dir| dir.parent().and_then(Path::file_name).is_some_and(|name| name.eq_ignore_ascii_case("common")))
}

/// The value of the first `key` in Steam's KeyValues text, where a line holds a quoted key and a quoted
/// value apart by tabs, e.g. `"buildid"` and `"26227640"`.
fn acf_value(text: &str, key: &str) -> Option<String> {
    let quoted = format!("\"{key}\"");
    text.lines().find_map(|line| Some(line.trim().strip_prefix(&quoted)?.trim().trim_matches('"').to_owned()))
}

/// The number right after `marker`, e.g. 27 in "SportsInteractive.FootballManager27_...".
fn number_after(text: &str, marker: &str) -> Option<u32> {
    let start = text.find(marker)? + marker.len();
    let digits: String = text[start..].chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edition_from_package_and_path() {
        let package = "SportsInteractive.FootballManager27_0.9.2355.0_x64__5w3tn6tb6stnm";
        assert_eq!(number_after(package, "FootballManager"), Some(27));
        let steam = r"C:\Steam\steamapps\common\Football Manager 27\fm.exe";
        assert_eq!(number_after(steam, "Football Manager "), Some(27));
        assert_eq!(number_after("fm.exe", "Football Manager "), None);
    }

    #[test]
    fn steam_manifest_values() {
        let manifest = "\"AppState\"\n{\n\t\"appid\"\t\t\"4530370\"\n\t\"name\"\t\t\"Football Manager 27\"\n\
                        \t\"installdir\"\t\t\"Football Manager 27\"\n\t\"buildid\"\t\t\"26227640\"\n\
                        \t\"TargetBuildID\"\t\t\"0\"\n}\n";
        assert_eq!(acf_value(manifest, "installdir").as_deref(), Some("Football Manager 27"));
        assert_eq!(acf_value(manifest, "buildid").as_deref(), Some("26227640"));
        assert_eq!(acf_value(manifest, "LastOwner"), None);
    }

    #[test]
    fn steam_install_folder() {
        let windows = Path::new("C:/Steam/steamapps/common/Football Manager 27/fm.exe");
        assert_eq!(steam_install(windows), Some(Path::new("C:/Steam/steamapps/common/Football Manager 27")));
        let mac = Path::new(
            "/Users/me/Library/Application Support/Steam/steamapps/common/Football Manager 27/fm.app/Contents/MacOS/\
             Football Manager 27",
        );
        let install = Path::new("/Users/me/Library/Application Support/Steam/steamapps/common/Football Manager 27");
        assert_eq!(steam_install(mac), Some(install));
        assert_eq!(steam_install(Path::new("/Applications/fm.app/Contents/MacOS/Football Manager 27")), None);
    }

    #[test]
    fn storefront_from_path() {
        let steam = Path::new(r"C:\Steam\steamapps\common\Football Manager 27\fm.exe");
        assert_eq!(Storefront::detect(steam, None), Storefront::Steam);
        let epic = Path::new(r"D:\Epic Games\FootballManager27\fm.exe");
        assert_eq!(Storefront::detect(epic, None), Storefront::Epic);
        let store = Path::new(
            r"C:\Program Files\WindowsApps\SportsInteractive.FootballManager27_0.9.2355.0_x64__5w3tn6tb6stnm\fm.exe",
        );
        assert_eq!(Storefront::detect(store, None), Storefront::GamePass);
        let mac = Path::new(
            "/Users/me/Library/Application Support/Steam/steamapps/common/Football Manager 27/fm.app/Contents/MacOS/\
             Football Manager 27",
        );
        assert_eq!(Storefront::detect(mac, None), Storefront::Steam);
        assert_eq!(number_after(&mac.to_string_lossy(), "Football Manager "), Some(27));
        let epic = Path::new("/Users/Shared/Epic Games/FootballManager27/fm.app/Contents/MacOS/Football Manager 27");
        assert_eq!(Storefront::detect(epic, None), Storefront::Epic);
    }
}
