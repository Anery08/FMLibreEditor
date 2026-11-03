//! Setting the game up on macOS so the editor can reach it (see `fmlibre_mem::bridge`): the
//! bridge library and its launcher go to a fixed place, and a Steam launch option has Steam
//! start the game through the launcher, which has the game load the bridge.
//!
//! Steam on macOS runs no shell for a launch option. It starts the option's first word as a
//! program, with the rest as its arguments and `%command%` standing for the game's app bundle,
//! so FM27's launch option is `"…/fmlibre-launch" %command%`.
//!
//! The launch option lives in each Steam account's `localconfig.vdf`, which Steam reads when
//! it starts and writes back when it quits, so it is only changed while Steam is not running.
//! A launch option the player already has stays, behind the launcher.

use std::fmt;
use std::path::{Path, PathBuf};

use fmlibre_mem::find_processes;

/// Steam's app id of Football Manager 27.
pub const STEAM_APP_ID: u32 = 4_530_370;

/// File name of the bridge library.
pub const BRIDGE_FILE: &str = "libfmlibre_bridge.dylib";

/// File name of the program Steam starts the game through.
pub const LAUNCHER_FILE: &str = "fmlibre-launch";

/// The process of the Steam client on macOS.
const STEAM_EXE: &str = "steam_osx";

/// The first launch option of the bridge put the variable in front of `%command%`, as a shell
/// would take it. Steam fails to start the game with it ("OS Error 260"), so setting up again
/// or removing takes it out.
const SHELL_STYLE: &str = "DYLD_INSERT_LIBRARIES=";

/// Where things are, from the user's home folder.
#[derive(Debug, Clone)]
pub struct Places {
    /// Where the bridge and its launcher are installed: outside the app, which macOS may run
    /// from a temporary copy and which updates replace.
    pub bridge: PathBuf,
    pub launcher: PathBuf,
    /// Steam's folder of user data, with a folder per account.
    pub steam_users: PathBuf,
}

impl Places {
    pub fn of(home: &Path) -> Self {
        let support = home.join("Library/Application Support");
        let folder = support.join("FMLibreEditor");
        Self {
            bridge: folder.join(BRIDGE_FILE),
            launcher: folder.join(LAUNCHER_FILE),
            steam_users: support.join("Steam/userdata"),
        }
    }
}

/// How far the bridge is set up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeStatus {
    /// Whether the bridge library and its launcher are in place.
    pub installed: bool,
    /// The launch option that starts the game with the bridge.
    pub launch_option: String,
    /// Each Steam account on this Mac, and whether FM27 loads the bridge when it starts the game.
    pub accounts: Vec<Account>,
    pub steam_running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    /// The account's `localconfig.vdf`.
    pub config: PathBuf,
    /// FM27's launch options, as Steam has them.
    pub launch_options: Option<String>,
    pub loads_bridge: bool,
}

impl BridgeStatus {
    /// Whether starting the game from Steam loads the bridge, for some account.
    pub fn ready(&self) -> bool {
        self.installed && self.accounts.iter().any(|account| account.loads_bridge)
    }
}

#[derive(Debug)]
pub enum SetupError {
    /// Steam keeps the launch options while it runs and writes them back when it quits.
    SteamRunning,
    /// No Steam account on this Mac has a `localconfig.vdf`.
    NoSteamAccount,
    /// The bridge library or its launcher is missing from the app.
    NoLibrary(PathBuf),
    /// A `localconfig.vdf` is not in the shape the editor knows; it was left alone.
    UnknownConfig(PathBuf),
    Io(PathBuf, std::io::Error),
}

impl fmt::Display for SetupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SetupError::SteamRunning => {
                write!(
                    f,
                    "Steam is running and keeps FM27's launch options while it does, so they were left alone; quit Steam and try again"
                )
            }
            SetupError::NoSteamAccount => write!(f, "found no Steam account on this Mac; start Steam and sign in once"),
            SetupError::NoLibrary(path) => write!(f, "a file of the bridge is missing: {}", path.display()),
            SetupError::UnknownConfig(path) => {
                write!(f, "{} is not in a shape FMLibreEditor knows, so it was left alone", path.display())
            }
            SetupError::Io(path, err) => write!(f, "{}: {err}", path.display()),
        }
    }
}

