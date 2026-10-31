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
        dialog_app.dialog().file().add_filter("Картинки и видео", &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"]).blocking_pick_file()
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

// ---------- Датапаки мира ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Datapack {
    pub file: String,
    pub size: u64,
}

#[tauri::command]
pub fn list_datapacks(app: AppHandle, id: String, world: String) -> Result<Vec<Datapack>, String> {
    let dir = instances::dir(&app, &id)?.join("minecraft").join("saves").join(plain(&world)?).join("datapacks");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let path = e.path();
            out.push(Datapack {
                file: e.file_name().to_string_lossy().into_owned(),
                size: if path.is_dir() { dir_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) },
            });
        }
    }
    out.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn delete_datapack(app: AppHandle, id: String, world: String, file: String) -> Result<(), String> {
    let path = instances::dir(&app, &id)?.join("minecraft").join("saves").join(plain(&world)?).join("datapacks").join(plain(&file)?);
    let result = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
    result.map_err(|e| format!("не получилось удалить датапак: {e}"))
}

// ---------- Резервные копии миров ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub file: String,
    pub world: String,
    pub time: u64,
    pub size: u64,
}

fn backups_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = instances::dir(app, id)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn zip_dir(zip: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str, opts: zip::write::SimpleFileOptions) -> Result<(), String> {
    use std::io::Write;
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = format!("{prefix}/{}", e.file_name().to_string_lossy());
        let path = e.path();
        if path.is_dir() {
            zip_dir(zip, &path, &name, opts)?;
        } else if e.file_name() != "session.lock" {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            zip.start_file(name, opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Копия одного мира в архив: backups/<мир>__<время>.zip. Старые копии сверх лимита удаляются.
pub fn backup_world(app: &AppHandle, id: &str, world: &str, keep: u32) -> Result<String, String> {
    let saves = instances::dir(app, id)?.join("minecraft").join("saves");
    let src = saves.join(plain(world)?);
    let dir = backups_dir(app, id)?;
    let file = format!("{world}__{}.zip", instances::now_secs());
    let out = std::fs::File::create(dir.join(&file)).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(out);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip_dir(&mut zip, &src, world, opts)?;
    zip.finish().map_err(|e| e.to_string())?;

    // Оставляем только последние `keep` копий этого мира
    let mut mine: Vec<Backup> = list_backups_in(&dir).into_iter().filter(|b| b.world == world).collect();
    mine.sort_by(|a, b| b.time.cmp(&a.time));
    for old in mine.iter().skip(keep.max(1) as usize) {
        let _ = std::fs::remove_file(dir.join(&old.file));
    }
    Ok(file)
}

/// После игры: копируем миры, в которые заходили во время этой сессии.
pub fn backup_after_game(app: &AppHandle, id: &str, since: u64, keep: u32) {
    let Ok(dir) = instances::dir(app, id) else { return };
    let Ok(rd) = std::fs::read_dir(dir.join("minecraft").join("saves")) else { return };
    for e in rd.flatten() {
        let level = e.path().join("level.dat");
        if level.exists() && mtime(&level) >= since {
            let _ = backup_world(app, id, &e.file_name().to_string_lossy(), keep);
        }
    }
}

fn list_backups_in(dir: &Path) -> Vec<Backup> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let file = e.file_name().to_string_lossy().into_owned();
            let Some(stem) = file.strip_suffix(".zip") else { continue };
            let Some((world, time)) = stem.rsplit_once("__") else { continue };
            out.push(Backup {
                world: world.to_string(),
                time: time.parse().unwrap_or(0),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                file,
            });
        }
    }
    out.sort_by(|a, b| b.time.cmp(&a.time));
    out
}

#[tauri::command]
pub fn list_backups(app: AppHandle, id: String) -> Result<Vec<Backup>, String> {
    Ok(list_backups_in(&backups_dir(&app, &id)?))
}

#[tauri::command]
pub fn make_backup(app: AppHandle, id: String, world: String) -> Result<String, String> {
    let keep = crate::settings::load(&app).backup_keep;
    backup_world(&app, &id, &world, keep)
}

#[tauri::command]
pub fn delete_backup(app: AppHandle, id: String, file: String) -> Result<(), String> {
    std::fs::remove_file(backups_dir(&app, &id)?.join(plain(&file)?)).map_err(|e| e.to_string())
}

/// Восстановить мир из копии. Текущее состояние мира сначала тоже сохраняется в копию.
#[tauri::command]
pub fn restore_backup(app: AppHandle, id: String, file: String) -> Result<String, String> {
    use std::io::Read;
    let dir = backups_dir(&app, &id)?;
    let backup = list_backups_in(&dir).into_iter().find(|b| b.file == file).ok_or("копия не найдена")?;
    let saves = instances::dir(&app, &id)?.join("minecraft").join("saves");
    let target = saves.join(plain(&backup.world)?);
    if target.exists() {
        let keep = crate::settings::load(&app).backup_keep + 1;
        backup_world(&app, &id, &backup.world, keep)?;
        std::fs::remove_dir_all(&target).map_err(|e| format!("мир сейчас открыт в игре? {e}"))?;
    }
    let f = std::fs::File::open(dir.join(plain(&file)?)).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { continue };
        if entry.is_dir() {
            continue;
        }
        let out = saves.join(rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(out, buf).map_err(|e| e.to_string())?;
    }
    Ok(backup.world)
}

// ---------- Фон лаунчера и темы ----------

/// Выбрать картинку для фона лаунчера. Возвращает полный путь к её копии.
#[tauri::command]
pub async fn pick_background(app: AppHandle) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().add_filter("Картинки и видео", &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"]).blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let src: PathBuf = picked.into_path().map_err(|e| e.to_string())?;
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
    let dir = paths::data_dir(&app)?.join("backgrounds");
    // Старые фоны больше не нужны
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join(format!("bg-{}.{ext}", instances::now_secs()));
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(Some(dst.to_string_lossy().into_owned()))
}

/// Сохранить свою тему в файл, чтобы поделиться
#[tauri::command]
pub async fn export_theme(app: AppHandle, name: String, json: String) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let file_name = format!("{}.spectia-theme.json", name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_"));
    let target = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().set_file_name(&file_name).add_filter("Тема Spectia", &["json"]).blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = target else { return Ok(None) };
    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// ---------- Уведомления Windows ----------

#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}
