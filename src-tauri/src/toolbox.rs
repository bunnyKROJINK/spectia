//! Инструменты сборки:
//!  • машина времени — снимок всей сборки (моды, конфиги, текстурпаки, шейдеры, настройки игры);
//!  • профили модов — несколько наборов включённых модов в одной сборке;
//!  • проверка перед запуском (Spectia Doctor 2) — находит проблемы ещё до старта игры.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{history, instances, mods};

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn plain(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        Err("неправильное имя".into())
    } else {
        Ok(name)
    }
}

// ---------- Машина времени ----------

/// Что входит в снимок (миры не входят: у них свои копии)
const SNAP_DIRS: &[&str] = &["mods", "config", "defaultconfigs", "kubejs", "resourcepacks", "shaderpacks"];
const SNAP_FILES: &[&str] = &["options.txt", "servers.dat"];

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub file: String,
    pub label: String,
    pub time: u64,
    pub size: u64,
    #[serde(default)]
    pub auto: bool,
}

fn snap_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let d = instances::dir(app, id)?.join("snapshots");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn read_snaps(dir: &Path) -> Vec<Snapshot> {
    std::fs::read_to_string(dir.join("index.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_snaps(dir: &Path, list: &[Snapshot]) -> Result<(), String> {
    std::fs::write(dir.join("index.json"), serde_json::to_string_pretty(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn add_dir(zip: &mut zip::ZipWriter<std::fs::File>, base: &Path, rel: &str, opts: zip::write::SimpleFileOptions) -> Result<(), String> {
    let path = base.join(rel);
    if path.is_dir() {
        for e in std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten() {
            add_dir(zip, base, &format!("{rel}/{}", e.file_name().to_string_lossy()), opts)?;
        }
    } else if path.is_file() {
        zip.start_file(rel, opts).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        zip.write_all(&buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn snapshot(app: &AppHandle, id: &str, label: &str, auto: bool) -> Result<Snapshot, String> {
    let dir = snap_dir(app, id)?;
    let inst_dir = instances::dir(app, id)?;
    let game = inst_dir.join("minecraft");
    let time = now();
    let file = format!("snap-{time}.zip");
    let f = std::fs::File::create(dir.join(&file)).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for d in SNAP_DIRS.iter().chain(SNAP_FILES.iter()) {
        add_dir(&mut zip, &game, d, opts)?;
    }
    // content.json — чтобы после отката лаунчер помнил, что откуда установлено
    if inst_dir.join("content.json").exists() {
        zip.start_file("_spectia/content.json", opts).map_err(|e| e.to_string())?;
        zip.write_all(&std::fs::read(inst_dir.join("content.json")).unwrap_or_default()).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(dir.join(&file)).map(|m| m.len()).unwrap_or(0);
    let snap = Snapshot { file, label: label.to_string(), time, size, auto };
    let mut list = read_snaps(&dir);
    list.insert(0, snap.clone());
    // Автоматических снимков храним не больше 5
    let mut autos = 0;
    let mut keep = Vec::new();
    for s in list {
        if s.auto {
            autos += 1;
            if autos > 5 {
                let _ = std::fs::remove_file(dir.join(&s.file));
                continue;
            }
        }
        keep.push(s);
    }
    write_snaps(&dir, &keep)?;
    Ok(snap)
}

#[tauri::command]
pub fn list_snapshots(app: AppHandle, id: String) -> Result<Vec<Snapshot>, String> {
    let dir = snap_dir(&app, &id)?;
    Ok(read_snaps(&dir).into_iter().filter(|s| dir.join(&s.file).exists()).collect())
}

#[tauri::command]
pub async fn make_snapshot(app: AppHandle, id: String, label: String, auto: Option<bool>) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&app, &id, &label, auto.unwrap_or(false))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn delete_snapshot(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let dir = snap_dir(&app, &id)?;
    let _ = std::fs::remove_file(dir.join(plain(&file)?));
    let list: Vec<Snapshot> = read_snaps(&dir).into_iter().filter(|s| s.file != file).collect();
    write_snaps(&dir, &list)
}

/// Вернуть сборку к снимку. Перед этим сохраняем текущее состояние — на всякий случай.
#[tauri::command]
pub async fn restore_snapshot(app: AppHandle, id: String, file: String, before_label: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let dir = snap_dir(&app, &id)?;
        let src = dir.join(plain(&file)?);
        if !src.exists() {
            return Err("снимок не найден".into());
        }
        snapshot(&app, &id, &before_label, true)?;
        let inst_dir = instances::dir(&app, &id)?;
        let game = inst_dir.join("minecraft");
        for d in SNAP_DIRS {
            let _ = std::fs::remove_dir_all(game.join(d));
        }
        for f in SNAP_FILES {
            let _ = std::fs::remove_file(game.join(f));
        }
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&src).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut e = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = e.name().to_string();
            let rel = Path::new(&name);
            if e.is_dir() || !rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
                continue;
            }
            let out = if let Some(r) = name.strip_prefix("_spectia/") { inst_dir.join(r) } else { game.join(rel) };
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            e.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&out, buf).map_err(|e| e.to_string())?;
        }
        history::log(&inst_dir, "snapshot", &before_label, &file);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Профили модов ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub enabled: Vec<String>,
    pub disabled: Vec<String>,
}

fn base(file: &str) -> String {
    file.trim_end_matches(".disabled").to_string()
}

fn read_profiles(inst_dir: &Path) -> Vec<Profile> {
    std::fs::read_to_string(inst_dir.join("profiles.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn mod_files(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|f| f.to_lowercase().ends_with(".jar") || f.to_lowercase().ends_with(".jar.disabled"))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_profiles(app: AppHandle, id: String) -> Result<Vec<Profile>, String> {
    Ok(read_profiles(&instances::dir(&app, &id)?))
}

/// Запомнить, какие моды сейчас включены, под этим названием
#[tauri::command]
pub fn save_profile(app: AppHandle, id: String, name: String) -> Result<Vec<Profile>, String> {
    let inst_dir = instances::dir(&app, &id)?;
    let files = mod_files(&mods::mods_dir(&app, &id)?);
    let profile = Profile {
        name: name.trim().chars().take(40).collect(),
        enabled: files.iter().filter(|f| !f.ends_with(".disabled")).cloned().collect(),
        disabled: files.iter().filter(|f| f.ends_with(".disabled")).map(|f| base(f)).collect(),
    };
    let mut list = read_profiles(&inst_dir);
    list.retain(|p| p.name != profile.name);
    list.push(profile);
    std::fs::write(inst_dir.join("profiles.json"), serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(list)
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, id: String, name: String) -> Result<Vec<Profile>, String> {
    let inst_dir = instances::dir(&app, &id)?;
    let mut list = read_profiles(&inst_dir);
    list.retain(|p| p.name != name);
    std::fs::write(inst_dir.join("profiles.json"), serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(list)
}

/// Включить моды профиля, выключить остальные из профиля. Новые моды, о которых профиль не знает, не трогаем.
#[tauri::command]
pub fn apply_profile(app: AppHandle, id: String, name: String) -> Result<usize, String> {
    let inst_dir = instances::dir(&app, &id)?;
    let p = read_profiles(&inst_dir).into_iter().find(|p| p.name == name).ok_or("профиль не найден")?;
    let on: HashSet<String> = p.enabled.iter().map(|f| base(f)).collect();
    let off: HashSet<String> = p.disabled.iter().map(|f| base(f)).collect();
    let dir = mods::mods_dir(&app, &id)?;
    let mut changed = 0;
    for f in mod_files(&dir) {
        let b = base(&f);
        let enabled = !f.ends_with(".disabled");
        if on.contains(&b) && !enabled {
            std::fs::rename(dir.join(&f), dir.join(&b)).map_err(|e| e.to_string())?;
            changed += 1;
        } else if off.contains(&b) && enabled {
            std::fs::rename(dir.join(&f), dir.join(format!("{b}.disabled"))).map_err(|e| e.to_string())?;
            changed += 1;
        }
    }
    history::log(&inst_dir, "profile", &p.name, &format!("{changed}"));
    Ok(changed)
}

// ---------- Проверка перед запуском ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// wrongLoader | duplicate | memory
    pub kind: String,
    pub name: String,
    pub detail: String,
}

#[tauri::command]
pub fn precheck(app: AppHandle, id: String) -> Result<Vec<Problem>, String> {
    let inst = instances::read(&app, &id)?;
    if inst.loader == "vanilla" {
        return Ok(vec![]);
    }
    let dir = mods::mods_dir(&app, &id)?;
    let mut out = Vec::new();
    let mut ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut count = 0;
    // Sinytra Connector позволяет NeoForge/Forge загружать моды Fabric — тогда это не ошибка
    let enabled: Vec<String> = mod_files(&dir).into_iter().filter(|f| !f.ends_with(".disabled")).collect();
    let connector = enabled.iter().any(|f| f.to_lowercase().contains("connector"));
    for f in enabled {
        count += 1;
        let m = mods::read_metadata(&dir.join(&f));
        let name = if m.name.is_empty() { history::pretty(&f) } else { m.name.clone() };
        let ok = match (inst.loader.as_str(), m.kind.as_str()) {
            (_, "") => true,
            ("fabric", k) => k == "fabric",
            ("quilt", k) => k == "fabric" || k == "quilt",
            ("forge", "fabric") if connector => true,
            ("forge", k) => k == "forge" || k == "legacy",
            ("neoforge", k) => k == "neoforge" || k == "forge" || (connector && k == "fabric"),
            _ => true,
        };
        if !ok {
            out.push(Problem { kind: "wrongLoader".into(), name: name.clone(), detail: m.kind.clone() });
        }
        if !m.mod_id.is_empty() {
            ids.entry(m.mod_id.clone()).or_default().push(f.clone());
        }
    }
    for (mid, files) in ids {
        if files.len() > 1 {
            out.push(Problem { kind: "duplicate".into(), name: mid, detail: files.join(", ") });
        }
    }
    let need = if count > 200 { 8 } else if count > 120 { 6 } else { 0 };
    if need > 0 && (inst.memory_gb as u32) < need {
        out.push(Problem { kind: "memory".into(), name: count.to_string(), detail: need.to_string() });
    }
    Ok(out)
}
