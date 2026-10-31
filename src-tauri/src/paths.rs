//! Где Spectia хранит свои файлы.
//!
//! На Windows это обычно `C:\Users\<имя>\AppData\Roaming\io.github.bunnykrojink.spectia`.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Корневая папка с данными лаунчера (создаётся, если её нет).
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("не нашли папку для данных: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("не смогли создать {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Папка, где лежат все сборки.
pub fn instances_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("instances");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не смогли создать {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Файл с настройками лаунчера.
pub fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}
