//! «Поделиться сборкой»: файлы .mrpack (формат Modrinth).
//!
//! Внутри .mrpack лежит список модов со ссылками на Modrinth (сами моды не
//! копируются — файл получается маленьким) и папка overrides/ со всем остальным:
//! настройками модов и модами, которых на Modrinth нет.
//! Такой файл понимают Spectia, Prism Launcher и приложение Modrinth.
//! Описание формата: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use crate::modrinth::{self, ContentEntry, MrVersion};
use crate::{instances, net, paths};

const API: &str = "https://api.modrinth.com/v2";
/// Что из папки сборки кладём в overrides (миры и личные настройки не трогаем)
const OVERRIDE_DIRS: &[&str] = &["config", "defaultconfigs", "kubejs", "resourcepacks", "shaderpacks"];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    format_version: u32,
    game: String,
    version_id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    files: Vec<IndexFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    path: String,
    hashes: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    downloads: Vec<String>,
    file_size: u64,
}

fn loader_key(loader: &str) -> Option<&'static str> {
    match loader {
        "fabric" => Some("fabric-loader"),
        "quilt" => Some("quilt-loader"),
        "forge" => Some("forge"),
        "neoforge" => Some("neoforge"),
        _ => None,
    }
}

// ---------- Экспорт ----------

#[tauri::command]
pub async fn export_mrpack(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let inst = instances::read(&app, &id)?;
    let dir = instances::dir(&app, &id)?;
    let game = dir.join("minecraft");

    // Куда сохранить — спрашиваем у человека
    let dialog_app = app.clone();
    let file_name = format!("{}.mrpack", inst.name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_"));
    let target = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().set_file_name(&file_name).add_filter("Modrinth (.mrpack)", &["mrpack"]).blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = target else { return Ok(None) };
    let target = target.into_path().map_err(|e| e.to_string())?;
    write_mrpack(&inst, &game, &target).await?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

pub async fn write_mrpack(inst: &instances::Instance, game: &Path, target: &Path) -> Result<(), String> {
    // Моды, текстурпаки и шейдеры: что найдётся на Modrinth — ссылкой, остальное — файлом
    let mut candidates: Vec<(String, PathBuf, String)> = Vec::new(); // (путь в сборке, файл, sha1)
    for folder in ["mods", "resourcepacks", "shaderpacks"] {
        let Ok(rd) = std::fs::read_dir(game.join(folder)) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !e.path().is_file() || lower.ends_with(".disabled") || !(lower.ends_with(".jar") || lower.ends_with(".zip")) {
                continue;
            }
            let bytes = std::fs::read(e.path()).map_err(|e| e.to_string())?;
            candidates.push((format!("{folder}/{name}"), e.path(), net::sha1_hex(&bytes)));
        }
    }
    let hashes: Vec<&String> = candidates.iter().map(|(_, _, h)| h).collect();
    let found: HashMap<String, MrVersion> = if hashes.is_empty() {
        HashMap::new()
    } else {
        modrinth::post_json(&format!("{API}/version_files"), &json!({ "hashes": hashes, "algorithm": "sha1" })).await.unwrap_or_default()
    };

    let mut files = Vec::new();
    let mut as_override: Vec<(String, PathBuf)> = Vec::new();
    for (rel, path, hash) in &candidates {
        let file = found.get(hash).and_then(|v| v.files.iter().find(|f| f.hashes.get("sha1") == Some(hash)));
        match file {
            Some(f) if f.hashes.contains_key("sha512") => files.push(IndexFile {
                path: rel.clone(),
                hashes: HashMap::from([("sha1".to_string(), hash.clone()), ("sha512".to_string(), f.hashes["sha512"].clone())]),
                env: None,
                downloads: vec![f.url.clone()],
                file_size: f.size,
            }),
            _ => as_override.push((rel.clone(), path.clone())),
        }
    }

    let mut dependencies = HashMap::from([("minecraft".to_string(), inst.game_version.clone())]);
    if let Some(key) = loader_key(&inst.loader) {
        // У Forge версия хранится как «1.20.1-47.4.28», а в .mrpack нужна только «47.4.28»
        let v = inst.loader_version.strip_prefix(&format!("{}-", inst.game_version)).unwrap_or(&inst.loader_version);
        dependencies.insert(key.to_string(), v.to_string());
    }
    let index = Index {
        format_version: 1,
        game: "minecraft".into(),
        version_id: "1.0.0".into(),
        name: inst.name.clone(),
        summary: Some("Сборка из лаунчера Spectia".into()),
        files,
        dependencies,
    };

    // Пишем архив
    let out = std::fs::File::create(target).map_err(|e| format!("не получилось сохранить файл: {e}"))?;
    let mut zip = zip::ZipWriter::new(out);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("modrinth.index.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec_pretty(&index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    for (rel, path) in &as_override {
        add_file(&mut zip, &format!("overrides/{rel}"), path, opts)?;
    }
    for d in OVERRIDE_DIRS {
        let src = game.join(d);
        if src.is_dir() {
            add_dir(&mut zip, &src, &format!("overrides/{d}"), opts, &index)?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_file(zip: &mut zip::ZipWriter<std::fs::File>, name: &str, path: &Path, opts: zip::write::SimpleFileOptions) -> Result<(), String> {
    zip.start_file(name, opts).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    zip.write_all(&bytes).map_err(|e| e.to_string())
}

fn add_dir(zip: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str, opts: zip::write::SimpleFileOptions, index: &Index) -> Result<(), String> {
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = format!("{prefix}/{}", e.file_name().to_string_lossy());
        let path = e.path();
        if path.is_dir() {
            add_dir(zip, &path, &name, opts, index)?;
        } else {
            // Текстурпаки и шейдеры, уже записанные ссылкой, второй раз не кладём
            let rel = name.trim_start_matches("overrides/");
            if index.files.iter().any(|f| f.path == rel) {
                continue;
            }
            add_file(zip, &name, &path, opts)?;
        }
    }
    Ok(())
}

// ---------- Импорт ----------

/// Безопасный путь внутри сборки (никаких «../» и абсолютных путей)
fn safe_rel(p: &str) -> Option<PathBuf> {
    let path = Path::new(p);
    if path.components().all(|c| matches!(c, Component::Normal(_))) {
        Some(path.to_path_buf())
    } else {
        None
    }
}

#[tauri::command]
pub async fn import_mrpack(app: AppHandle, path: Option<String>) -> Result<Option<instances::Instance>, String> {
    let file = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let dialog_app = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                dialog_app.dialog().file().add_filter("Modrinth (.mrpack)", &["mrpack", "zip"]).blocking_pick_file()
            })
            .await
            .map_err(|e| e.to_string())?;
            match picked {
                Some(p) => p.into_path().map_err(|e| e.to_string())?,
                None => return Ok(None),
            }
        }
    };
    import_file(&app, &file, None).await.map(Some)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub instance: instances::Instance,
    /// Файлы, которые автор разрешил качать только с сайта CurseForge
    pub manual: Vec<crate::curseforge::ManualFile>,
}

