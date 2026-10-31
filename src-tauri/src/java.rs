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
pub async fn ensure(data: &Path, component: &str, major: Option<u32>, progress: &Progress) -> Result<PathBuf, String> {
    let home = data.join("runtime").join(component);
    let marker = home.join(".spectia-version");
    let exe = java_exe(&home);

    // Java уже скачана раньше — запускаем сразу, не спрашивая Mojang каждый раз.
    if exe.exists() && marker.exists() {
        return Ok(exe);
    }
    // Подходящая Java уже стоит на компьютере (от Prism, ElyPrism или установленная вручную) —
    // берём её и ничего не качаем.
    if let Some(major) = major {
        if let Some(found) = find_installed(major) {
            return Ok(found);
        }
    }

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
                if n % 2 == 0 || n == total {
                    progress.stage("java", n, total);
                }
                Ok(())
            }
        })
        .buffer_unordered(net::parallel())
        .collect()
        .await;
    results.into_iter().collect::<Result<Vec<()>, String>>()?;

    std::fs::write(&marker, &entry.version.name).map_err(|e| e.to_string())?;
    if !exe.exists() {
        return Err("Java скачалась, но запускаемый файл не найден".into());
    }
    Ok(exe)
}

// ---------- Поиск уже установленной Java ----------

/// Главная версия Java из файла `release` (JAVA_VERSION="17.0.8" → 17, "1.8.0_392" → 8)
fn release_major(home: &Path) -> Option<(u32, String)> {
    let text = std::fs::read_to_string(home.join("release")).ok()?;
    let mut version = None;
    let mut arch = String::new();
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("JAVA_VERSION=") {
            version = Some(v.trim().trim_matches('"').to_string());
        } else if let Some(a) = line.strip_prefix("OS_ARCH=") {
            arch = a.trim().trim_matches('"').to_lowercase();
        }
    }
    let version = version?;
    let mut parts = version.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty());
    let first: u32 = parts.next()?.parse().ok()?;
    let major = if first == 1 { parts.next()?.parse().ok()? } else { first };
    Some((major, arch))
}

fn arch_ok(arch: &str) -> bool {
    if arch.is_empty() {
        return true;
    }
    let want_64 = cfg!(target_pointer_width = "64");
    let is_32 = matches!(arch, "x86" | "i386" | "i586" | "i686");
    let is_arm = arch.contains("aarch64") || arch.contains("arm");
    if is_arm != cfg!(target_arch = "aarch64") {
        return false;
    }
    !(want_64 && is_32)
}

fn plain_exe(home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        home.join("bin").join("javaw.exe")
    } else {
        home.join("bin").join("java")
    }
}

/// Папки, где обычно лежит Java: Prism / ElyPrism, JAVA_HOME, стандартные установщики.
fn search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let home = env("HOME").or_else(|| env("USERPROFILE"));
    let cfg_dir = env("APPDATA").or_else(|| home.as_ref().map(|h| h.join(".local/share")));
    if let Some(cfg) = cfg_dir {
        for name in ["PrismLauncher", "ElyPrismLauncher", "ElyPrism", "PolyMC", "MultiMC"] {
            roots.push(cfg.join(name).join("java"));
        }
    }
    if let Some(local) = env("LOCALAPPDATA") {
        for name in ["PrismLauncher", "ElyPrismLauncher"] {
            roots.push(local.join(name).join("java"));
        }
    }
    if let Some(home) = home {
        roots.push(home.join(".jdks"));
    }
    if cfg!(target_os = "windows") {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            for v in ["Eclipse Adoptium", "Java", "Zulu", "Microsoft", "BellSoft", "Amazon Corretto"] {
                roots.push(Path::new(&pf).join(v));
            }
        }
    } else {
        roots.push(PathBuf::from("/usr/lib/jvm"));
        roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    }
    roots
}

fn scan(dir: &Path, depth: u32, major: u32, out: &mut Option<PathBuf>) {
    if out.is_some() || depth > 3 {
        return;
    }
    if let Some((m, arch)) = release_major(dir) {
        let exe = plain_exe(dir);
        if m == major && arch_ok(&arch) && exe.exists() {
            *out = Some(exe);
        }
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            scan(&p, depth + 1, major, out);
            if out.is_some() {
                return;
            }
        }
    }
}

pub fn find_installed(major: u32) -> Option<PathBuf> {
    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let jh = PathBuf::from(jh);
        if let Some((m, arch)) = release_major(&jh) {
            if m == major && arch_ok(&arch) && plain_exe(&jh).exists() {
                return Some(plain_exe(&jh));
            }
        }
    }
    let mut found = None;
    for root in search_roots() {
        if root.is_dir() {
            scan(&root, 0, major, &mut found);
            if found.is_some() {
                break;
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_java_major_from_release() {
        let dir = std::env::temp_dir().join(format!("spectia-java-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("release"), "IMPLEMENTOR=\"Eclipse Adoptium\"\nJAVA_VERSION=\"17.0.8\"\nOS_ARCH=\"x86_64\"\n").unwrap();
        assert_eq!(release_major(&dir).map(|r| r.0), Some(17));
        std::fs::write(dir.join("release"), "JAVA_VERSION=\"1.8.0_392\"\n").unwrap();
        assert_eq!(release_major(&dir).map(|r| r.0), Some(8));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn speed_modes() {
        crate::net::set_speed("turbo");
        assert_eq!(crate::net::parallel(), 64);
        crate::net::set_speed("normal");
        assert_eq!(crate::net::parallel(), 16);
    }
}
