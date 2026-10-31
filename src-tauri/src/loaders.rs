//! Загрузчики модов: Fabric, Quilt, Forge и NeoForge.
//!
//! • Fabric и Quilt простые: их сервер сразу отдаёт готовое описание версии.
//! • Forge и NeoForge сложнее: качаем их официальный установщик, достаём из него
//!   описание версии и библиотеки, а потом запускаем «процессоры» — маленькие
//!   программы, которые подготавливают файлы игры. Так же делает и сам установщик.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::game::{self, Library};
use crate::launch::Progress;
use crate::net;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const QUILT_META: &str = "https://meta.quiltmc.org/v3";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const NEOFORGE_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
    pub recommended: bool,
}

// ---------- Списки версий ----------

#[derive(Deserialize)]
struct MetaEntry {
    loader: MetaLoader,
}

#[derive(Deserialize)]
struct MetaLoader {
    version: String,
    #[serde(default)]
    stable: Option<bool>,
}

/// Номер версии NeoForge начинается с версии игры: 1.21.1 → "21.1.", 26.3 → "26.3.0."
pub fn neoforge_prefix(game: &str) -> Option<String> {
    let p: Vec<&str> = game.split('.').collect();
    match p.as_slice() {
        ["1", minor] => Some(format!("{minor}.0.")),
        ["1", minor, patch] => Some(format!("{minor}.{patch}.")),
        [year, drop] if year.parse::<u32>().ok()? >= 26 => Some(format!("{year}.{drop}.0.")),
        [year, drop, hotfix] if year.parse::<u32>().ok()? >= 26 => Some(format!("{year}.{drop}.{hotfix}.")),
        _ => None,
    }
}

/// Сравнивает версии вида 47.3.10 по числам, а не как строки.
fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let nums = |s: &str| -> Vec<u64> { s.split(|c: char| !c.is_ascii_digit()).filter_map(|x| x.parse().ok()).collect() };
    nums(a).cmp(&nums(b))
}

fn mark_recommended(mut list: Vec<LoaderVersion>) -> Vec<LoaderVersion> {
    if let Some(i) = list.iter().position(|v| v.stable).or(if list.is_empty() { None } else { Some(0) }) {
        list[i].recommended = true;
    }
    list
}

#[tauri::command]
pub async fn get_loader_versions(loader: String, game_version: String) -> Result<Vec<LoaderVersion>, String> {
    let list = match loader.as_str() {
        "fabric" | "quilt" => {
            let url = if loader == "fabric" {
                format!("{FABRIC_META}/versions/loader/{game_version}")
            } else {
                format!("{QUILT_META}/versions/loader/{game_version}")
            };
            let entries: Vec<MetaEntry> = net::fetch_json(&url).await?;
            entries
                .into_iter()
                .map(|e| {
                    let v = e.loader.version;
                    let stable = e.loader.stable.unwrap_or_else(|| !v.contains("beta") && !v.contains("pre") && !v.contains("rc"));
                    LoaderVersion { version: v, stable, recommended: false }
                })
                .collect()
        }
        "neoforge" => {
            #[derive(Deserialize)]
            struct Versions {
                versions: Vec<String>,
            }
            let Some(prefix) = neoforge_prefix(&game_version) else { return Ok(vec![]) };
            let all: Versions = net::fetch_json(NEOFORGE_VERSIONS).await?;
            let mut list: Vec<LoaderVersion> = all
                .versions
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .map(|v| LoaderVersion { stable: !v.contains("beta") && !v.contains("alpha"), version: v, recommended: false })
                .collect();
            list.sort_by(|a, b| version_cmp(&b.version, &a.version));
            // Если стабильной ещё нет (как сейчас у 26.3), рекомендуем самую свежую бету.
            list
        }
        "forge" => {
            let xml = String::from_utf8_lossy(&net::fetch(&format!("{FORGE_MAVEN}/maven-metadata.xml")).await?).into_owned();
            let prefix = format!("{game_version}-");
            let mut list: Vec<LoaderVersion> = xml
                .split("<version>")
                .skip(1)
                .filter_map(|chunk| chunk.split("</version>").next())
                .filter(|v| v.starts_with(&prefix))
                .map(|v| LoaderVersion { version: v.to_string(), stable: true, recommended: false })
                .collect();
            list.sort_by(|a, b| version_cmp(&b.version, &a.version));
            // У Forge есть официально «рекомендованная» версия — отметим её.
            #[derive(Deserialize)]
            struct Promos {
                promos: HashMap<String, String>,
            }
            if let Ok(p) = net::fetch_json::<Promos>(FORGE_PROMOS).await {
                let rec = p.promos.get(&format!("{game_version}-recommended")).or(p.promos.get(&format!("{game_version}-latest")));
                if let Some(rec) = rec {
                    let full = format!("{game_version}-{rec}");
                    if let Some(i) = list.iter().position(|v| v.version == full) {
                        list[i].recommended = true;
                        return Ok(list);
                    }
                }
            }
            list
        }
        _ => vec![],
    };
    Ok(mark_recommended(list))
}

