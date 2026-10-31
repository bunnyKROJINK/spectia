//! Перенос сборок из Prism Launcher (и MultiMC).
//!
//! Лаунчер сам находит Prism на компьютере, читает список сборок и копирует
//! выбранные к себе: моды, миры, настройки — всё содержимое папки игры.

use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use crate::instances;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrismInstance {
    /// Полный путь к папке сборки в Prism
    pub path: String,
    pub name: String,
    pub game_version: String,
    pub loader: String,
    pub loader_version: String,
    pub size: u64,
    pub source: String,
}

/// Где обычно живут Prism и MultiMC
fn candidates(app: &AppHandle) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Ok(roaming) = app.path().config_dir() {
        // config_dir на Windows = AppData\Roaming, на Linux = ~/.config, на macOS = ~/Library/Application Support
        out.push(("Prism Launcher".to_string(), roaming.join("PrismLauncher")));
        out.push(("PolyMC".to_string(), roaming.join("PolyMC")));
    }
    if let Ok(data) = app.path().data_dir() {
        out.push(("Prism Launcher".to_string(), data.join("PrismLauncher")));
    }
    out
}

fn read_cfg(path: &Path) -> Vec<(String, String)> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect()
}

fn cfg_get(cfg: &[(String, String)], key: &str) -> Option<String> {
    cfg.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten().map(|e| if e.path().is_dir() { dir_size(&e.path()) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }).sum()
}

