//! Настройки лаунчера: тема, язык и переключатели со страницы «Настройки».

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub reduce_motion: bool,
    pub hide_on_launch: bool,
    pub check_updates: bool,
    pub auto_java: bool,
    /// Свой ключ CurseForge API (необязательно).
    pub curseforge_key: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "sakura".into(),
            language: "ru".into(),
            reduce_motion: false,
            hide_on_launch: true,
            check_updates: true,
            auto_java: true,
            curseforge_key: String::new(),
        }
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let file = paths::settings_file(&app)?;
    match std::fs::read_to_string(&file) {
        // Если файл повреждён, просто начинаем с настроек по умолчанию.
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(Settings::default()),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let file = paths::settings_file(&app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| format!("не смогли сохранить настройки: {e}"))
}
