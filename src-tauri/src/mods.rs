//! Список модов сборки: читаем названия прямо из .jar, включаем/выключаем,
//! удаляем и добавляем новые (перетаскиванием в окно).
//!
//! Выключенный мод — это просто файл с окончанием .jar.disabled: игра его не видит,
//! но он никуда не пропадает. Так же делают Prism и MultiMC.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{history, instances, modrinth};

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub file: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub authors: String,
    pub enabled: bool,
    pub size: u64,
    /// Когда файл появился в папке (секунды с 1970 года)
    pub added: u64,
    /// Проект на Modrinth, если мод ставили оттуда
    pub project_id: String,
}

fn mods_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = instances::dir(app, id)?.join("minecraft").join("mods");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Имя файла должно быть просто именем, без папок — защита от «../».
fn safe_file(dir: &Path, file: &str) -> Result<PathBuf, String> {
    if file.is_empty() || file.contains(['/', '\\']) || file.contains("..") {
        return Err("неправильное имя файла".into());
    }
    Ok(dir.join(file))
}

#[tauri::command]
pub fn list_mods(app: AppHandle, id: String) -> Result<Vec<ModInfo>, String> {
    let dir = mods_dir(&app, &id)?;
    let inst_dir = instances::dir(&app, &id)?;
    history::detect_external(&inst_dir);
    let index = modrinth::read_index(&inst_dir);
    let mut list = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        let lower = file.to_lowercase();
        let enabled = lower.ends_with(".jar");
        if !enabled && !lower.ends_with(".jar.disabled") {
            continue;
        }
        let mut info = read_metadata(&entry.path());
        info.file = file.clone();
        info.enabled = enabled;
        let meta = entry.metadata().ok();
        info.size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        info.added = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        info.project_id = index.get(&format!("mods/{}", file.trim_end_matches(".disabled"))).map(|e| e.project_id.clone()).unwrap_or_default();
        if info.name.is_empty() {
            info.name = file.trim_end_matches(".disabled").trim_end_matches(".jar").to_string();
        }
        list.push(info);
    }
    list.sort_by_key(|m| m.name.to_lowercase());
    Ok(list)
}

#[tauri::command]
pub fn toggle_mod(app: AppHandle, id: String, file: String) -> Result<String, String> {
    let dir = mods_dir(&app, &id)?;
    let from = safe_file(&dir, &file)?;
    let to_name = match file.strip_suffix(".disabled") {
        Some(base) => base.to_string(),
        None => format!("{file}.disabled"),
    };
    std::fs::rename(&from, dir.join(&to_name)).map_err(|e| format!("не получилось переключить мод: {e}"))?;
    let name = read_metadata(&dir.join(&to_name)).name;
    let name = if name.is_empty() { history::pretty(&file) } else { name };
    history::log(&instances::dir(&app, &id)?, if file.ends_with(".disabled") { "enabled" } else { "disabled" }, &name, &to_name);
    Ok(to_name)
}

#[tauri::command]
pub fn delete_mod(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let dir = mods_dir(&app, &id)?;
    let path = safe_file(&dir, &file)?;
    let name = read_metadata(&path).name;
    std::fs::remove_file(&path).map_err(|e| format!("не получилось удалить мод: {e}"))?;
    history::log(&instances::dir(&app, &id)?, "removed", if name.is_empty() { &file } else { &name }, &file);
    Ok(())
}

/// Копирует перетащенные в окно .jar-файлы в папку модов. Возвращает, сколько добавлено.
#[tauri::command]
pub fn add_mods(app: AppHandle, id: String, paths: Vec<String>) -> Result<usize, String> {
    let dir = mods_dir(&app, &id)?;
    let mut added = 0;
    for p in paths {
        let src = PathBuf::from(&p);
        let Some(name) = src.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        if !name.to_lowercase().ends_with(".jar") || !src.is_file() {
            continue;
        }
        std::fs::copy(&src, dir.join(&name)).map_err(|e| format!("{name}: {e}"))?;
        let title = read_metadata(&dir.join(&name)).name;
        history::log(&instances::dir(&app, &id)?, "added", if title.is_empty() { &name } else { &title }, &name);
        added += 1;
    }
    Ok(added)
}

