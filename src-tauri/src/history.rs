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
    append(inst_dir, &Event { time: now(), action: action.into(), name: name.into(), detail: detail.into() });
    sync(inst_dir);
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
        append(inst_dir, &Event { time: t, action: "appeared".into(), name: pretty(f), detail: f.clone() });
    }
    for f in before.difference(&now_set) {
        append(inst_dir, &Event { time: t, action: "vanished".into(), name: pretty(f), detail: f.clone() });
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
