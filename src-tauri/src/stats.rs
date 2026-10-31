//! Тихая статистика: каждая игровая сессия записывается одной строкой в stats.jsonl.
//! Пока это просто сбор данных — потом из них получатся графики и Spectia Wrapped.

use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::AppHandle;

use crate::paths;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub instance: String,
    pub name: String,
    pub game_version: String,
    pub loader: String,
    pub start: u64,
    pub seconds: u64,
}

pub fn record(app: &AppHandle, s: &Session) {
    let Ok(dir) = paths::data_dir(app) else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("stats.jsonl")) {
        if let Ok(line) = serde_json::to_string(s) {
            let _ = writeln!(f, "{line}");
        }
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub sessions: u64,
    pub total_seconds: u64,
}

#[tauri::command]
pub fn stats_summary(app: AppHandle) -> Result<Summary, String> {
    let dir = paths::data_dir(&app)?;
    let text = std::fs::read_to_string(dir.join("stats.jsonl")).unwrap_or_default();
    let mut out = Summary::default();
    for line in text.lines() {
        if let Ok(s) = serde_json::from_str::<Session>(line) {
            out.sessions += 1;
            out.total_seconds += s.seconds;
        }
    }
    Ok(out)
}