// ---------- Чтение информации о моде из .jar ----------

fn read_metadata(path: &Path) -> ModInfo {
    let mut info = ModInfo::default();
    let Ok(file) = std::fs::File::open(path) else { return info };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return info };
    let mut read = |name: &str| -> Option<String> {
        let mut e = zip.by_name(name).ok()?;
        let mut s = String::new();
        e.read_to_string(&mut s).ok()?;
        Some(s)
    };

    // Fabric
    if let Some(text) = read("fabric.mod.json") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&text) {
            info.name = j["name"].as_str().or(j["id"].as_str()).unwrap_or_default().to_string();
            info.version = j["version"].as_str().unwrap_or_default().to_string();
            info.description = j["description"].as_str().unwrap_or_default().to_string();
            info.authors = people(&j["authors"]);
            return info;
        }
    }
    // Quilt
    if let Some(text) = read("quilt.mod.json") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&text) {
            let l = &j["quilt_loader"];
            info.name = l["metadata"]["name"].as_str().or(l["id"].as_str()).unwrap_or_default().to_string();
            info.version = l["version"].as_str().unwrap_or_default().to_string();
            info.description = l["metadata"]["description"].as_str().unwrap_or_default().to_string();
            return info;
        }
    }
    // NeoForge / Forge (1.13+)
    let manifest_version = read("META-INF/MANIFEST.MF")
        .and_then(|m| m.lines().find_map(|l| l.strip_prefix("Implementation-Version:").map(|v| v.trim().to_string())));
    if let Some(text) = read("META-INF/neoforge.mods.toml").or_else(|| read("META-INF/mods.toml")) {
        info.name = toml_value(&text, "displayName").unwrap_or_default();
        info.version = toml_value(&text, "version").unwrap_or_default();
        if info.version.contains("${") {
            info.version = manifest_version.unwrap_or_default();
        }
        info.description = toml_value(&text, "description").unwrap_or_default();
        info.authors = toml_value(&text, "authors").unwrap_or_default();
        return info;
    }
    // Старый Forge (1.12.2 и раньше)
    if let Some(text) = read("mcmod.info") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&text) {
            let m = if j.is_array() { &j[0] } else { &j["modList"][0] };
            info.name = m["name"].as_str().unwrap_or_default().to_string();
            info.version = m["version"].as_str().unwrap_or_default().to_string();
            info.description = m["description"].as_str().unwrap_or_default().to_string();
            info.authors = people(&m["authorList"]);
        }
    }
    info
}

fn people(v: &serde_json::Value) -> String {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_str().map(String::from).or_else(|| p["name"].as_str().map(String::from)))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

/// Очень простой поиск значения `key = "..."` (или '''многострочного''') в mods.toml.
fn toml_value(text: &str, key: &str) -> Option<String> {
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix(key) else { continue };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim();
        if let Some(body) = rest.strip_prefix("'''").or_else(|| rest.strip_prefix("\"\"\"")) {
            let mut out = body.to_string();
            if let Some(end) = out.find("'''").or_else(|| out.find("\"\"\"")) {
                out.truncate(end);
                return Some(out.trim().to_string());
            }
            for l in lines.by_ref() {
                if let Some(end) = l.find("'''").or_else(|| l.find("\"\"\"")) {
                    out.push('\n');
                    out.push_str(&l[..end]);
                    break;
                }
                out.push('\n');
                out.push_str(l);
            }
            return Some(out.trim().to_string());
        }
        let quoted = rest.trim_start_matches(['"', '\'']);
        let end = quoted.find(['"', '\'']).unwrap_or(quoted.len());
        return Some(quoted[..end].to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::toml_value;

    #[test]
    fn toml() {
        let t = "modLoader=\"javafml\"\n[[mods]]\nmodId=\"jei\"\nversion=\"${file.jarVersion}\"\ndisplayName = \"Just Enough Items\"\ndescription='''\nShows items\nand recipes\n'''";
        assert_eq!(toml_value(t, "displayName").unwrap(), "Just Enough Items");
        assert_eq!(toml_value(t, "description").unwrap(), "Shows items\nand recipes");
        assert_eq!(toml_value(t, "version").unwrap(), "${file.jarVersion}");
    }
}