/// Рекомендуемая версия загрузчика (когда в сборке версия не выбрана).
pub async fn recommended(loader: &str, game_version: &str) -> Result<String, String> {
    let list = get_loader_versions(loader.to_string(), game_version.to_string()).await?;
    list.iter()
        .find(|v| v.recommended)
        .or(list.first())
        .map(|v| v.version.clone())
        .ok_or_else(|| format!("NO_LOADER_FOR_VERSION:{loader}:{game_version}"))
}

// ---------- Установка ----------

/// Ставит загрузчик (если ещё не стоит) и возвращает id версии, которую надо запускать.
pub async fn install(data: &Path, loader: &str, game_version: &str, loader_version: &str, java: &Path, progress: &Progress) -> Result<String, String> {
    progress.stage("loader", 0, 1);
    match loader {
        "fabric" | "quilt" => {
            let id = format!("{loader}-loader-{loader_version}-{game_version}");
            let file = data.join("versions").join(&id).join(format!("{id}.json"));
            if !file.exists() {
                let url = if loader == "fabric" {
                    format!("{FABRIC_META}/versions/loader/{game_version}/{loader_version}/profile/json")
                } else {
                    format!("{QUILT_META}/versions/loader/{game_version}/{loader_version}/profile/json")
                };
                let bytes = net::fetch(&url).await?;
                // Проверяем, что это правильное описание, и сохраняем под нашим id
                let mut json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("{loader}: {e}"))?;
                json["id"] = serde_json::Value::String(id.clone());
                std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
                std::fs::write(&file, serde_json::to_vec_pretty(&json).unwrap()).map_err(|e| e.to_string())?;
            }
            Ok(id)
        }
        "forge" | "neoforge" => install_forgelike(data, loader, game_version, loader_version, java, progress).await,
        other => Err(format!("неизвестный загрузчик {other}")),
    }
}