impl std::error::Error for SetupError {}

impl crate::Coded for SetupError {
    fn code(&self) -> &'static str {
        match self {
            SetupError::SteamRunning => "setup.steamRunning",
            SetupError::NoSteamAccount => "setup.noSteamAccount",
            SetupError::NoLibrary(_) => "setup.noLibrary",
            SetupError::UnknownConfig(_) => "setup.unknownConfig",
            SetupError::Io(..) => "setup.io",
        }
    }

    fn params(&self) -> Vec<(&'static str, String)> {
        match self {
            SetupError::NoLibrary(path) | SetupError::UnknownConfig(path) => {
                vec![("path", path.display().to_string())]
            }
            SetupError::Io(path, err) => vec![("path", path.display().to_string()), ("error", err.to_string())],
            _ => Vec::new(),
        }
    }
}

/// The launch option that has Steam start the game through the launcher at `launcher`.
pub fn launch_option(launcher: &Path) -> String {
    format!("{} %command%", quoted(launcher))
}

/// Whether the Steam client is running.
pub fn steam_running() -> bool {
    find_processes(STEAM_EXE).is_ok_and(|found| !found.is_empty())
}

/// What is set up, read from the files; changes nothing.
pub fn status(places: &Places) -> BridgeStatus {
    let accounts = configs(&places.steam_users)
        .into_iter()
        .map(|config| {
            let launch_options =
                std::fs::read_to_string(&config).ok().and_then(|text| Vdf::parse(&text)?.launch_options(STEAM_APP_ID));
            let loads_bridge = launch_options.as_deref().is_some_and(|options| loads(options, places));
            Account { config, launch_options, loads_bridge }
        })
        .collect();
    BridgeStatus {
        installed: installed(places),
        launch_option: launch_option(&places.launcher),
        accounts,
        steam_running: steam_running(),
    }
}

/// Installs the bridge library and its launcher from the folder `from`, and has FM27 start
/// through the launcher for every Steam account. While Steam runs, only the files are
/// installed, for a launch option set in Steam by hand.
pub fn set_up(places: &Places, from: &Path) -> Result<BridgeStatus, SetupError> {
    let read = |name| {
        let path = from.join(name);
        std::fs::read(&path).map_err(|_| SetupError::NoLibrary(path))
    };
    let (bridge, launcher) = (read(BRIDGE_FILE)?, read(LAUNCHER_FILE)?);
    // New files in place of the old: a game still running keeps the library it loaded.
    write_new(&places.bridge, &bridge, false)?;
    write_new(&places.launcher, &launcher, true)?;

    if steam_running() {
        return Err(SetupError::SteamRunning);
    }
    let configs = configs(&places.steam_users);
    if configs.is_empty() {
        return Err(SetupError::NoSteamAccount);
    }
    for config in configs {
        let text = std::fs::read_to_string(&config).map_err(|err| SetupError::Io(config.clone(), err))?;
        let vdf = Vdf::parse(&text).ok_or_else(|| SetupError::UnknownConfig(config.clone()))?;
        let current = vdf.launch_options(STEAM_APP_ID);
        let wanted = with_bridge(current.as_deref(), places);
        if current.as_deref() == Some(wanted.as_str()) {
            continue;
        }
        let changed = vdf
            .set_launch_options(STEAM_APP_ID, Some(&wanted))
            .ok_or_else(|| SetupError::UnknownConfig(config.clone()))?;
        keep_backup(&config)?;
        write_new(&config, changed.as_bytes(), false)?;
    }
    Ok(status(places))
}

