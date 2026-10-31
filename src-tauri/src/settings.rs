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
    /// Плавающие украшения в тематических темах
    pub show_decorations: bool,
    pub hide_on_launch: bool,
    pub check_updates: bool,
    pub auto_java: bool,
    /// Свой ключ CurseForge API (необязательно).
    pub curseforge_key: String,
    /// После закрытия игры: "restore" — вернуть лаунчер, "stay" — оставить свёрнутым
    pub after_game_close: String,
    /// Значения по умолчанию для новых сборок
    pub default_memory_gb: u8,
    pub default_jvm_args: String,
    pub default_window_width: u32,
    pub default_window_height: u32,
    pub default_fullscreen: bool,
    pub default_backup_worlds: bool,
    /// Сколько копий каждого мира хранить
    pub backup_keep: u32,
    /// Всё остальное, что хранит интерфейс (цвета, масштаб, звуки, свои темы…)
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "sakura".into(),
            language: "ru".into(),
            reduce_motion: false,
            show_decorations: true,
            hide_on_launch: true,
            check_updates: true,
            auto_java: true,
            curseforge_key: String::new(),
            after_game_close: "restore".into(),
            default_memory_gb: 4,
            default_jvm_args: String::new(),
            default_window_width: 1280,
            default_window_height: 720,
            default_fullscreen: false,
            default_backup_worlds: false,
            backup_keep: 5,
            extra: serde_json::Map::new(),
        }
    }
}

/// Настройки с диска (или по умолчанию, если файла нет или он повреждён).
pub fn load(app: &AppHandle) -> Settings {
    paths::settings_file(app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    Ok(load(&app))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let file = paths::settings_file(&app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| format!("не смогли сохранить настройки: {e}"))
}
