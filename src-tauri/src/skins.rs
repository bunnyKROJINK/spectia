//! Скины: предпросмотр текущего скина аккаунта, своя коллекция скинов,
//! смена скина и плаща для лицензии Microsoft.
//! (У Ely.by скин меняется на их сайте — лаунчер его только показывает.)

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{accounts, net, paths};

const PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// Ширина и высота PNG (из заголовка файла)
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((w, h))
}

fn is_skin(bytes: &[u8]) -> bool {
    matches!(png_size(bytes), Some((64, 64)) | Some((64, 32)))
}

// ---------- Скин аккаунта ----------

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub image: String,
    pub active: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountSkin {
    /// data:image/png;base64,… (пусто — стандартный скин)
    pub image: String,
    pub slim: bool,
    pub capes: Vec<Cape>,
    /// Можно ли менять скин из лаунчера (у Ely.by — нет)
    pub editable: bool,
}

#[derive(Deserialize)]
struct McProfile {
    #[serde(default)]
    skins: Vec<McSkin>,
    #[serde(default)]
    capes: Vec<McCape>,
}

#[derive(Deserialize)]
struct McSkin {
    state: String,
    url: String,
    #[serde(default)]
    variant: String,
}

#[derive(Deserialize)]
struct McCape {
    id: String,
    state: String,
    url: String,
    #[serde(default)]
    alias: String,
}

#[tauri::command]
pub async fn account_skin(app: AppHandle, id: String) -> Result<AccountSkin, String> {
    let store = accounts::load(&app)?;
    let acc = store.accounts.iter().find(|a| a.id == id).ok_or("NO_ACCOUNT")?.clone();
    if acc.kind == "microsoft" {
        let acc = accounts::fresh_microsoft(&app, &acc.id).await?;
        let profile: McProfile = net::client()
            .get(PROFILE)
            .bearer_auth(&acc.access_token)
            .send()
            .await
            .map_err(|e| format!("NETWORK: {e}"))?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let mut out = AccountSkin { editable: true, ..Default::default() };
        if let Some(skin) = profile.skins.iter().find(|s| s.state == "ACTIVE") {
            out.image = data_url(&net::fetch(&skin.url).await?);
            out.slim = skin.variant.eq_ignore_ascii_case("slim");
        }
        for c in profile.capes {
            let image = net::fetch(&c.url).await.map(|b| data_url(&b)).unwrap_or_default();
            out.capes.push(Cape { active: c.state == "ACTIVE", id: c.id, alias: c.alias, image });
        }
        return Ok(out);
    }
    // Ely.by
    #[derive(Deserialize)]
    struct Textures {
        #[serde(rename = "SKIN")]
        skin: Option<Tex>,
    }
    #[derive(Deserialize)]
    struct Tex {
        url: String,
        #[serde(default)]
        metadata: Option<serde_json::Value>,
    }
    let mut out = AccountSkin::default();
    if let Ok(t) = net::fetch_json::<Textures>(&format!("http://skinsystem.ely.by/textures/{}", acc.name)).await {
        if let Some(skin) = t.skin {
            out.image = net::fetch(&skin.url).await.map(|b| data_url(&b)).unwrap_or_default();
            out.slim = skin.metadata.and_then(|m| m["model"].as_str().map(|s| s == "slim")).unwrap_or(false);
        }
    }
    Ok(out)
}

