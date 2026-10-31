//! История изменений сборки: что и когда ставили, обновляли, выключали и удаляли.
//!
//! Если игра вдруг сломалась, по истории сразу видно, что поменялось последним.
//! Записи лежат в history.jsonl в папке сборки — по одной строке на событие.
//! Изменения, сделанные мимо лаунчера (кто-то положил мод в папку руками),
//! мы тоже замечаем: сравниваем папку mods со «снимком» с прошлого раза.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;

use crate::instances;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub time: u64,
    /// installed | updated | removed | enabled | disabled | added | appeared | vanished
    pub action: String,
    pub name: String,
    #[serde(default)]
    pub detail: String,
    /// Файл в корзине (mod-trash), который можно вернуть
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub restore: String,
    /// Файл, который нужно убрать при откате (новая версия после обновления)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub replaced: String,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Моды в папке, без «.disabled» на конце
fn current_mods(inst_dir: &Path) -> BTreeSet<String> {
    let Ok(rd) = std::fs::read_dir(inst_dir.join("minecraft").join("mods")) else { return BTreeSet::new() };
    rd.flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|f| {
            let l = f.to_lowercase();
            l.ends_with(".jar") || l.ends_with(".jar.disabled")
        })
        .map(|f| f.trim_end_matches(".disabled").to_string())
        .collect()
}

fn snapshot_path(inst_dir: &Path) -> std::path::PathBuf {
    inst_dir.join("mods-snapshot.json")
}

/// Запомнить, какие моды сейчас в папке (после действий самого лаунчера)
pub fn sync(inst_dir: &Path) {
    let list: Vec<String> = current_mods(inst_dir).into_iter().collect();
    if let Ok(text) = serde_json::to_string(&list) {
        let _ = std::fs::write(snapshot_path(inst_dir), text);
    }
}

fn append(inst_dir: &Path, ev: &Event) {
    if let Ok(line) = serde_json::to_string(ev) {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(inst_dir.join("history.jsonl")) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// Записать событие и обновить снимок папки
pub fn log(inst_dir: &Path, action: &str, name: &str, detail: &str) {
    log_undo(inst_dir, action, name, detail, "", "");
}

/// Записать событие, которое можно откатить
pub fn log_undo(inst_dir: &Path, action: &str, name: &str, detail: &str, restore: &str, replaced: &str) {
    append(inst_dir, &Event { time: now(), action: action.into(), name: name.into(), detail: detail.into(), restore: restore.into(), replaced: replaced.into() });
    sync(inst_dir);
}

/// Копия файла в корзину сборки перед удалением или обновлением. Возвращает имя копии.
pub fn stash(inst_dir: &Path, file: &Path) -> Option<String> {
    let trash = inst_dir.join("mod-trash");
    std::fs::create_dir_all(&trash).ok()?;
    let name = format!("{}-{}", now(), file.file_name()?.to_string_lossy());
    std::fs::copy(file, trash.join(&name)).ok()?;
    // Храним не больше 60 файлов: самые старые удаляем
    if let Ok(rd) = std::fs::read_dir(&trash) {
        let mut all: Vec<_> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        all.sort();
        let extra = all.len().saturating_sub(60);
        for old in all.into_iter().take(extra) {
            let _ = std::fs::remove_file(trash.join(old));
        }
    }
    Some(name)
}

fn plain(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.contains("..")
}

/// «Вернуть как было»: достаём файл из корзины (и убираем новую версию, если это было обновление)
#[tauri::command]
pub fn undo_event(app: AppHandle, id: String, time: u64, restore: String) -> Result<String, String> {
    let dir = instances::dir(&app, &id)?;
    let ev = read(&dir).into_iter().find(|e| e.time == time && e.restore == restore).ok_or("нет такого события")?;
    if !plain(&ev.restore) {
        return Err("нечего возвращать".into());
    }
    let src = dir.join("mod-trash").join(&ev.restore);
    if !src.exists() {
        return Err("TRASH_GONE".into());
    }
    let mods = dir.join("minecraft").join("mods");
    let original = ev.restore.splitn(2, '-').nth(1).unwrap_or(&ev.restore).to_string();
    if plain(&ev.replaced) {
        let _ = std::fs::remove_file(mods.join(&ev.replaced));
        let _ = std::fs::remove_file(mods.join(format!("{}.disabled", ev.replaced.trim_end_matches(".disabled"))));
    }
    std::fs::create_dir_all(&mods).map_err(|e| e.to_string())?;
    std::fs::rename(&src, mods.join(&original)).or_else(|_| std::fs::copy(&src, mods.join(&original)).map(|_| ())).map_err(|e| e.to_string())?;
    log(&dir, "restored", &ev.name, &original);
    Ok(original)
}

/// Красивое имя мода из имени файла: «sodium-fabric-0.6.jar» → «sodium-fabric-0.6»
pub fn pretty(file: &str) -> String {
    file.trim_end_matches(".disabled").trim_end_matches(".jar").to_string()
}

/// Заметить моды, которые добавили или удалили руками через папку
pub fn detect_external(inst_dir: &Path) {
    let snap = snapshot_path(inst_dir);
    let Ok(text) = std::fs::read_to_string(&snap) else {
        // Первый раз — просто запоминаем, что есть
        sync(inst_dir);
        return;
    };
    let before: BTreeSet<String> = serde_json::from_str::<Vec<String>>(&text).unwrap_or_default().into_iter().collect();
    let now_set = current_mods(inst_dir);
    if before == now_set {
        return;
    }
    let t = now();
    for f in now_set.difference(&before) {
        append(inst_dir, &Event { time: t, action: "appeared".into(), name: pretty(f), detail: f.clone(), restore: String::new(), replaced: String::new() });
    }
    for f in before.difference(&now_set) {
        append(inst_dir, &Event { time: t, action: "vanished".into(), name: pretty(f), detail: f.clone(), restore: String::new(), replaced: String::new() });
    }
    sync(inst_dir);
}

pub fn read(inst_dir: &Path) -> Vec<Event> {
    let text = std::fs::read_to_string(inst_dir.join("history.jsonl")).unwrap_or_default();
    let mut list: Vec<Event> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    list.reverse();
    list.truncate(500);
    list
}

/// История изменений сборки, новые события — первыми
#[tauri::command]
pub fn mod_history(app: AppHandle, id: String) -> Result<Vec<Event>, String> {
    let dir = instances::dir(&app, &id)?;
    detect_external(&dir);
    Ok(read(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_manual_changes() {
        let dir = std::env::temp_dir().join(format!("spectia-history-{}", now()));
        let mods = dir.join("minecraft").join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("a.jar"), b"x").unwrap();
        detect_external(&dir); // первый снимок
        assert!(read(&dir).is_empty());
        std::fs::write(mods.join("b.jar.disabled"), b"x").unwrap();
        std::fs::remove_file(mods.join("a.jar")).unwrap();
        detect_external(&dir);
        let ev = read(&dir);
        assert_eq!(ev.len(), 2);
        assert!(ev.iter().any(|e| e.action == "appeared" && e.name == "b"));
        assert!(ev.iter().any(|e| e.action == "vanished" && e.name == "a"));
        log(&dir, "installed", "Sodium", "mods/sodium.jar");
        detect_external(&dir);
        assert_eq!(read(&dir).len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
