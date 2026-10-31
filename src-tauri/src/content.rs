//! Миры, скриншоты и своя обложка сборки.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{instances, paths};

fn mtime(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| {
            let path = e.path();
            if path.is_dir() {
                dir_size(&path)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// Только простое имя — без папок и «..»
fn plain(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        Err("неправильное имя".into())
    } else {
        Ok(name)
    }
}

/// Путь к папке с данными (интерфейсу он нужен, чтобы показывать картинки)
#[tauri::command]
pub fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(paths::data_dir(&app)?.to_string_lossy().into_owned())
}

// ---------- Миры ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub folder: String,
    pub last_played: u64,
    pub size: u64,
    /// Полный путь к icon.png мира (если есть)
    pub icon: String,
}

#[tauri::command]
pub fn list_worlds(app: AppHandle, id: String) -> Result<Vec<World>, String> {
    let saves = instances::dir(&app, &id)?.join("minecraft").join("saves");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&saves) {
        for e in rd.flatten() {
            let path = e.path();
            if !path.join("level.dat").exists() {
                continue;
            }
            let icon = path.join("icon.png");
            out.push(World {
                folder: e.file_name().to_string_lossy().into_owned(),
                last_played: mtime(&path.join("level.dat")),
                size: dir_size(&path),
                icon: if icon.exists() { icon.to_string_lossy().into_owned() } else { String::new() },
            });
        }
    }
    out.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    Ok(out)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else if e.file_name() != "session.lock" {
            std::fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

/// Резервная копия мира рядом с ним: «Мой мир (копия)», «Мой мир (копия 2)»…
#[tauri::command]
pub fn copy_world(app: AppHandle, id: String, folder: String, suffix: String) -> Result<String, String> {
    let saves = instances::dir(&app, &id)?.join("minecraft").join("saves");
    let src = saves.join(plain(&folder)?);
    let suffix = suffix.trim().trim_matches(['(', ')']);
    let mut n = 1;
    let target = loop {
        let name = if n == 1 { format!("{folder} ({suffix})") } else { format!("{folder} ({suffix} {n})") };
        let p = saves.join(&name);
        if !p.exists() {
            break (name, p);
        }
        n += 1;
    };
    copy_dir(&src, &target.1).map_err(|e| format!("не получилось скопировать мир: {e}"))?;
    Ok(target.0)
}

#[tauri::command]
pub fn delete_world(app: AppHandle, id: String, folder: String) -> Result<(), String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("saves").join(plain(&folder)?);
    std::fs::remove_dir_all(path).map_err(|e| format!("не получилось удалить мир: {e}"))
}

#[tauri::command]
pub fn open_world_folder(app: AppHandle, id: String, folder: String) -> Result<(), String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("saves").join(plain(&folder)?);
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

// ---------- Скриншоты ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub file: String,
    pub path: String,
    pub time: u64,
}

#[tauri::command]
pub fn list_screenshots(app: AppHandle, id: String) -> Result<Vec<Screenshot>, String> {
    let dir = instances::dir(&app, &id)?.join("minecraft").join("screenshots");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.to_lowercase().ends_with(".png") {
                continue;
            }
            out.push(Screenshot { path: e.path().to_string_lossy().into_owned(), time: mtime(&e.path()), file: name });
        }
    }
    out.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(out)
}

#[tauri::command]
pub fn open_screenshot(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("screenshots").join(plain(&file)?);
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_screenshot(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("screenshots").join(plain(&file)?);
    std::fs::remove_file(path).map_err(|e| format!("не получилось удалить скриншот: {e}"))
}

// ---------- Обложка ----------

fn set_cover(app: &AppHandle, id: &str, src: &Path) -> Result<instances::Instance, String> {
    let dir = instances::dir(app, id)?;
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
    if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
        return Err("BAD_IMAGE".into());
    }
    let mut inst = instances::read(app, id)?;
    // Новое имя каждый раз, чтобы картинка сразу обновилась на экране
    let name = format!("cover-{}.{ext}", instances::now_secs());
    std::fs::copy(src, dir.join(&name)).map_err(|e| format!("не получилось скопировать картинку: {e}"))?;
    if !inst.cover_image.is_empty() && inst.cover_image != name {
        let _ = std::fs::remove_file(dir.join(plain(&inst.cover_image).unwrap_or("_")));
    }
    inst.cover_image = name;
    instances::write_instance(&dir, &inst)?;
    Ok(inst)
}

/// Выбрать картинку на компьютере
#[tauri::command]
pub async fn pick_cover(app: AppHandle, id: String) -> Result<Option<instances::Instance>, String> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().add_filter("Картинки", &["png", "jpg", "jpeg", "webp", "gif"]).blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path: PathBuf = picked.into_path().map_err(|e| e.to_string())?;
    set_cover(&app, &id, &path).map(Some)
}

#[tauri::command]
pub fn cover_from_screenshot(app: AppHandle, id: String, file: String) -> Result<instances::Instance, String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("screenshots").join(plain(&file)?);
    set_cover(&app, &id, &path)
}

#[tauri::command]
pub fn clear_cover(app: AppHandle, id: String) -> Result<instances::Instance, String> {
    let dir = instances::dir(&app, &id)?;
    let mut inst = instances::read(&app, &id)?;
    if let Ok(name) = plain(&inst.cover_image) {
        let _ = std::fs::remove_file(dir.join(name));
    }
    inst.cover_image.clear();
    instances::write_instance(&dir, &inst)?;
    Ok(inst)
}