// ---------- Своя коллекция скинов ----------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedSkin {
    pub file: String,
    pub name: String,
    pub slim: bool,
    #[serde(default, skip_deserializing)]
    pub image: String,
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = paths::data_dir(app)?.join("skins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_library(dir: &Path) -> Vec<SavedSkin> {
    std::fs::read_to_string(dir.join("library.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_library(dir: &Path, list: &[SavedSkin]) -> Result<(), String> {
    std::fs::write(dir.join("library.json"), serde_json::to_string_pretty(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn plain(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        Err("неправильное имя".into())
    } else {
        Ok(name)
    }
}

#[tauri::command]
pub fn list_skins(app: AppHandle) -> Result<Vec<SavedSkin>, String> {
    let dir = library_dir(&app)?;
    let mut list = read_library(&dir);
    list.retain(|s| dir.join(&s.file).exists());
    for s in &mut list {
        s.image = std::fs::read(dir.join(&s.file)).map(|b| data_url(&b)).unwrap_or_default();
    }
    Ok(list)
}

fn add_to_library(app: &AppHandle, bytes: &[u8], name: &str, slim: bool) -> Result<Vec<SavedSkin>, String> {
    if !is_skin(bytes) {
        return Err("NOT_A_SKIN".into());
    }
    let dir = library_dir(app)?;
    let file = format!("skin-{}.png", uuid::Uuid::new_v4().simple());
    std::fs::write(dir.join(&file), bytes).map_err(|e| e.to_string())?;
    let mut list = read_library(&dir);
    list.insert(0, SavedSkin { file, name: name.to_string(), slim, image: String::new() });
    write_library(&dir, &list)?;
    list_skins(app.clone())
}

/// Выбрать .png на компьютере и добавить в коллекцию
#[tauri::command]
pub async fn import_skin(app: AppHandle) -> Result<Option<Vec<SavedSkin>>, String> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog_app.dialog().file().add_filter("Скин (.png)", &["png"]).blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Скин".into());
    add_to_library(&app, &bytes, &name, false).map(Some)
}

/// Сохранить текущий скин аккаунта в коллекцию
#[tauri::command]
pub fn save_skin_data(app: AppHandle, data_url_str: String, name: String, slim: bool) -> Result<Vec<SavedSkin>, String> {
    let b64 = data_url_str.split_once(',').map(|(_, b)| b).unwrap_or(&data_url_str);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    add_to_library(&app, &bytes, &name, slim)
}

#[tauri::command]
pub fn update_skin(app: AppHandle, file: String, name: String, slim: bool) -> Result<Vec<SavedSkin>, String> {
    let dir = library_dir(&app)?;
    let mut list = read_library(&dir);
    if let Some(s) = list.iter_mut().find(|s| s.file == file) {
        s.name = name;
        s.slim = slim;
    }
    write_library(&dir, &list)?;
    list_skins(app)
}

#[tauri::command]
pub fn delete_skin(app: AppHandle, file: String) -> Result<Vec<SavedSkin>, String> {
    let dir = library_dir(&app)?;
    let _ = std::fs::remove_file(dir.join(plain(&file)?));
    let mut list = read_library(&dir);
    list.retain(|s| s.file != file);
    write_library(&dir, &list)?;
    list_skins(app)
}

/// Поставить скин из коллекции на лицензионный аккаунт
#[tauri::command]
pub async fn apply_skin(app: AppHandle, account: String, file: String) -> Result<(), String> {
    let dir = library_dir(&app)?;
    let skin = read_library(&dir).into_iter().find(|s| s.file == file).ok_or("скин не найден")?;
    let bytes = std::fs::read(dir.join(plain(&skin.file)?)).map_err(|e| e.to_string())?;
    let acc = accounts::fresh_microsoft(&app, &account).await.map_err(|e| if e == "NO_ACCOUNT" { "ELY_SITE".to_string() } else { e })?;
    let part = reqwest::multipart::Part::bytes(bytes).file_name("skin.png").mime_str("image/png").map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("variant", if skin.slim { "slim" } else { "classic" }).part("file", part);
    net::client()
        .post(format!("{PROFILE}/skins"))
        .bearer_auth(&acc.access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Minecraft: {e}"))?;
    Ok(())
}

/// Выбрать плащ (или снять его, если cape = None)
#[tauri::command]
pub async fn set_cape(app: AppHandle, account: String, cape: Option<String>) -> Result<(), String> {
    let acc = accounts::fresh_microsoft(&app, &account).await?;
    let url = format!("{PROFILE}/capes/active");
    let req = match cape {
        Some(id) => net::client().put(&url).json(&serde_json::json!({ "capeId": id })),
        None => net::client().delete(&url),
    };
    req.bearer_auth(&acc.access_token)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Minecraft: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_header() {
        let mut fake = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        fake.extend_from_slice(&64u32.to_be_bytes());
        fake.extend_from_slice(&32u32.to_be_bytes());
        assert_eq!(png_size(&fake), Some((64, 32)));
        assert!(is_skin(&fake));
        assert!(!is_skin(b"not a png at all, sorry"));
    }
}