/// Puts the bridge library and its launcher from the folder `from` in place of the installed
/// ones that differ, so that after an update of the app the game loads the bridge that came
/// with it the next time it starts. Only once the bridge is installed; the launch options are
/// left as they are. Returns whether a file was replaced.
pub fn refresh(places: &Places, from: &Path) -> Result<bool, SetupError> {
    if !installed(places) {
        return Ok(false);
    }
    let read = |name| {
        let path = from.join(name);
        std::fs::read(&path).map_err(|_| SetupError::NoLibrary(path))
    };
    // Both are read first: one of them alone is never replaced.
    let files = [(read(BRIDGE_FILE)?, &places.bridge, false), (read(LAUNCHER_FILE)?, &places.launcher, true)];
    let mut replaced = false;
    for (bytes, place, program) in files {
        if std::fs::read(place).is_ok_and(|now| now == bytes) {
            continue;
        }
        // As in `set_up`: a game still running keeps the library it loaded.
        write_new(place, &bytes, program)?;
        replaced = true;
    }
    Ok(replaced)
}

/// Whether the bridge library and its launcher are in place.
fn installed(places: &Places) -> bool {
    places.bridge.is_file() && places.launcher.is_file()
}

/// Takes the launcher out of FM27's launch options, and removes the files once no launch
/// option names them: Steam cannot start the game through a launcher that is not there.
pub fn remove(places: &Places) -> Result<BridgeStatus, SetupError> {
    if steam_running() {
        return Err(SetupError::SteamRunning);
    }
    for config in configs(&places.steam_users) {
        let text = std::fs::read_to_string(&config).map_err(|err| SetupError::Io(config.clone(), err))?;
        let Some(vdf) = Vdf::parse(&text) else {
            continue;
        };
        let Some(current) = vdf.launch_options(STEAM_APP_ID) else {
            continue;
        };
        let rest = without_bridge(&current, places);
        if rest == current {
            continue;
        }
        let rest = (!rest.is_empty() && rest != "%command%").then_some(rest);
        let changed = vdf
            .set_launch_options(STEAM_APP_ID, rest.as_deref())
            .ok_or_else(|| SetupError::UnknownConfig(config.clone()))?;
        keep_backup(&config)?;
        write_new(&config, changed.as_bytes(), false)?;
    }
    if status(places).accounts.iter().any(|account| account.loads_bridge) {
        return Ok(status(places));
    }
    for file in [&places.launcher, &places.bridge] {
        match std::fs::remove_file(file) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(SetupError::Io(file.clone(), err)),
        }
    }
    Ok(status(places))
}

/// The `localconfig.vdf` of every Steam account.
fn configs(steam_users: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(steam_users) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path().join("config").join("localconfig.vdf"))
        .filter(|path| path.is_file())
        .collect();
    found.sort();
    found
}

/// Writes `bytes` to a new file that then takes the place of `path`; a program is made executable.
fn write_new(path: &Path, bytes: &[u8], program: bool) -> Result<(), SetupError> {
    use std::os::unix::fs::PermissionsExt;

    let io = |err| SetupError::Io(path.to_owned(), err);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".fmlibre-new");
    let temporary = PathBuf::from(temporary);
    std::fs::write(&temporary, bytes).map_err(io)?;
    if program {
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o755)).map_err(io)?;
    }
    std::fs::rename(&temporary, path).map_err(io)
}

/// Copies `config` aside once, before the editor first changes it.
fn keep_backup(config: &Path) -> Result<(), SetupError> {
    let mut backup = config.as_os_str().to_owned();
    backup.push(".fmlibre-backup");
    let backup = PathBuf::from(backup);
    if !backup.exists() {
        std::fs::copy(config, &backup).map_err(|err| SetupError::Io(backup, err))?;
    }
    Ok(())
}

/// `path` in single quotes, as Steam quotes the game's path for `%command%` when it splits a
/// launch option into words: `'Sid Meier'\''s Civilization VII'`.
fn quoted(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

/// Whether the launch options `options` start the game through the launcher.
fn loads(options: &str, places: &Places) -> bool {
    options.contains(&quoted(&places.launcher))
}

/// The launch options `current` with the launcher in front.
fn with_bridge(current: Option<&str>, places: &Places) -> String {
    let rest = without_bridge(current.unwrap_or(""), places);
    let rest = match rest.as_str() {
        "" => "%command%".to_owned(),
        options if options.contains("%command%") => rest,
        // Options without %command% are arguments, which Steam adds after the game.
        options => format!("%command% {options}"),
    };
    format!("{} {rest}", quoted(&places.launcher))
}

/// The launch options `current` without the launcher, nor the bridge's first, shell-style option.
fn without_bridge(current: &str, places: &Places) -> String {
    let launcher = format!("{} ", quoted(&places.launcher));
    let shell_style = format!("{SHELL_STYLE}\"{}\" ", places.bridge.display());
    current.replacen(&launcher, "", 1).replacen(&shell_style, "", 1).trim().to_owned()
}

/// A Steam KeyValues text, with the places of its keys and values, so that it can be changed
/// in place and the rest kept byte for byte.
struct Vdf<'a> {
    text: &'a str,
    root: Vec<Node>,
}