/// Импорт любого архива сборки: Modrinth (.mrpack), CurseForge (.zip) или Prism / MultiMC (.zip)
#[tauri::command]
pub async fn import_pack(app: AppHandle, path: Option<String>) -> Result<Option<ImportOutcome>, String> {
    let file = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let dialog_app = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                dialog_app.dialog().file().add_filter("Сборка (.mrpack, .zip)", &["mrpack", "zip"]).blocking_pick_file()
            })
            .await
            .map_err(|e| e.to_string())?;
            match picked {
                Some(p) => p.into_path().map_err(|e| e.to_string())?,
                None => return Ok(None),
            }
        }
    };
    let kind = {
        let f = std::fs::File::open(&file).map_err(|e| format!("{}: {e}", file.display()))?;
        let mut zip = zip::ZipArchive::new(f).map_err(|_| "NOT_A_PACK".to_string())?;
        if zip.by_name("modrinth.index.json").is_ok() {
            "mrpack"
        } else if crate::curseforge::is_curseforge(&mut zip) {
            "curseforge"
        } else {
            "prism"
        }
    };
    match kind {
        "mrpack" => Ok(Some(ImportOutcome { instance: import_file(&app, &file, None).await?, manual: vec![] })),
        "curseforge" => {
            let (instance, manual) = crate::curseforge::import(&app, &file).await?;
            Ok(Some(ImportOutcome { instance, manual }))
        }
        _ => {
            let unpack_app = app.clone();
            let f2 = file.clone();
            let dir = tauri::async_runtime::spawn_blocking(move || crate::prism::unpack_prism_zip(&unpack_app, &f2))
                .await
                .map_err(|e| e.to_string())??
                .ok_or("NOT_A_PACK")?;
            let res = crate::prism::import_dir(&app, &dir, (instances::now_secs() % 6) as u8);
            let _ = std::fs::remove_dir_all(&dir);
            Ok(Some(ImportOutcome { instance: res?, manual: vec![] }))
        }
    }
}

/// Готовая сборка из каталога Modrinth: скачиваем её .mrpack и импортируем.
#[tauri::command]
pub async fn install_modpack(app: AppHandle, project_id: String) -> Result<instances::Instance, String> {
    #[derive(Deserialize)]
    struct Project {
        title: String,
    }
    let project: Project = net::fetch_json(&format!("{API}/project/{project_id}")).await?;
    let versions: Vec<MrVersion> = net::fetch_json(&format!("{API}/project/{project_id}/version")).await?;
    let version = versions.iter().find(|v| v.version_type == "release").or(versions.first()).ok_or("у этой сборки нет версий")?;
    let f = version.primary_file().ok_or("у этой версии нет файла")?;
    let cache = paths::data_dir(&app)?.join("cache").join("modpacks").join(format!("{}.mrpack", version.id));
    net::download(&f.url, &cache, f.hashes.get("sha1").map(String::as_str)).await?;
    let inst = import_file(&app, &cache, Some(project.title)).await?;
    // Отмечаем в content.json, что это сборка с Modrinth (пригодится для обновлений сборки)
    let _ = std::fs::remove_file(&cache);
    Ok(inst)
}

