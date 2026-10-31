//! Сборки (инстансы): у каждой своя папка с файлом `instance.json`,
//! своими модами, мирами и настройками.
//!
//! instances/
//!   vyzhivanie-1730000000/
//!     instance.json
//!     minecraft/        ← сюда игра положит миры, моды, скриншоты

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub game_version: String,
    /// "vanilla", "fabric", "forge", "neoforge" или "quilt"
    pub loader: String,
    /// Номер цвета обложки (0–5)
    pub tint: u8,
    /// Память в гигабайтах
    pub memory_gb: u8,
    /// Пусто = подобрать Java автоматически
    pub java_path: String,
    pub window_width: u32,
    pub window_height: u32,
    pub fullscreen: bool,
    pub auto_join_server: String,
    pub jvm_args: String,
    pub pre_launch_command: String,
    pub post_exit_command: String,
    pub wrapper_command: String,
    pub env_vars: String,
    pub show_console: bool,
    pub created_at: u64,
}

impl Default for Instance {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            game_version: String::new(),
            loader: "vanilla".into(),
            tint: 0,
            memory_gb: 4,
            java_path: String::new(),
            window_width: 1280,
            window_height: 720,
            fullscreen: false,
            auto_join_server: String::new(),
            jvm_args: String::new(),
            pre_launch_command: String::new(),
            post_exit_command: String::new(),
            wrapper_command: String::new(),
            env_vars: String::new(),
            show_console: false,
            created_at: 0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInstance {
    pub name: String,
    pub game_version: String,
    pub loader: String,
    pub tint: u8,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Делает из названия безопасное имя папки: «Уютная кухня!» → «uyutnaya-kuhnya».
fn slugify(name: &str) -> String {
    const MAP: &[(char, &str)] = &[
        ('а', "a"), ('б', "b"), ('в', "v"), ('г', "g"), ('д', "d"), ('е', "e"), ('ё', "e"),
        ('ж', "zh"), ('з', "z"), ('и', "i"), ('й', "y"), ('к', "k"), ('л', "l"), ('м', "m"),
        ('н', "n"), ('о', "o"), ('п', "p"), ('р', "r"), ('с', "s"), ('т', "t"), ('у', "u"),
        ('ф', "f"), ('х', "h"), ('ц', "ts"), ('ч', "ch"), ('ш', "sh"), ('щ', "sch"), ('ъ', ""),
        ('ы', "y"), ('ь', ""), ('э', "e"), ('ю', "yu"), ('я', "ya"),
    ];
    let mut out = String::new();
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if let Some((_, lat)) = MAP.iter().find(|(c, _)| *c == ch) {
            out.push_str(lat);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').chars().take(40).collect::<String>();
    if out.is_empty() { "sborka".into() } else { out }
}

/// Защита от странных id вроде "../../" — пускаем только буквы, цифры и дефис.
fn instance_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("неправильное имя сборки".into());
    }
    Ok(paths::instances_dir(app)?.join(id))
}

/// Папка сборки (для запуска игры).
pub fn dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let d = instance_path(app, id)?;
    if !d.exists() {
        return Err("такой сборки больше нет".into());
    }
    Ok(d)
}

/// Читает настройки одной сборки.
pub fn read(app: &AppHandle, id: &str) -> Result<Instance, String> {
    let text = std::fs::read_to_string(dir(app, id)?.join("instance.json")).map_err(|e| e.to_string())?;
    let mut inst: Instance = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    inst.id = id.to_string();
    Ok(inst)
}

fn write_instance(dir: &PathBuf, inst: &Instance) -> Result<(), String> {
    let text = serde_json::to_string_pretty(inst).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("instance.json"), text).map_err(|e| format!("не смогли сохранить сборку: {e}"))
}

#[tauri::command]
pub fn list_instances(app: AppHandle) -> Result<Vec<Instance>, String> {
    let dir = paths::instances_dir(&app)?;
    let mut list = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let file = entry.path().join("instance.json");
        if let Ok(text) = std::fs::read_to_string(&file) {
            if let Ok(mut inst) = serde_json::from_str::<Instance>(&text) {
                inst.id = entry.file_name().to_string_lossy().into_owned();
                list.push(inst);
            }
        }
    }
    // Новые сборки — сверху.
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(list)
}

#[tauri::command]
pub fn create_instance(app: AppHandle, data: NewInstance) -> Result<Instance, String> {
    let name = data.name.trim();
    let name = if name.is_empty() { "Новая сборка" } else { name };
    let id = format!("{}-{}", slugify(name), now());
    let dir = instance_path(&app, &id)?;
    std::fs::create_dir_all(dir.join("minecraft")).map_err(|e| format!("не смогли создать папку сборки: {e}"))?;

    let inst = Instance {
        id,
        name: name.to_string(),
        game_version: data.game_version,
        loader: data.loader,
        tint: data.tint.min(5),
        created_at: now(),
        ..Instance::default()
    };
    write_instance(&dir, &inst)?;
    Ok(inst)
}

#[tauri::command]
pub fn update_instance(app: AppHandle, instance: Instance) -> Result<Instance, String> {
    let dir = instance_path(&app, &instance.id)?;
    if !dir.exists() {
        return Err("такой сборки больше нет".into());
    }
    let mut inst = instance;
    inst.memory_gb = inst.memory_gb.clamp(1, 32);
    write_instance(&dir, &inst)?;
    Ok(inst)
}

#[tauri::command]
pub fn delete_instance(app: AppHandle, id: String) -> Result<(), String> {
    let dir = instance_path(&app, &id)?;
    std::fs::remove_dir_all(&dir).map_err(|e| format!("не смогли удалить сборку: {e}"))
}

#[tauri::command]
pub fn open_instance_folder(app: AppHandle, id: String) -> Result<(), String> {
    let dir = instance_path(&app, &id)?.join("minecraft");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("не смогли открыть папку: {e}"))
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slug_works_for_russian() {
        assert_eq!(slugify("Уютная кухня!"), "uyutnaya-kuhnya");
        assert_eq!(slugify("   "), "sborka");
    }
}
