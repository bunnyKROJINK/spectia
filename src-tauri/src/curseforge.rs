//! Импорт сборок CurseForge (.zip с manifest.json).
//!
//! Для скачивания модов CurseForge нужен ключ API. Он вшивается при сборке из секрета
//! GitHub SPECTIA_CF_KEY (в открытом коде его нет), а ещё можно указать свой ключ
//! в настройках. Некоторые авторы запрещают скачивать свои моды из сторонних лаунчеров —
//! такие файлы мы не трогаем, а даём ссылку на страницу мода, чтобы скачать вручную.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Emitter};

use crate::{instances, net, settings};

const API: &str = "https://api.curseforge.com/v1";
const BUILT_IN_KEY: Option<&str> = option_env!("SPECTIA_CF_KEY");

pub fn key(app: &AppHandle) -> Option<String> {
    let own = settings::load(app).curseforge_key.trim().to_string();
    if !own.is_empty() {
        return Some(own);
    }
    BUILT_IN_KEY.map(str::to_string).filter(|k| !k.is_empty())
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(default)]
    name: String,
    minecraft: McPart,
    #[serde(default)]
    files: Vec<ManifestFile>,
    #[serde(default = "default_overrides")]
    overrides: String,
}
fn default_overrides() -> String {
    "overrides".into()
}

#[derive(Deserialize)]
struct McPart {
    version: String,
    #[serde(default, rename = "modLoaders")]
    mod_loaders: Vec<Loader>,
}

#[derive(Deserialize)]
struct Loader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManualFile {
    pub name: String,
    pub url: String,
}

/// «forge-47.2.0» → ("forge", "1.20.1-47.2.0")
fn loader_of(game: &str, loaders: &[Loader]) -> (String, String) {
    let Some(l) = loaders.iter().find(|l| l.primary).or(loaders.first()) else { return ("vanilla".into(), String::new()) };
    let (name, ver) = l.id.split_once('-').unwrap_or((&l.id, ""));
    match name {
        "forge" => ("forge".into(), format!("{game}-{ver}")),
        "neoforge" => ("neoforge".into(), ver.to_string()),
        "fabric" => ("fabric".into(), ver.to_string()),
        "quilt" => ("quilt".into(), ver.to_string()),
        _ => ("vanilla".into(), String::new()),
    }
}

async fn cf_post(key: &str, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    net::client()
        .post(format!("{API}{path}"))
        .header("x-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?
        .error_for_status()
        .map_err(|e| format!("CurseForge: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// Есть ли в архиве manifest.json от CurseForge
pub fn is_curseforge(zip: &mut zip::ZipArchive<std::fs::File>) -> bool {
    let Ok(mut e) = zip.by_name("manifest.json") else { return false };
    let mut text = String::new();
    e.read_to_string(&mut text).is_ok() && text.contains("\"minecraft\"")
}

pub async fn import(app: &AppHandle, file: &Path) -> Result<(instances::Instance, Vec<ManualFile>), String> {
    let f = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let manifest: Manifest = {
        let mut e = zip.by_name("manifest.json").map_err(|_| "NOT_A_PACK".to_string())?;
        let mut text = String::new();
        e.read_to_string(&mut text).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("manifest.json: {e}"))?
    };
    if !manifest.files.is_empty() && key(app).is_none() {
        return Err("CF_NO_KEY".into());
    }
    let (loader, loader_version) = loader_of(&manifest.minecraft.version, &manifest.minecraft.mod_loaders);
    let inst = instances::create(
        app,
        instances::NewInstance {
            name: if manifest.name.is_empty() { "Сборка CurseForge".into() } else { manifest.name.clone() },
            game_version: manifest.minecraft.version.clone(),
            loader,
            loader_version,
            tint: (instances::now_secs() % 6) as u8,
        },
    )?;
    let game = instances::dir(app, &inst.id)?.join("minecraft");

    // overrides/ — настройки, конфиги, иногда моды
    let prefix = format!("{}/", manifest.overrides.trim_end_matches('/'));
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix(&prefix) else { continue };
        let rel = Path::new(rel);
        if entry.is_dir() || rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
            continue;
        }
        let out = game.join(rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
    }

    let mut manual = Vec::new();
    if let (false, Some(key)) = (manifest.files.is_empty(), key(app)) {
        let file_ids: Vec<u64> = manifest.files.iter().map(|f| f.file_id).collect();
        let mod_ids: Vec<u64> = manifest.files.iter().map(|f| f.project_id).collect();
        let files = cf_post(&key, "/mods/files", json!({ "fileIds": file_ids })).await?;
        let mods = cf_post(&key, "/mods", json!({ "modIds": mod_ids })).await?;
        let mods = mods["data"].as_array().cloned().unwrap_or_default();
        let list = files["data"].as_array().cloned().unwrap_or_default();
        let total = list.len();
        for (n, f) in list.iter().enumerate() {
            let _ = app.emit("import-progress", json!({ "done": n, "total": total }));
            let mod_id = f["modId"].as_u64().unwrap_or(0);
            let m = mods.iter().find(|m| m["id"].as_u64() == Some(mod_id));
            let title = m.and_then(|m| m["name"].as_str()).unwrap_or_else(|| f["displayName"].as_str().unwrap_or("?")).to_string();
            let folder = match m.and_then(|m| m["classId"].as_u64()) {
                Some(12) => "resourcepacks",
                Some(6552) => "shaderpacks",
                _ => "mods",
            };
            let file_name = f["fileName"].as_str().unwrap_or_default();
            if file_name.is_empty() || file_name.contains(['/', '\\']) || file_name.contains("..") {
                continue;
            }
            let sha1 = f["hashes"].as_array().and_then(|h| h.iter().find(|x| x["algo"].as_u64() == Some(1))).and_then(|x| x["value"].as_str());
            match f["downloadUrl"].as_str() {
                Some(url) if !url.is_empty() => net::download(url, &game.join(folder).join(file_name), sha1).await?,
                _ => {
                    let page = m.and_then(|m| m["links"]["websiteUrl"].as_str()).unwrap_or("https://www.curseforge.com/minecraft");
                    manual.push(ManualFile { name: title, url: format!("{page}/files/{}", f["id"].as_u64().unwrap_or(0)) });
                }
            }
        }
        let _ = app.emit("import-progress", json!({ "done": total, "total": total }));
    }
    Ok((inst, manual))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loaders() {
        let l = vec![Loader { id: "forge-47.2.0".into(), primary: true }];
        assert_eq!(loader_of("1.20.1", &l), ("forge".into(), "1.20.1-47.2.0".into()));
        let l = vec![Loader { id: "neoforge-21.1.200".into(), primary: true }];
        assert_eq!(loader_of("1.21.1", &l), ("neoforge".into(), "21.1.200".into()));
        assert_eq!(loader_of("1.20.1", &[]).0, "vanilla");
    }
}