async fn import_file(app: &AppHandle, file: &Path, name_hint: Option<String>) -> Result<instances::Instance, String> {
    let f = std::fs::File::open(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|_| "Это не файл сборки .mrpack".to_string())?;
    let index: Index = {
        let mut entry = zip.by_name("modrinth.index.json").map_err(|_| "NOT_MRPACK".to_string())?;
        let mut text = String::new();
        entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("modrinth.index.json: {e}"))?
    };

    let game_version = index.dependencies.get("minecraft").cloned().ok_or("в сборке не указана версия Minecraft")?;
    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        ("fabric", v.clone())
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        ("quilt", v.clone())
    } else if let Some(v) = index.dependencies.get("neoforge") {
        ("neoforge", v.clone())
    } else if let Some(v) = index.dependencies.get("forge") {
        ("forge", format!("{game_version}-{v}"))
    } else {
        ("vanilla", String::new())
    };

    let inst = instances::create(
        app,
        instances::NewInstance {
            name: name_hint.unwrap_or(index.name.clone()),
            game_version,
            loader: loader.into(),
            loader_version,
            tint: (instances::now_secs() % 6) as u8,
        },
    )?;
    let dir = instances::dir(app, &inst.id)?;
    let game = dir.join("minecraft");

    // Файлы со ссылками
    let wanted: Vec<&IndexFile> =
        index.files.iter().filter(|f| f.env.as_ref().and_then(|e| e.get("client")).map(|c| c != "unsupported").unwrap_or(true)).collect();
    let total = wanted.len();
    for (n, f) in wanted.into_iter().enumerate() {
        let _ = app.emit("import-progress", json!({ "done": n, "total": total }));
        let Some(rel) = safe_rel(&f.path) else { continue };
        let Some(url) = f.downloads.first() else { continue };
        net::download(url, &game.join(rel), f.hashes.get("sha1").map(String::as_str)).await?;
    }
    let _ = app.emit("import-progress", json!({ "done": total, "total": total }));

    // overrides/ и client-overrides/
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let rel = name.strip_prefix("overrides/").or_else(|| name.strip_prefix("client-overrides/"));
        let Some(rel) = rel.and_then(safe_rel) else { continue };
        if entry.is_dir() || rel.as_os_str().is_empty() {
            continue;
        }
        let out = game.join(rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
    }

    // Запоминаем, что моды пришли с Modrinth (чтобы в поиске было «Установлено»)
    let mut idx = modrinth::read_index(&dir);
    for f in &index.files {
        if let Some(rest) = f.downloads.first().and_then(|u| u.strip_prefix("https://cdn.modrinth.com/data/")) {
            let mut parts = rest.split('/');
            if let (Some(pid), Some("versions"), Some(vid)) = (parts.next(), parts.next(), parts.next()) {
                idx.insert(f.path.clone(), ContentEntry { project_id: pid.into(), version_id: vid.into(), title: String::new() });
            }
        }
    }
    let _ = modrinth::write_index(&dir, &idx);
    Ok(inst)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Настоящая проверка: ставим Iris (он требует Sodium) и сохраняем сборку в .mrpack.
    #[test]
    #[ignore]
    fn modrinth_install_and_export_end_to_end() {
        let root = std::env::temp_dir().join("spectia-it-mr");
        let _ = std::fs::remove_dir_all(&root);
        let game = root.join("minecraft");
        std::fs::create_dir_all(&game).unwrap();
        tauri::async_runtime::block_on(async {
            let res = modrinth::install_into(&root, "1.21.1", "fabric", "iris").await.expect("установка Iris");
            println!("Установлено: {:?}", res.installed);
            assert!(res.installed.len() >= 2, "зависимость Sodium не поставилась");
            let mods: Vec<String> = std::fs::read_dir(game.join("mods")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            println!("Файлы: {mods:?}");
            let inst = instances::Instance { name: "Тест".into(), game_version: "1.21.1".into(), loader: "fabric".into(), loader_version: "0.16.14".into(), ..Default::default() };
            let target = root.join("test.mrpack");
            write_mrpack(&inst, &game, &target).await.expect("экспорт");
            let mut zip = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
            let mut text = String::new();
            zip.by_name("modrinth.index.json").unwrap().read_to_string(&mut text).unwrap();
            let index: Index = serde_json::from_str(&text).unwrap();
            println!("В .mrpack ссылок на моды: {}", index.files.len());
            assert_eq!(index.files.len(), mods.len(), "не все моды нашлись на Modrinth");
            assert_eq!(index.dependencies.get("fabric-loader").map(String::as_str), Some("0.16.14"));
        });
    }

    #[test]
    fn safe_paths() {
        assert!(safe_rel("mods/a.jar").is_some());
        assert!(safe_rel("../evil.jar").is_none());
        assert!(safe_rel("/etc/passwd").is_none());
        assert!(safe_rel("mods/../../x").is_none());
    }
}