/// Версия игры и загрузчик из mmc-pack.json
fn components(dir: &Path) -> (String, String, String) {
    let json: serde_json::Value =
        std::fs::read_to_string(dir.join("mmc-pack.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut game = String::new();
    let mut loader = ("vanilla".to_string(), String::new());
    for c in json["components"].as_array().cloned().unwrap_or_default() {
        let uid = c["uid"].as_str().unwrap_or_default();
        let version = c["version"].as_str().unwrap_or_default().to_string();
        match uid {
            "net.minecraft" => game = version,
            "net.fabricmc.fabric-loader" => loader = ("fabric".into(), version),
            "org.quiltmc.quilt-loader" => loader = ("quilt".into(), version),
            "net.neoforged" => loader = ("neoforge".into(), version),
            "net.minecraftforge" => loader = ("forge".into(), version),
            _ => {}
        }
    }
    // У Forge в Spectia версия хранится вместе с версией игры: 1.20.1-47.4.28
    if loader.0 == "forge" && !loader.1.is_empty() && !loader.1.contains('-') {
        loader.1 = format!("{game}-{}", loader.1);
    }
    (game, loader.0, loader.1)
}

fn game_dir_of(dir: &Path) -> Option<PathBuf> {
    [".minecraft", "minecraft"].iter().map(|d| dir.join(d)).find(|p| p.is_dir())
}

#[tauri::command]
pub fn find_prism_instances(app: AppHandle) -> Result<Vec<PrismInstance>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (source, root) in candidates(&app) {
        if !root.is_dir() {
            continue;
        }
        let cfg = read_cfg(&root.join(if source == "PolyMC" { "polymc.cfg" } else { "prismlauncher.cfg" }));
        let inst_root = cfg_get(&cfg, "InstanceDir").map(PathBuf::from).map(|p| if p.is_absolute() { p } else { root.join(p) }).unwrap_or_else(|| root.join("instances"));
        let Ok(rd) = std::fs::read_dir(&inst_root) else { continue };
        for e in rd.flatten() {
            let dir = e.path();
            if !dir.join("instance.cfg").exists() || !seen.insert(dir.clone()) {
                continue;
            }
            let icfg = read_cfg(&dir.join("instance.cfg"));
            let (game_version, loader, loader_version) = components(&dir);
            if game_version.is_empty() {
                continue;
            }
            out.push(PrismInstance {
                path: dir.to_string_lossy().into_owned(),
                name: cfg_get(&icfg, "name").unwrap_or_else(|| e.file_name().to_string_lossy().into_owned()),
                size: game_dir_of(&dir).map(|g| dir_size(&g)).unwrap_or(0),
                game_version,
                loader,
                loader_version,
                source: source.clone(),
            });
        }
    }
    out.sort_by_key(|i| i.name.to_lowercase());
    Ok(out)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            std::fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

/// Переносит выбранные сборки. Prism при этом не трогаем — только копируем.
#[tauri::command]
pub async fn import_prism(app: AppHandle, paths: Vec<String>) -> Result<usize, String> {
    let all = find_prism_instances(app.clone())?;
    let total = paths.len();
    let mut done = 0;
    for (n, p) in paths.iter().enumerate() {
        let Some(src) = all.iter().find(|i| &i.path == p) else { continue };
        let _ = app.emit("prism-progress", json!({ "done": n, "total": total, "name": src.name }));
        let dir = PathBuf::from(&src.path);
        let icfg = read_cfg(&dir.join("instance.cfg"));
        let inst = instances::create(
            &app,
            instances::NewInstance {
                name: src.name.clone(),
                game_version: src.game_version.clone(),
                loader: src.loader.clone(),
                loader_version: src.loader_version.clone(),
                tint: (n % 6) as u8,
            },
        )?;
        let target = instances::dir(&app, &inst.id)?;
        if let Some(game) = game_dir_of(&dir) {
            let from = game.clone();
            let to = target.join("minecraft");
            tauri::async_runtime::spawn_blocking(move || copy_dir(&from, &to)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        }
        // Память и аргументы Java из Prism, если они там были заданы
        let mut fresh = instances::read(&app, &inst.id)?;
        if cfg_get(&icfg, "OverrideMemory").as_deref() == Some("true") {
            if let Some(mb) = cfg_get(&icfg, "MaxMemAlloc").and_then(|v| v.parse::<u32>().ok()) {
                fresh.memory_gb = ((mb + 512) / 1024).clamp(1, 32) as u8;
            }
        }
        if cfg_get(&icfg, "OverrideJavaArgs").as_deref() == Some("true") {
            fresh.jvm_args = cfg_get(&icfg, "JvmArgs").unwrap_or_default();
        }
        fresh.notes = format!("Перенесено из {}", src.source);
        instances::write_instance(&target, &fresh)?;
        done += 1;
    }
    let _ = app.emit("prism-progress", json!({ "done": total, "total": total }));
    Ok(done)
}

// ---------- Аккаунты Prism ----------
//
// Prism хранит вход в Minecraft в файле accounts.json. Мы НЕ продлеваем вход сами
// (это делал бы чужой лаунчер от имени Prism) — только берём уже готовый игровой ключ,
// пока он свежий. Когда он устареет, Prism обновит его сам при следующем открытии.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrismAccount {
    pub id: String,
    pub name: String,
    /// Можно ли играть прямо сейчас (игровой ключ ещё действует)
    pub fresh: bool,
    pub expires_at: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Все лицензионные аккаунты из Prism (без ключей — только для показа)
fn raw_accounts(app: &AppHandle) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for (_, root) in candidates(app) {
        let Ok(text) = std::fs::read_to_string(root.join("accounts.json")) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for a in json["accounts"].as_array().cloned().unwrap_or_default() {
            let kind = a["type"].as_str().unwrap_or_default();
            if (kind == "MSA" || kind == "Mojang") && a["profile"]["id"].as_str().is_some_and(|s| !s.is_empty()) {
                out.push(a);
            }
        }
    }
    out
}

fn to_account(a: &serde_json::Value) -> PrismAccount {
    let exp = a["ygg"]["exp"].as_u64().unwrap_or(0);
    PrismAccount {
        id: a["profile"]["id"].as_str().unwrap_or_default().replace('-', ""),
        name: a["profile"]["name"].as_str().unwrap_or_default().to_string(),
        fresh: exp > now() + 60 && a["ygg"]["token"].as_str().is_some_and(|t| !t.is_empty()),
        expires_at: exp,
    }
}

#[tauri::command]
pub fn find_prism_accounts(app: AppHandle) -> Vec<PrismAccount> {
    let mut seen = std::collections::HashSet::new();
    raw_accounts(&app).iter().map(to_account).filter(|a| seen.insert(a.id.clone())).collect()
}

/// Игровой ключ аккаунта из Prism: (ник, ключ). PRISM_GONE — аккаунта там больше нет,
/// PRISM_REFRESH — ключ устарел, нужно открыть Prism, чтобы он его обновил.
pub fn prism_token(app: &AppHandle, id: &str) -> Result<(String, String), String> {
    let list = raw_accounts(app);
    let mut found = false;
    for a in &list {
        let acc = to_account(a);
        if acc.id != id {
            continue;
        }
        found = true;
        if acc.fresh {
            return Ok((acc.name, a["ygg"]["token"].as_str().unwrap_or_default().to_string()));
        }
    }
    Err(if found { "PRISM_REFRESH".into() } else { "PRISM_GONE".into() })
}

// ---------- Импорт архива сборки Prism / MultiMC (.zip) ----------

/// Распаковывает zip во временную папку и возвращает папку сборки (там, где instance.cfg)
pub fn unpack_prism_zip(app: &AppHandle, file: &Path) -> Result<Option<PathBuf>, String> {
    let f = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    // Где лежит instance.cfg: в корне или в одной папке внутри
    let cfg = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| n == "instance.cfg" || n.ends_with("/instance.cfg"))
        .min_by_key(|n| n.matches('/').count());
    let Some(cfg) = cfg else { return Ok(None) };
    let prefix = cfg.trim_end_matches("instance.cfg").to_string();
    let tmp = crate::paths::data_dir(app)?.join("cache").join(format!("prism-import-{}", now()));
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = e.name().to_string();
        let Some(rel) = name.strip_prefix(&prefix) else { continue };
        let rel = Path::new(rel);
        if rel.as_os_str().is_empty() || e.is_dir() || !rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
            continue;
        }
        let out = tmp.join(rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut e, &mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
    }
    Ok(Some(tmp))
}

