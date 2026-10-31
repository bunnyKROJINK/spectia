//! Java для Minecraft. Mojang сама выкладывает подходящие сборки Java
//! для каждой версии игры, их же использует официальный лаунчер.
//! Нужная Java скачивается один раз в папку runtime/ и дальше переиспользуется.

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::launch::Progress;
use crate::net;

const RUNTIMES_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86") => "windows-x86",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", _) => "windows-x64",
        ("macos", "aarch64") => "mac-os-arm64",
        ("macos", _) => "mac-os",
        ("linux", "x86") => "linux-i386",
        _ => "linux",
    }
}

/// Где лежит исполняемый файл Java внутри распакованной папки.
fn java_exe(home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        home.join("bin").join("javaw.exe")
    } else if cfg!(target_os = "macos") {
        home.join("jre.bundle").join("Contents").join("Home").join("bin").join("java")
    } else {
        home.join("bin").join("java")
    }
}

#[derive(Deserialize)]
struct RuntimeEntry {
    manifest: ManifestRef,
    version: RuntimeVersion,
}

#[derive(Deserialize)]
struct ManifestRef {
    url: String,
    sha1: Option<String>,
}

#[derive(Deserialize)]
struct RuntimeVersion {
    name: String,
}

#[derive(Deserialize)]
struct FileManifest {
    files: HashMap<String, FileEntry>,
}

#[derive(Deserialize)]
struct FileEntry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    executable: bool,
    #[serde(default)]
    downloads: Option<FileDownloads>,
}

#[derive(Deserialize)]
struct FileDownloads {
    raw: RawDownload,
}

#[derive(Deserialize)]
struct RawDownload {
    url: String,
    sha1: Option<String>,
    size: Option<u64>,
}

/// Возвращает путь к Java для нужного «компонента» (например, java-runtime-delta),
/// при необходимости скачивая её.
pub async fn ensure(data: &Path, component: &str, progress: &Progress) -> Result<PathBuf, String> {
    let home = data.join("runtime").join(component);
    let marker = home.join(".spectia-version");
    let exe = java_exe(&home);

    let all: HashMap<String, HashMap<String, Vec<RuntimeEntry>>> = match net::fetch_json(RUNTIMES_URL).await {
        Ok(all) => all,
        // Нет интернета, но Java уже скачана раньше — запускаем с ней.
        Err(_) if exe.exists() && marker.exists() => return Ok(exe),
        Err(e) => return Err(e),
    };
    let entry = all
        .get(platform_key())
        .and_then(|p| p.get(component))
        .and_then(|list| list.first())
        .ok_or_else(|| format!("Mojang не выкладывает Java «{component}» для этой системы"))?;

    let installed = std::fs::read_to_string(&marker).unwrap_or_default();
    if installed.trim() == entry.version.name && exe.exists() {
        return Ok(exe);
    }

    progress.stage("java", 0, 1);
    let manifest_bytes = net::fetch(&entry.manifest.url).await?;
    if let Some(expected) = &entry.manifest.sha1 {
        if net::sha1_hex(&manifest_bytes) != *expected {
            return Err("список файлов Java повреждён".into());
        }
    }
    let manifest: FileManifest = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for (rel, f) in &manifest.files {
        let path = home.join(rel);
        match f.kind.as_str() {
            "directory" => std::fs::create_dir_all(&path).map_err(|e| e.to_string())?,
            "file" => {
                if let Some(d) = &f.downloads {
                    files.push((d.raw.url.clone(), path, d.raw.sha1.clone(), d.raw.size, f.executable));
                }
            }
            // Ссылки (link) встречаются только на macOS/Linux, и Java работает без них.
            _ => {}
        }
    }

    let files: Vec<_> = files.into_iter().filter(|(_, p, s, z, _)| !net::is_present(p, s.as_deref(), *z)).collect();
    let total = files.len();
    let done = AtomicUsize::new(0);
    progress.stage("java", 0, total.max(1));
    let results: Vec<Result<(), String>> = stream::iter(files)
        .map(|(url, path, sha1, _size, executable)| {
            let done = &done;
            async move {
                net::download(&url, &path, sha1.as_deref()).await?;
                #[cfg(unix)]
                if executable {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
                }
                #[cfg(not(unix))]
                let _ = executable;
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                if n % 10 == 0 || n == total {
                    progress.stage("java", n, total);
                }
                Ok(())
            }
        })
        .buffer_unordered(16)
        .collect()
        .await;
    results.into_iter().collect::<Result<Vec<()>, String>>()?;

    std::fs::write(&marker, &entry.version.name).map_err(|e| e.to_string())?;
    if !exe.exists() {
        return Err("Java скачалась, но запускаемый файл не найден".into());
    }
    Ok(exe)
}
