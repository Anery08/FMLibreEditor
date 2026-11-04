//! `fmlibre-launch`: how Steam starts Football Manager on macOS with the bridge.
//!
//! Steam on macOS runs no shell for a launch option: it starts the option's first word as a
//! program, with `%command%`, the game's app bundle, among its arguments. So FM27's launch
//! option is `'…/fmlibre-launch' %command%`. This program puts the bridge beside it in front
//! of the libraries named in `DYLD_INSERT_LIBRARIES`, keeping those Steam names, and then
//! becomes the game, so that Steam goes on following the process it started. When the bridge
//! is not beside it, the game starts as it is.
//!
//! Steam starts a launch option's program preferring Intel code (x86_64 first, then arm64), so
//! the editor installs only this program's part for the Mac's own architecture (see
//! `fmlibre_core::bridge_setup`): the Intel part of the universal one would need Rosetta on
//! Apple silicon. Started as Intel code all the same, a program that merely `exec`s a universal
//! game would keep the game there too. So the game is started with the Mac's own architecture
//! first, as Steam starts it without a launch option.
//!
//! The release build is signed with Apple's hardened runtime, and dyld takes every `DYLD_*`
//! variable out of the environment of such a program before it runs. The ones Steam sets (its
//! loader and its overlay, in `DYLD_INSERT_LIBRARIES`) are meant for the game, so they are read
//! back from the kernel's copy of the environment this program was started with.

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    use std::path::Path;

    let mut args = std::env::args_os().skip(1);
    let Some(program) = args.next() else {
        eprintln!("usage: fmlibre-launch <app or program> [arguments]");
        return std::process::ExitCode::FAILURE;
    };
    let program = mac::executable(Path::new(&program));
    let environment = mac::environment();
    let libraries = mac::libraries(&environment);
    // Only returns when the game could not be started.
    let err = mac::become_program(&program, args.collect(), environment, libraries);
    eprintln!("fmlibre-launch: could not start {}: {err}", program.display());
    std::process::ExitCode::FAILURE
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{CString, OsString, c_char, c_int};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    const INSERT: &str = "DYLD_INSERT_LIBRARIES";

    const BRIDGE_FILE: &str = "libfmlibre_bridge.dylib";

    /// `cpu_type_t` of arm64 and x86_64, in the order the game's architecture is chosen.
    const NATIVE_FIRST: [c_int; 2] = [0x0100_000C, 0x0100_0007];

    /// The bridge beside this program first, then the libraries `environment` names already.
    pub fn libraries(environment: &[(OsString, OsString)]) -> Option<OsString> {
        let bridge = std::env::current_exe().ok()?.parent()?.join(BRIDGE_FILE);
        if !bridge.is_file() {
            return None;
        }
        let mut libraries = bridge.into_os_string();
        if let Some((_, others)) = environment.iter().find(|(key, value)| key == INSERT && !value.is_empty()) {
            libraries.push(":");
            libraries.push(others);
        }
        Some(libraries)
    }

    /// The environment this program was started with: its own, and the `DYLD_*` variables dyld
    /// took out of it because the program has the hardened runtime.
    pub fn environment() -> Vec<(OsString, OsString)> {
        let mut environment: Vec<(OsString, OsString)> = std::env::vars_os().collect();
        let taken: Vec<_> = started_with()
            .into_iter()
            .filter(|(key, _)| key.as_bytes().starts_with(b"DYLD_") && !environment.iter().any(|(own, _)| own == key))
            .collect();
        environment.extend(taken);
        environment
    }

    /// The variables of the environment the kernel keeps from when this program was started
    /// (`KERN_PROCARGS2`), which dyld does not change; none when it cannot be read.
    fn started_with() -> Vec<(OsString, OsString)> {
        let mut name = [libc::CTL_KERN, libc::KERN_PROCARGS2, std::process::id() as c_int];
        let mut size = 0;
        let null = std::ptr::null_mut();
        if unsafe { libc::sysctl(name.as_mut_ptr(), 3, null, &mut size, null, 0) } != 0 {
            return Vec::new();
        }
        let mut buffer = vec![0u8; size];
        if unsafe { libc::sysctl(name.as_mut_ptr(), 3, buffer.as_mut_ptr().cast(), &mut size, null, 0) } != 0 {
            return Vec::new();
        }
        buffer.truncate(size);
        variables(&buffer)
    }

    /// The environment's variables in a `KERN_PROCARGS2` buffer: the argument count, the
    /// executable's path and the padding after it, the arguments, then the variables up to an
    /// empty string.
    pub(crate) fn variables(buffer: &[u8]) -> Vec<(OsString, OsString)> {
        let Some((count, strings)) = buffer.split_first_chunk::<4>() else {
            return Vec::new();
        };
        let count = usize::try_from(i32::from_ne_bytes(*count)).unwrap_or(0);
        let mut strings = strings.split(|&byte| byte == 0);
        strings.next();
        strings
            .skip_while(|string| string.is_empty())
            .skip(count)
            .take_while(|string| !string.is_empty())
            .filter_map(|string| {
                let equals = string.iter().position(|&byte| byte == b'=')?;
                let (key, value) = (&string[..equals], &string[equals + 1..]);
                Some((OsString::from_vec(key.to_vec()), OsString::from_vec(value.to_vec())))
            })
            .collect()
    }

    /// The executable of an app bundle; any other path as it is.
    pub fn executable(path: &Path) -> PathBuf {
        if path.extension().is_some_and(|extension| extension == "app")
            && let Some(name) = bundle_executable(path)
        {
            return path.join("Contents/MacOS").join(name);
        }
        path.to_owned()
    }

    /// The `CFBundleExecutable` of `app`'s Info.plist, or the only file in `Contents/MacOS`.
    fn bundle_executable(app: &Path) -> Option<OsString> {
        let named = std::fs::read_to_string(app.join("Contents/Info.plist")).ok().and_then(|text| {
            let after = &text[text.find("<key>CFBundleExecutable</key>")?..];
            let start = after.find("<string>")? + "<string>".len();
            let end = start + after[start..].find("</string>")?;
            Some(OsString::from(after[start..end].trim()))
        });
        named.or_else(|| {
            let mut files = std::fs::read_dir(app.join("Contents/MacOS")).ok()?.flatten();
            let only = files.next()?;
            files.next().is_none().then(|| only.file_name())
        })
    }

    /// Replaces this process with `program`, as `exec` does, but the Mac's own architecture
    /// first, in `environment`, with `libraries` in `DYLD_INSERT_LIBRARIES` when there are any.
    /// Returns only on failure.
    pub fn become_program(
        program: &Path,
        args: Vec<OsString>,
        environment: Vec<(OsString, OsString)>,
        libraries: Option<OsString>,
    ) -> std::io::Error {
        let c_string = |text: OsString| CString::new(text.into_vec()).map_err(std::io::Error::other);
        let mut words = vec![program.as_os_str().to_owned()];
        words.extend(args);
        let mut environment: Vec<OsString> = environment
            .into_iter()
            .filter(|(key, _)| libraries.is_none() || key != INSERT)
            .map(|(key, value)| [key, OsString::from("="), value].into_iter().collect())
            .collect();
        if let Some(libraries) = libraries {
            environment.push([OsString::from(INSERT), OsString::from("="), libraries].into_iter().collect());
        }
        let (path, argv, envp) = match (
            CString::new(program.as_os_str().as_bytes()).map_err(std::io::Error::other),
            words.into_iter().map(c_string).collect::<Result<Vec<_>, _>>(),
            environment.into_iter().map(c_string).collect::<Result<Vec<_>, _>>(),
        ) {
            (Ok(path), Ok(argv), Ok(envp)) => (path, argv, envp),
            (Err(err), ..) | (_, Err(err), _) | (.., Err(err)) => return err,
        };
        let pointers = |strings: &[CString]| -> Vec<*mut c_char> {
            strings.iter().map(|s| s.as_ptr().cast_mut()).chain(std::iter::once(std::ptr::null_mut())).collect()
        };
        let (argv, envp) = (pointers(&argv), pointers(&envp));

        let mut attributes: libc::posix_spawnattr_t = std::ptr::null_mut();
        let code = unsafe { libc::posix_spawnattr_init(&mut attributes) };
        if code != 0 {
            return std::io::Error::from_raw_os_error(code);
        }
        let mut preference = NATIVE_FIRST;
        let mut taken = 0;
        let code = unsafe {
            libc::posix_spawnattr_setflags(&mut attributes, libc::POSIX_SPAWN_SETEXEC as libc::c_short);
            libc::posix_spawnattr_setbinpref_np(&mut attributes, preference.len(), preference.as_mut_ptr(), &mut taken);
            let mut pid = 0;
            libc::posix_spawn(&mut pid, path.as_ptr(), std::ptr::null(), &attributes, argv.as_ptr(), envp.as_ptr())
        };
        unsafe { libc::posix_spawnattr_destroy(&mut attributes) };
        std::io::Error::from_raw_os_error(code)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::ffi::OsString;

    #[test]
    fn variables_follow_the_arguments() {
        let mut buffer = 2i32.to_ne_bytes().to_vec();
        buffer.extend_from_slice(b"/Applications/fm.app/Contents/MacOS/fm\0\0\0\0");
        buffer.extend_from_slice(b"/path/fmlibre-launch\0DYLD_LOOKS=like a variable\0");
        buffer.extend_from_slice(b"HOME=/Users/t\0DYLD_INSERT_LIBRARIES=/a.dylib:/b.dylib\0\0");
        buffer.extend_from_slice(b"executable_path=/path\0");
        let pair = |key: &str, value: &str| (OsString::from(key), OsString::from(value));
        assert_eq!(
            super::mac::variables(&buffer),
            vec![pair("HOME", "/Users/t"), pair("DYLD_INSERT_LIBRARIES", "/a.dylib:/b.dylib")]
        );
    }

    #[test]
    fn a_short_buffer_has_no_variables() {
        assert!(super::mac::variables(&[1, 0]).is_empty());
    }
}