/// Создать сборку Spectia из распакованной папки сборки Prism
pub fn import_dir(app: &AppHandle, dir: &Path, tint: u8) -> Result<instances::Instance, String> {
    let icfg = read_cfg(&dir.join("instance.cfg"));
    let (game_version, loader, loader_version) = components(dir);
    if game_version.is_empty() {
        return Err("в архиве не указана версия Minecraft (нет mmc-pack.json)".into());
    }
    let name = cfg_get(&icfg, "name").unwrap_or_else(|| "Сборка из Prism".into());
    let inst = instances::create(app, instances::NewInstance { name, game_version, loader, loader_version, tint })?;
    let target = instances::dir(app, &inst.id)?;
    if let Some(game) = game_dir_of(dir) {
        copy_dir(&game, &target.join("minecraft")).map_err(|e| e.to_string())?;
    }
    let mut fresh = instances::read(app, &inst.id)?;
    if cfg_get(&icfg, "OverrideMemory").as_deref() == Some("true") {
        if let Some(mb) = cfg_get(&icfg, "MaxMemAlloc").and_then(|v| v.parse::<u32>().ok()) {
            fresh.memory_gb = ((mb + 512) / 1024).clamp(1, 32) as u8;
        }
    }
    if cfg_get(&icfg, "OverrideJavaArgs").as_deref() == Some("true") {
        fresh.jvm_args = cfg_get(&icfg, "JvmArgs").unwrap_or_default();
    }
    instances::write_instance(&target, &fresh)?;
    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mmc_pack() {
        let dir = std::env::temp_dir().join("spectia-prism-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.minecraftforge","version":"47.4.28"}],"formatVersion":1}"#,
        )
        .unwrap();
        assert_eq!(components(&dir), ("1.20.1".into(), "forge".into(), "1.20.1-47.4.28".into()));
    }
}