enum Node {
    /// A key and its text, and where the key starts and the text ends, quotes included.
    Value { key: String, value: String, start: usize, value_end: usize },
    /// A key and its entries, and where its opening brace is.
    Block { key: String, open: usize, children: Vec<Node> },
}

const APPS_PATH: [&str; 5] = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];

impl<'a> Vdf<'a> {
    /// `None` when `text` is not plain KeyValues: quoted keys and values, and braces.
    fn parse(text: &'a str) -> Option<Self> {
        let mut tokens = Tokens { text, at: 0 };
        let root = Self::nodes(&mut tokens, true)?;
        Some(Self { text, root })
    }

    fn nodes(tokens: &mut Tokens, top: bool) -> Option<Vec<Node>> {
        let mut nodes = Vec::new();
        loop {
            match tokens.next()? {
                Token::End if top => return Some(nodes),
                Token::Close if !top => return Some(nodes),
                Token::Text { text: key, start, .. } => match tokens.next()? {
                    Token::Text { text: value, end, .. } => {
                        nodes.push(Node::Value { key, value, start, value_end: end });
                    }
                    Token::Open { at } => {
                        let children = Self::nodes(tokens, false)?;
                        nodes.push(Node::Block { key, open: at, children });
                    }
                    _ => return None,
                },
                _ => return None,
            }
        }
    }

    /// The entries of the block at `path`, keys compared as Steam does, ignoring case.
    fn block(&self, path: &[&str]) -> Option<&[Node]> {
        let mut nodes = self.root.as_slice();
        for name in path {
            nodes = nodes.iter().find_map(|node| match node {
                Node::Block { key, children, .. } if key.eq_ignore_ascii_case(name) => Some(children.as_slice()),
                _ => None,
            })?;
        }
        Some(nodes)
    }

    fn launch_options(&self, app: u32) -> Option<String> {
        let mut path = APPS_PATH.to_vec();
        let app = app.to_string();
        path.push(&app);
        self.block(&path)?.iter().find_map(|node| match node {
            Node::Value { key, value, .. } if key.eq_ignore_ascii_case("LaunchOptions") => Some(value.clone()),
            _ => None,
        })
    }

    /// The text with app `app`'s launch options set to `options`, or taken out for `None`.
    fn set_launch_options(&self, app: u32, options: Option<&str>) -> Option<String> {
        let app = app.to_string();
        let apps = self.block(&APPS_PATH)?;
        // Each level is a tab further in: the apps' blocks are as deep as the path is long.
        let depth = APPS_PATH.len();
        let block = apps.iter().find_map(|node| match node {
            Node::Block { key, open, children } if *key == app => Some((*open, children)),
            _ => None,
        });
        let Some((open, children)) = block else {
            let Some(options) = options else {
                return Some(self.text.to_owned());
            };
            // The app has no settings yet: open a block for it at the top of the apps.
            let open = self.open_of(&APPS_PATH)?;
            let (outer, inner) = ("\t".repeat(depth), "\t".repeat(depth + 1));
            let block = format!(
                "\n{outer}\"{app}\"\n{outer}{{\n{inner}\"LaunchOptions\"\t\t\"{}\"\n{outer}}}",
                escape(options)
            );
            return Some(self.insert(open + 1, &block));
        };
        let existing = children.iter().find_map(|node| match node {
            Node::Value { key, start, value_end, .. } if key.eq_ignore_ascii_case("LaunchOptions") => {
                Some((*start, *value_end))
            }
            _ => None,
        });
        match (existing, options) {
            (Some((start, end)), Some(options)) => {
                let line = format!("\"LaunchOptions\"\t\t\"{}\"", escape(options));
                Some(format!("{}{line}{}", &self.text[..start], &self.text[end..]))
            }
            (Some((start, end)), None) => {
                // Takes the line out with the line break and indent before it.
                let line_start = self.text[..start].trim_end_matches(['\t', ' ']).trim_end_matches(['\n', '\r']).len();
                Some(format!("{}{}", &self.text[..line_start], &self.text[end..]))
            }
            (None, Some(options)) => {
                let indent = "\t".repeat(depth + 1);
                Some(self.insert(open + 1, &format!("\n{indent}\"LaunchOptions\"\t\t\"{}\"", escape(options))))
            }
            (None, None) => Some(self.text.to_owned()),
        }
    }

