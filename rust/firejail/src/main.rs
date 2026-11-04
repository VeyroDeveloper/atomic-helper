use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, Read};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
struct Request {
    command: String,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    options: Options,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
struct Options {
    network: bool,
    sound: bool,
    camera: bool,
    downloads: bool,
    documents: bool,
    media: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self { network: true, sound: true, camera: false, downloads: false, documents: false, media: false }
    }
}

#[derive(Serialize)]
struct Envelope<T: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct AppInfo {
    file: String,
    name: String,
    kind: &'static str,
    size: u64,
    options: Options,
}

#[derive(Serialize)]
struct LaunchInfo {
    message: String,
}

fn respond<T: Serialize>(result: Result<T, String>) {
    let envelope = match result {
        Ok(data) => Envelope { ok: true, data: Some(data), error: None },
        Err(error) => Envelope::<serde_json::Value> { ok: false, data: None, error: Some(error) },
    };
    println!("{}", serde_json::to_string(&envelope).unwrap_or_else(|_| "{\"ok\":false,\"error\":\"serialization failed\"}".into()));
}

fn app_info(file: &str) -> Result<AppInfo, String> {
    if file.is_empty() || file.contains(['\0', '\n', '\r']) {
        return Err("Choose a valid application file.".into());
    }
    let path = Path::new(file).canonicalize().map_err(|_| "The selected file could not be opened.".to_string())?;
    let metadata = fs::metadata(&path).map_err(|_| "The selected file could not be inspected.".to_string())?;
    if !metadata.is_file() { return Err("Choose a file, not a folder.".into()); }
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("This file is not executable. Mark it executable in Files, then analyze it again.".into());
    }
    let mut magic = [0u8; 4];
    use std::io::Read as _;
    let mut input = fs::File::open(&path).map_err(|_| "The selected file could not be read.".to_string())?;
    input.read_exact(&mut magic).map_err(|_| "The selected file is too small to be an application.".to_string())?;
    if magic != [0x7f, b'E', b'L', b'F'] { return Err("The selected file is not a Linux ELF executable or AppImage.".into()); }

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("App");
    let mut name = file_name.to_string();
    if name.to_ascii_lowercase().ends_with(".appimage") { name.truncate(name.len() - 9); }
    for suffix in ["x86_64", "aarch64", "amd64", "x64", "linux"] {
        name = name.replace(suffix, " ").replace(&suffix.to_ascii_uppercase(), " ");
    }
    let name = name.trim_matches(|c: char| c == '-' || c == '_' || c == '.' || c.is_whitespace()).to_string();
    let name = if name.is_empty() { "App".to_string() } else { name };
    let lower = name.to_ascii_lowercase();
    let mut options = Options::default();
    if lower.contains("prism") || lower.contains("discord") { options.network = true; options.sound = true; }
    if lower.contains("vlc") { options.sound = true; options.media = true; }
    Ok(AppInfo {
        file: path.to_string_lossy().into_owned(),
        name,
        kind: if file_name.to_ascii_lowercase().ends_with(".appimage") { "appimage" } else { "program" },
        size: metadata.len(),
        options,
    })
}

fn safe_slug(name: &str) -> String {
    let slug: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(char::to_lowercase).take(64).collect();
    if slug.is_empty() { "app".into() } else { slug }
}

fn build_args(info: &AppInfo, options: &Options) -> Result<Vec<String>, String> {
    let home = env::var_os("HOME").map(PathBuf::from).ok_or("Could not find your home directory.")?;
    let data = home.join(".local/share/firejail-helper").join(safe_slug(&info.name));
    for part in ["config", "data", "cache", "state"] {
        fs::create_dir_all(data.join(part)).map_err(|_| "Could not prepare the app's private data directory.".to_string())?;
    }

    let mut args = vec!["--noroot".into(), "--nonewprivs".into(), "--caps.drop=all".into(), "--seccomp".into(), "--private-tmp".into()];
    // Give each app an isolated home directory, rather than exposing the user's real home.
    args.push(format!("--private={}", data.display()));
    if info.kind == "appimage" { args.push("--appimage".into()); }
    if !options.network { args.push("--net=none".into()); }
    if !options.sound { args.push("--nosound".into()); }
    if !options.camera { args.push("--novideo".into()); }

    for (enabled, dirs) in [
        (options.downloads, vec!["Downloads"]),
        (options.documents, vec!["Documents"]),
        (options.media, vec!["Pictures", "Music", "Videos"]),
    ] {
        if enabled {
            for dir in dirs {
                let candidate = home.join(dir);
                if candidate.is_dir() {
                    let canonical = candidate.canonicalize().map_err(|_| format!("Could not resolve the {dir} folder."))?;
                    args.push(format!("--whitelist={}", canonical.display()));
                }
            }
        }
    }
    for (key, part) in [("CONFIG", "config"), ("DATA", "data"), ("CACHE", "cache"), ("STATE", "state")] {
        args.push(format!("--env=XDG_{key}_HOME={}", data.join(part).display()));
    }
    args.push(info.file.clone());
    Ok(args)
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c)) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn firejail_exists() -> bool {
    Command::new("firejail").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

fn run(request: Request) -> Result<serde_json::Value, String> {
    match request.command.as_str() {
        "status" => Ok(serde_json::json!({"installed": firejail_exists()})),
        "analyze" | "preview" | "launch" => {
            let file = request.file.as_deref().ok_or("Choose an application file first.")?;
            let info = app_info(file)?;
            if request.command == "analyze" { return serde_json::to_value(info).map_err(|e| e.to_string()); }
            let args = build_args(&info, &request.options)?;
            if request.command == "preview" {
                let command = std::iter::once("firejail".to_string()).chain(args.iter().cloned()).map(|s| shell_quote(&s)).collect::<Vec<_>>().join(" ");
                return Ok(serde_json::json!({"command": command}));
            }
            if !firejail_exists() { return Err("Firejail is not installed. Install it with rpm-ostree, then restart your computer.".into()); }
            let mut child = Command::new("firejail").args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
                .map_err(|e| if e.kind() == io::ErrorKind::NotFound { "Firejail is not installed.".into() } else { format!("Could not start Firejail: {e}") })?;
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(1200) {
                if let Some(status) = child.try_wait().map_err(|e| format!("Could not check the sandbox process: {e}"))? {
                    return Err(format!("The app stopped during startup (exit status {status}). Check that Firejail supports this app."));
                }
                thread::sleep(Duration::from_millis(50));
            }
            // Do not wait for the sandboxed desktop application; it should outlive this helper.
            drop(child);
            Ok(serde_json::to_value(LaunchInfo { message: format!("{} is running in the Firejail sandbox.", info.name) }).unwrap())
        }
        _ => Err("Unsupported sandbox operation.".into()),
    }
}

fn main() {
    let mut input = String::new();
    if io::stdin().take(64 * 1024).read_to_string(&mut input).is_err() {
        respond::<serde_json::Value>(Err("Could not read the sandbox request.".into()));
        std::process::exit(1);
    }
    let request = match serde_json::from_str::<Request>(&input) {
        Ok(request) => request,
        Err(_) => {
            respond::<serde_json::Value>(Err("Invalid sandbox request.".into()));
            std::process::exit(1);
        }
    };
    match run(request) {
        Ok(data) => { println!("{}", serde_json::json!({"ok": true, "data": data})); }
        Err(error) => {
            println!("{}", serde_json::json!({"ok": false, "error": error}));
            std::process::exit(1);
        }
    }
}