async fn install_forgelike(data: &Path, loader: &str, game_version: &str, loader_version: &str, java: &Path, progress: &Progress) -> Result<String, String> {
    let marker_dir = data.join("loaders");
    let marker = marker_dir.join(format!("{loader}-{loader_version}.installed"));
    if let Ok(id) = std::fs::read_to_string(&marker) {
        if data.join("versions").join(id.trim()).join(format!("{}.json", id.trim())).exists() {
            return Ok(id.trim().to_string());
        }
    }

    // 1. Установщик
    let url = if loader == "forge" {
        format!("{FORGE_MAVEN}/{v}/forge-{v}-installer.jar", v = loader_version)
    } else {
        format!("{NEOFORGE_MAVEN}/{v}/neoforge-{v}-installer.jar", v = loader_version)
    };
    let installer = data.join("cache").join("installers").join(format!("{loader}-{loader_version}-installer.jar"));
    if !installer.exists() {
        net::download(&url, &installer, None).await?;
    }
    let libraries = data.join("libraries");
    let mut zip = open_zip(&installer)?;

    // Библиотеки, вложенные прямо в установщик (папка maven/)
    extract_prefix(&mut zip, "maven/", &libraries)?;

    let profile: serde_json::Value = serde_json::from_slice(&read_entry(&mut zip, "install_profile.json")?).map_err(|e| format!("install_profile: {e}"))?;

    // ----- Старый формат (Forge до 1.13, например 1.12.2) -----
    if let Some(info) = profile.get("versionInfo") {
        let mut info = info.clone();
        let id = info["id"].as_str().unwrap_or(loader_version).to_string();
        if info.get("inheritsFrom").is_none() {
            info["inheritsFrom"] = serde_json::Value::String(game_version.to_string());
        }
        info["jar"] = serde_json::Value::String(game_version.to_string());
        // Сам Forge лежит внутри установщика
        if let (Some(path), Some(file)) = (profile["install"]["path"].as_str(), profile["install"]["filePath"].as_str()) {
            if let Some(rel) = game::maven_path(path) {
                let dst = libraries.join(rel);
                if !dst.exists() {
                    write_file(&dst, &read_entry(&mut zip, file)?)?;
                }
            }
        }
        // Библиотеки, которые нужны только серверу, игре не нужны
        if let Some(libs) = info["libraries"].as_array_mut() {
            libs.retain(|l| l.get("clientreq").and_then(|c| c.as_bool()).unwrap_or(true));
            for l in libs.iter_mut() {
                if l.get("url").is_none() && l.get("downloads").is_none() {
                    l["url"] = serde_json::Value::String("https://libraries.minecraft.net/".into());
                }
            }
        }
        save_version(data, &id, &info)?;
        std::fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
        std::fs::write(&marker, &id).map_err(|e| e.to_string())?;
        return Ok(id);
    }

    // ----- Современный формат -----
    let version_json: serde_json::Value =
        serde_json::from_slice(&read_entry(&mut zip, profile["json"].as_str().unwrap_or("/version.json").trim_start_matches('/'))?)
            .map_err(|e| format!("version.json: {e}"))?;
    let id = version_json["id"].as_str().ok_or("в установщике нет id версии")?.to_string();

    // 2. Обычная версия игры (нужен её client.jar)
    let vanilla = game::load_version(data, game_version).await?;
    let client_jar = data.join("versions").join(game_version).join(format!("{game_version}.jar"));
    if let Some(c) = vanilla.downloads.as_ref().and_then(|d| d.client.clone()) {
        if !net::is_present(&client_jar, c.sha1.as_deref(), c.size) {
            net::download(&c.url, &client_jar, c.sha1.as_deref()).await?;
        }
    }

    // 3. Библиотеки для процессоров
    let profile_libs: Vec<Library> = serde_json::from_value(profile["libraries"].clone()).unwrap_or_default();
    download_libraries(&profile_libs, &libraries, progress).await?;

    // 4. Данные для процессоров
    let tmp = data.join("cache").join("installer-data").join(format!("{loader}-{loader_version}"));
    let mut vars: HashMap<String, String> = HashMap::new();
    if let Some(map) = profile["data"].as_object() {
        for (key, val) in map {
            let Some(v) = val.get("client").and_then(|c| c.as_str()) else { continue };
            let resolved = if v.starts_with('[') && v.ends_with(']') {
                lib_path(&libraries, &v[1..v.len() - 1])?
            } else if v.starts_with('\'') && v.ends_with('\'') {
                v[1..v.len() - 1].to_string()
            } else if v.starts_with('/') {
                let out = tmp.join(v.trim_start_matches('/'));
                write_file(&out, &read_entry(&mut zip, v.trim_start_matches('/'))?)?;
                out.to_string_lossy().into_owned()
            } else {
                v.to_string()
            };
            vars.insert(key.clone(), resolved);
        }
    }
    vars.insert("SIDE".into(), "client".into());
    vars.insert("MINECRAFT_JAR".into(), client_jar.to_string_lossy().into_owned());
    vars.insert("MINECRAFT_VERSION".into(), game_version.into());
    vars.insert("ROOT".into(), data.to_string_lossy().into_owned());
    vars.insert("INSTALLER".into(), installer.to_string_lossy().into_owned());
    vars.insert("LIBRARY_DIR".into(), libraries.to_string_lossy().into_owned());

    // 5. Процессоры
    let processors = profile["processors"].as_array().cloned().unwrap_or_default();
    let client_procs: Vec<&serde_json::Value> = processors
        .iter()
        .filter(|p| p.get("sides").and_then(|s| s.as_array()).map(|s| s.iter().any(|x| x == "client")).unwrap_or(true))
        .collect();
    let total = client_procs.len();
    for (n, proc) in client_procs.into_iter().enumerate() {
        progress.stage("loader", n, total.max(1));
        run_processor(proc, &libraries, &vars, java)?;
    }

    // 6. Готово: сохраняем описание версии
    save_version(data, &id, &version_json)?;
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
    std::fs::write(&marker, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

fn run_processor(proc: &serde_json::Value, libraries: &Path, vars: &HashMap<String, String>, java: &Path) -> Result<(), String> {
    let jar_name = proc["jar"].as_str().ok_or("у процессора нет jar")?;
    let jar = PathBuf::from(lib_path(libraries, jar_name)?);

    // Если все результаты уже есть и совпадают — пропускаем
    if let Some(outputs) = proc.get("outputs").and_then(|o| o.as_object()) {
        if !outputs.is_empty()
            && outputs.iter().all(|(file, hash)| {
                let file = substitute(file, libraries, vars).unwrap_or_default();
                let hash = substitute(hash.as_str().unwrap_or(""), libraries, vars).unwrap_or_default();
                std::fs::read(&file).map(|b| net::sha1_hex(&b) == hash.trim_matches('\'')).unwrap_or(false)
            })
        {
            return Ok(());
        }
    }

    let mut classpath = vec![jar.clone()];
    for cp in proc["classpath"].as_array().cloned().unwrap_or_default() {
        if let Some(name) = cp.as_str() {
            classpath.push(PathBuf::from(lib_path(libraries, name)?));
        }
    }
    let main_class = main_class_of(&jar)?;
    let mut args = Vec::new();
    for a in proc["args"].as_array().cloned().unwrap_or_default() {
        args.push(substitute(a.as_str().unwrap_or(""), libraries, vars)?);
    }

    let sep = if cfg!(windows) { ";" } else { ":" };
    let cp = classpath.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>().join(sep);
    let mut cmd = Command::new(java);
    cmd.arg("-cp").arg(cp).arg(&main_class).args(&args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("не смогли запустить установщик загрузчика: {e}"))?;
    if !out.status.success() {
        let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = text.lines().rev().take(25).collect();
        return Err(format!(
            "LOADER_INSTALL_FAILED: {main_class}\n{}",
            tail.into_iter().rev().collect::<Vec<_>>().join("\n")
        ));
    }
    Ok(())
}

/// Подставляет {КЛЮЧ} из data и [библиотека] → путь к файлу.
fn substitute(s: &str, libraries: &Path, vars: &HashMap<String, String>) -> Result<String, String> {
    if s.starts_with('[') && s.ends_with(']') {
        return lib_path(libraries, &s[1..s.len() - 1]);
    }
    if s.starts_with('{') && s.ends_with('}') {
        let key = &s[1..s.len() - 1];
        return vars.get(key).cloned().ok_or_else(|| format!("установщик просит неизвестное значение {key}"));
    }
    // Внутри строки тоже могут встретиться {КЛЮЧИ}
    let mut out = s.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    Ok(out)
}

fn lib_path(libraries: &Path, name: &str) -> Result<String, String> {
    let rel = game::maven_path(name).ok_or_else(|| format!("странное имя библиотеки {name}"))?;
    Ok(libraries.join(rel).to_string_lossy().into_owned())
}

async fn download_libraries(libs: &[Library], libraries: &Path, progress: &Progress) -> Result<(), String> {
    let total = libs.len();
    for (n, lib) in libs.iter().enumerate() {
        if n % 5 == 0 {
            progress.stage("loader", n, total.max(1));
        }
        let artifact = lib.downloads.as_ref().and_then(|d| d.artifact.clone());
        let (url, rel, sha1, size) = match artifact {
            Some(a) => (a.url.clone(), a.path.clone().or_else(|| game::maven_path(&lib.name)), a.sha1.clone(), a.size),
            None => {
                let rel = game::maven_path(&lib.name);
                let base = lib.url.clone().unwrap_or_else(|| "https://libraries.minecraft.net/".into());
                (rel.as_ref().map(|r| format!("{}/{}", base.trim_end_matches('/'), r)).unwrap_or_default(), rel, lib.sha1.clone(), lib.size)
            }
        };
        let Some(rel) = rel else { continue };
        let path = libraries.join(rel);
        if url.is_empty() || net::is_present(&path, sha1.as_deref(), size) {
            continue;
        }
        net::download(&url, &path, sha1.as_deref()).await?;
    }
    Ok(())
}

fn save_version(data: &Path, id: &str, json: &serde_json::Value) -> Result<(), String> {
    let file = data.join("versions").join(id).join(format!("{id}.json"));
    write_file(&file, &serde_json::to_vec_pretty(json).map_err(|e| e.to_string())?)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

fn open_zip(path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    zip::ZipArchive::new(f).map_err(|e| format!("{}: {e}", path.display()))
}

fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = zip.by_name(name).map_err(|_| format!("в установщике нет файла {name}"))?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn extract_prefix(zip: &mut zip::ZipArchive<std::fs::File>, prefix: &str, to: &Path) -> Result<(), String> {
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if entry.is_dir() || !name.starts_with(prefix) || name.contains("..") {
            continue;
        }
        let out = to.join(&name[prefix.len()..]);
        if out.exists() {
            continue;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        write_file(&out, &buf)?;
    }
    Ok(())
}

/// Главный класс программы берётся из META-INF/MANIFEST.MF внутри jar.
fn main_class_of(jar: &Path) -> Result<String, String> {
    let mut zip = open_zip(jar)?;
    let manifest = String::from_utf8_lossy(&read_entry(&mut zip, "META-INF/MANIFEST.MF")?).into_owned();
    manifest
        .lines()
        .find_map(|l| l.strip_prefix("Main-Class:"))
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("в {} не указан Main-Class", jar.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neoforge_prefixes() {
        assert_eq!(neoforge_prefix("1.21.1").unwrap(), "21.1.");
        assert_eq!(neoforge_prefix("1.21").unwrap(), "21.0.");
        assert_eq!(neoforge_prefix("26.3").unwrap(), "26.3.0.");
        assert_eq!(neoforge_prefix("26.1.2").unwrap(), "26.1.2.");
        assert!(neoforge_prefix("b1.7.3").is_none());
    }

    #[test]
    fn version_order() {
        assert_eq!(version_cmp("47.3.10", "47.3.9"), std::cmp::Ordering::Greater);
        assert_eq!(version_cmp("26.3.0.45-beta", "26.3.0.3-beta"), std::cmp::Ordering::Greater);
    }
}