    /// Where the opening brace of the block at `path` is.
    fn open_of(&self, path: &[&str]) -> Option<usize> {
        let mut nodes = self.root.as_slice();
        let mut open = None;
        for name in path {
            let (at, children) = nodes.iter().find_map(|node| match node {
                Node::Block { key, open, children } if key.eq_ignore_ascii_case(name) => Some((*open, children)),
                _ => None,
            })?;
            open = Some(at);
            nodes = children;
        }
        open
    }

    fn insert(&self, at: usize, piece: &str) -> String {
        format!("{}{piece}{}", &self.text[..at], &self.text[at..])
    }
}

enum Token {
    Text { text: String, start: usize, end: usize },
    Open { at: usize },
    Close,
    End,
}

struct Tokens<'a> {
    text: &'a str,
    at: usize,
}

impl Tokens<'_> {
    /// The next token; `None` for anything that is not quoted text, a brace or a comment.
    fn next(&mut self) -> Option<Token> {
        let bytes = self.text.as_bytes();
        loop {
            while self.at < bytes.len() && bytes[self.at].is_ascii_whitespace() {
                self.at += 1;
            }
            if self.text[self.at..].starts_with("//") {
                self.at = self.text[self.at..].find('\n').map_or(bytes.len(), |end| self.at + end);
                continue;
            }
            break;
        }
        let Some(&byte) = bytes.get(self.at) else {
            return Some(Token::End);
        };
        let start = self.at;
        match byte {
            b'{' => {
                self.at += 1;
                Some(Token::Open { at: start })
            }
            b'}' => {
                self.at += 1;
                Some(Token::Close)
            }
            b'"' => {
                let mut text = String::new();
                let mut chars = self.text[start + 1..].char_indices();
                while let Some((i, c)) = chars.next() {
                    match c {
                        '"' => {
                            self.at = start + 1 + i + 1;
                            return Some(Token::Text { text, start, end: self.at });
                        }
                        '\\' => match chars.next()?.1 {
                            'n' => text.push('\n'),
                            't' => text.push('\t'),
                            other => text.push(other),
                        },
                        c => text.push(c),
                    }
                }
                None
            }
            _ => None,
        }
    }
}

/// `text` as a KeyValues string, without the quotes around it.
fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\t', "\\t")
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAUNCHER: &str = "/Users/me/Library/Application Support/FMLibreEditor/fmlibre-launch";
    const BRIDGE: &str = "/Users/me/Library/Application Support/FMLibreEditor/libfmlibre_bridge.dylib";

    fn places() -> Places {
        Places::of(Path::new("/Users/me"))
    }

    fn config(app_block: &str) -> String {
        format!(
            "\"UserLocalConfigStore\"\n{{\n\t\"Software\"\n\t{{\n\t\t\"Valve\"\n\t\t{{\n\t\t\t\"Steam\"\n\t\t\t{{\n\
             \t\t\t\t\"apps\"\n\t\t\t\t{{\n\t\t\t\t\t\"1295660\"\n\t\t\t\t\t{{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"1\"\n\
             \t\t\t\t\t}}{app_block}\n\t\t\t\t}}\n\t\t\t}}\n\t\t}}\n\t}}\n}}\n"
        )
    }

    #[test]
    fn the_launch_option_starts_the_launcher() {
        let places = places();
        assert_eq!(places.launcher, Path::new(LAUNCHER));
        assert_eq!(places.bridge, Path::new(BRIDGE));
        assert_eq!(launch_option(&places.launcher), format!("'{LAUNCHER}' %command%"));
        assert_eq!(quoted(Path::new("/a/Sid Meier's")), r"'/a/Sid Meier'\''s'");
    }

    #[test]
    fn the_launcher_goes_in_front_of_what_is_there() {
        let places = places();
        let ours = format!("'{LAUNCHER}'");
        assert_eq!(with_bridge(None, &places), format!("{ours} %command%"));
        assert_eq!(with_bridge(Some("-windowed"), &places), format!("{ours} %command% -windowed"));
        // In front of another tool's launcher, which then runs the game.
        let other = "\"/Applications/Other.app/launch\" %command%";
        let joined = with_bridge(Some(other), &places);
        assert_eq!(joined, format!("{ours} {other}"));
        assert!(loads(&joined, &places));
        // Set up twice, changed once; taken out, as it was.
        assert_eq!(with_bridge(Some(&joined), &places), joined);
        assert_eq!(without_bridge(&joined, &places), other);
        assert_eq!(without_bridge(&with_bridge(Some("-windowed"), &places), &places), "%command% -windowed");
        assert_eq!(without_bridge(&with_bridge(None, &places), &places), "%command%");
        // The first, shell-style launch option of the bridge, which Steam cannot start, gives way.
        let shell_style = format!("DYLD_INSERT_LIBRARIES=\"{BRIDGE}\" %command%");
        assert!(!loads(&shell_style, &places));
        assert_eq!(with_bridge(Some(&shell_style), &places), format!("{ours} %command%"));
        assert_eq!(without_bridge(&shell_style, &places), "%command%");
    }

    #[test]
    fn launch_options_are_set_in_place() {
        let fm = "\n\t\t\t\t\t\"4530370\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LastPlayed\"\t\t\"2\"\n\t\t\t\t\t}";
        let text = config(fm);
        let vdf = Vdf::parse(&text).expect("parse");
        assert_eq!(vdf.launch_options(STEAM_APP_ID), None);

        let set = vdf.set_launch_options(STEAM_APP_ID, Some("A=\"x y\" %command%")).expect("set");
        assert!(set.contains(
            "\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"A=\\\"x y\\\" %command%\"\n\t\t\t\t\t\t\"LastPlayed\""
        ));
        let vdf = Vdf::parse(&set).expect("parse again");
        assert_eq!(vdf.launch_options(STEAM_APP_ID).as_deref(), Some("A=\"x y\" %command%"));

        let changed = vdf.set_launch_options(STEAM_APP_ID, Some("-windowed")).expect("change");
        assert_eq!(Vdf::parse(&changed).and_then(|v| v.launch_options(STEAM_APP_ID)).as_deref(), Some("-windowed"));
        let removed = Vdf::parse(&changed).and_then(|v| v.set_launch_options(STEAM_APP_ID, None)).expect("remove");
        assert_eq!(removed, text);
        // Other apps are left alone.
        assert!(Vdf::parse(&removed).and_then(|v| v.launch_options(1_295_660)).is_none());
    }

    #[test]
    fn an_app_without_settings_gets_a_block() {
        let text = config("");
        let vdf = Vdf::parse(&text).expect("parse");
        let set = vdf.set_launch_options(STEAM_APP_ID, Some("%command%")).expect("set");
        assert!(set.contains("\t\t\t\t{\n\t\t\t\t\t\"4530370\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"%command%\"\n\t\t\t\t\t}\n"));
        assert_eq!(Vdf::parse(&set).and_then(|v| v.launch_options(STEAM_APP_ID)).as_deref(), Some("%command%"));
        assert_eq!(vdf.set_launch_options(STEAM_APP_ID, None).as_deref(), Some(text.as_str()));
    }

    #[test]
    fn unknown_shapes_are_left_alone() {
        assert!(Vdf::parse("\"a\" { \"b\" unquoted }").is_none());
        assert!(Vdf::parse("\"a\" { \"b\" \"c\"").is_none());
        let text = "\"UserLocalConfigStore\" { \"Other\" { } }";
        assert!(Vdf::parse(text).expect("parse").set_launch_options(STEAM_APP_ID, Some("x")).is_none());
    }

    #[test]
    fn sets_up_and_removes_in_a_steam_folder() {
        let home = std::env::temp_dir().join(format!("fmlibre-setup-test-{}", std::process::id()));
        let places = Places::of(&home);
        let account = places.steam_users.join("123/config");
        std::fs::create_dir_all(&account).expect("account folder");
        let config_text = config("");
        std::fs::write(account.join("localconfig.vdf"), &config_text).expect("config");
        let bundle = home.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle folder");
        std::fs::write(bundle.join(BRIDGE_FILE), b"bridge").expect("library");
        assert!(matches!(set_up(&places, &bundle), Err(SetupError::NoLibrary(path)) if path.ends_with(LAUNCHER_FILE)));
        std::fs::write(bundle.join(LAUNCHER_FILE), b"launcher").expect("launcher");

        // These run only while Steam is closed, which the test cannot arrange.
        if !steam_running() {
            use std::os::unix::fs::PermissionsExt;

            let status = set_up(&places, &bundle).expect("set up");
            assert!(status.ready(), "{status:?}");
            assert_eq!(std::fs::read(&places.bridge).expect("installed"), b"bridge");
            let mode = std::fs::metadata(&places.launcher).expect("launcher installed").permissions().mode();
            assert_eq!(mode & 0o777, 0o755);
            assert_eq!(status.accounts[0].launch_options.as_deref(), Some(status.launch_option.as_str()));
            assert!(account.join("localconfig.vdf.fmlibre-backup").is_file());

            let status = remove(&places).expect("remove");
            assert!(!status.installed && !status.ready());
            assert!(!places.launcher.exists() && !places.bridge.exists());
            // The block opened for FM27 stays, empty, as Steam keeps them.
            let text = std::fs::read_to_string(account.join("localconfig.vdf")).expect("config");
            let empty_block = "\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"4530370\"\n\t\t\t\t\t{\n\t\t\t\t\t}\n";
            assert_eq!(text, config_text.replacen("\"apps\"\n\t\t\t\t{\n", empty_block, 1));
        }
        std::fs::remove_dir_all(&home).expect("clean up");
    }

    #[test]
    fn an_update_of_the_app_refreshes_the_installed_bridge() {
        use std::os::unix::fs::PermissionsExt;

        let home = std::env::temp_dir().join(format!("fmlibre-refresh-test-{}", std::process::id()));
        let places = Places::of(&home);
        let bundle = home.join("bundle");
        std::fs::create_dir_all(&bundle).expect("bundle folder");
        std::fs::write(bundle.join(BRIDGE_FILE), b"new bridge").expect("library");

        // Not set up: nothing is installed.
        assert!(!refresh(&places, &bundle).expect("refresh"));
        assert!(!places.bridge.exists() && !places.launcher.exists());

        let folder = places.bridge.parent().expect("folder");
        std::fs::create_dir_all(folder).expect("install folder");
        std::fs::write(&places.bridge, b"old bridge").expect("old library");
        std::fs::write(&places.launcher, b"old launcher").expect("old launcher");
        assert!(matches!(refresh(&places, &bundle), Err(SetupError::NoLibrary(path)) if path.ends_with(LAUNCHER_FILE)));
        assert_eq!(std::fs::read(&places.bridge).expect("library"), b"old bridge");

        std::fs::write(bundle.join(LAUNCHER_FILE), b"new launcher").expect("launcher");
        assert!(refresh(&places, &bundle).expect("refresh"));
        assert_eq!(std::fs::read(&places.bridge).expect("library"), b"new bridge");
        assert_eq!(std::fs::read(&places.launcher).expect("launcher"), b"new launcher");
        let mode = std::fs::metadata(&places.launcher).expect("launcher").permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        // Once they are the app's, nothing is written.
        assert!(!refresh(&places, &bundle).expect("refresh again"));
        std::fs::remove_dir_all(&home).expect("clean up");
    }
}
