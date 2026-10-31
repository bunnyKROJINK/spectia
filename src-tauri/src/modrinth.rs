//! Установка с Modrinth в один клик (вместе с зависимостями) и проверка обновлений модов.
//!
//! Что откуда установлено, лаунчер записывает в content.json в папке сборки —
//! так он помнит, какие моды пришли с Modrinth, и может показать «Установлено».
//! Обновления — только по кнопке: моды никогда не обновляются сами.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{history, instances, net};

const API: &str = "https://api.modrinth.com/v2";

// ---------- Ответы Modrinth ----------

#[derive(Debug, Deserialize, Clone)]
pub struct MrVersion {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version_type: String,
    #[serde(default)]
    pub files: Vec<MrFile>,
    #[serde(default)]
    pub dependencies: Vec<MrDependency>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MrFile {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    pub hashes: HashMap<String, String>,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MrDependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Deserialize)]
struct MrProject {
    title: String,
    project_type: String,
}

impl MrVersion {
    pub fn primary_file(&self) -> Option<&MrFile> {
        self.files.iter().find(|f| f.primary).or(self.files.first())
    }
}

// ---------- Что уже установлено ----------

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentEntry {
    pub project_id: String,
    pub version_id: String,
    pub title: String,
}

/// content.json: "mods/sodium.jar" → откуда он
pub type ContentIndex = HashMap<String, ContentEntry>;

pub fn read_index(inst_dir: &Path) -> ContentIndex {
    std::fs::read_to_string(inst_dir.join("content.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn write_index(inst_dir: &Path, index: &ContentIndex) -> Result<(), String> {
    let text = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(inst_dir.join("content.json"), text).map_err(|e| e.to_string())
}

/// Ключ в content.json без «.disabled», чтобы выключенный мод тоже считался установленным.
fn index_key(folder: &str, file: &str) -> String {
    format!("{folder}/{}", file.trim_end_matches(".disabled"))
}

#[tauri::command]
pub fn installed_projects(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let dir = instances::dir(&app, &id)?;
    let game = dir.join("minecraft");
    Ok(read_index(&dir)
        .into_iter()
        .filter(|(path, _)| game.join(path).exists() || game.join(format!("{path}.disabled")).exists())
        .map(|(_, e)| e.project_id)
        .collect())
}

// ---------- Подбор версии ----------

/// Какие «загрузчики» Modrinth подходят к сборке
pub fn mr_loaders(loader: &str, kind: &str) -> Vec<&'static str> {
    match kind {
        "resourcepack" => vec!["minecraft"],
        "shader" => vec![], // у шейдеров «загрузчик» — это Iris/OptiFine, не фильтруем
        "datapack" => vec!["datapack"],
        _ => match loader {
            "fabric" => vec!["fabric"],
            "quilt" => vec!["quilt", "fabric"],
            "forge" => vec!["forge"],
            "neoforge" => vec!["neoforge"],
            _ => vec![],
        },
    }
}

fn folder_for(kind: &str) -> Option<&'static str> {
    match kind {
        "mod" => Some("mods"),
        "resourcepack" => Some("resourcepacks"),
        "shader" => Some("shaderpacks"),
        _ => None,
    }
}

pub async fn compatible_version(project: &str, game: &str, loaders: &[&str]) -> Result<Option<MrVersion>, String> {
    let mut url = format!("{API}/project/{project}/version?game_versions={}", urlencode(&format!("[\"{game}\"]")));
    if !loaders.is_empty() {
        let list = loaders.iter().map(|l| format!("\"{l}\"")).collect::<Vec<_>>().join(",");
        url.push_str(&format!("&loaders={}", urlencode(&format!("[{list}]"))));
    }
    let versions: Vec<MrVersion> = net::fetch_json(&url).await?;
    // Предпочитаем стабильные версии; список уже отсортирован от новых к старым
    Ok(versions.iter().find(|v| v.version_type == "release").or(versions.first()).cloned())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ---------- Установка ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// Названия всего, что поставили (сам проект + зависимости)
    pub installed: Vec<String>,
}

#[tauri::command]
pub async fn install_project(app: AppHandle, id: String, project_id: String, world: Option<String>) -> Result<InstallResult, String> {
    let inst = instances::read(&app, &id)?;
    let dir = instances::dir(&app, &id)?;
    if let Some(world) = world {
        return install_datapack(&dir, &inst.game_version, &project_id, &world).await;
    }
    install_into(&dir, &inst.game_version, &inst.loader, &project_id).await
}

/// Датапак ставится в папку datapacks конкретного мира
async fn install_datapack(inst_dir: &Path, game: &str, project_id: &str, world: &str) -> Result<InstallResult, String> {
    if world.is_empty() || world.contains(['/', '\\']) || world.contains("..") {
        return Err("неправильное имя мира".into());
    }
    let world_dir = inst_dir.join("minecraft").join("saves").join(world);
    if !world_dir.join("level.dat").exists() {
        return Err("такого мира нет".into());
    }
    let project: MrProject = net::fetch_json(&format!("{API}/project/{project_id}")).await?;
    let version = compatible_version(project_id, game, &["datapack"])
        .await?
        .ok_or_else(|| format!("NO_COMPATIBLE_VERSION:{}", project.title))?;
    let file = version.primary_file().ok_or("у этой версии нет файла")?;
    if file.filename.contains(['/', '\\']) || file.filename.contains("..") {
        return Err("странное имя файла".into());
    }
    net::download(&file.url, &world_dir.join("datapacks").join(&file.filename), file.hashes.get("sha1").map(String::as_str)).await?;
    history::log(inst_dir, "installed", &project.title, &format!("datapack → {world}"));
    Ok(InstallResult { installed: vec![project.title] })
}

/// Ставит проект и все обязательные зависимости в папку сборки.
pub async fn install_into(inst_dir: &Path, game: &str, loader: &str, project_id: &str) -> Result<InstallResult, String> {
    let game_dir = inst_dir.join("minecraft");
    let mut index = read_index(inst_dir);
    let mut already: HashSet<String> = index
        .iter()
        .filter(|(p, _)| game_dir.join(p).exists() || game_dir.join(format!("{p}.disabled")).exists())
        .map(|(_, e)| e.project_id.clone())
        .collect();
    let mut installed = Vec::new();
    let mut queue: Vec<(String, Option<String>)> = vec![(project_id.to_string(), None)];

    while let Some((pid, vid)) = queue.pop() {
        if already.contains(&pid) {
            continue;
        }
        let project: MrProject = net::fetch_json(&format!("{API}/project/{pid}")).await?;
        let Some(folder) = folder_for(&project.project_type) else {
            return Err(format!("UNSUPPORTED_TYPE:{}", project.project_type));
        };
        let version = match vid {
            Some(v) => net::fetch_json::<MrVersion>(&format!("{API}/version/{v}")).await?,
            None => compatible_version(&pid, game, &mr_loaders(loader, &project.project_type))
                .await?
                .ok_or_else(|| format!("NO_COMPATIBLE_VERSION:{}", project.title))?,
        };
        let file = version.primary_file().ok_or("у этой версии нет файла")?.clone();
        if file.filename.contains(['/', '\\']) || file.filename.contains("..") {
            return Err("странное имя файла".into());
        }
        let path = game_dir.join(folder).join(&file.filename);
        net::download(&file.url, &path, file.hashes.get("sha1").map(String::as_str)).await?;
        history::log(inst_dir, "installed", &project.title, &format!("{folder}/{}", file.filename));
        index.insert(
            index_key(folder, &file.filename),
            ContentEntry { project_id: pid.clone(), version_id: version.id.clone(), title: project.title.clone() },
        );
        already.insert(pid.clone());
        installed.push(project.title);

        for dep in &version.dependencies {
            if dep.dependency_type != "required" {
                continue;
            }
            match (&dep.project_id, &dep.version_id) {
                (Some(p), v) => queue.push((p.clone(), v.clone())),
                (None, Some(v)) => {
                    // Иногда указана только версия — узнаём по ней проект
                    if let Ok(ver) = net::fetch_json::<MrVersion>(&format!("{API}/version/{v}")).await {
                        queue.push((ver.project_id, Some(v.clone())));
                    }
                }
                _ => {}
            }
        }
    }
    write_index(inst_dir, &index)?;
    Ok(InstallResult { installed })
}

// ---------- Обновления модов (только по кнопке) ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    pub file: String,
    pub name: String,
    pub current: String,
    pub latest: String,
    pub url: String,
    pub filename: String,
    pub sha1: String,
    pub project_id: String,
    pub version_id: String,
}

/// Хэши всех .jar в папке модов → имя файла
fn hash_mods(mods: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Ok(rd) = std::fs::read_dir(mods) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) {
                continue;
            }
            if let Ok(bytes) = std::fs::read(e.path()) {
                out.insert(net::sha1_hex(&bytes), name);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn check_mod_updates(app: AppHandle, id: String) -> Result<Vec<ModUpdate>, String> {
    let inst = instances::read(&app, &id)?;
    let mods = instances::dir(&app, &id)?.join("minecraft").join("mods");
    let hashes = hash_mods(&mods);
    if hashes.is_empty() {
        return Ok(vec![]);
    }
    let keys: Vec<&String> = hashes.keys().collect();

    let current: HashMap<String, MrVersion> = post_json(
        &format!("{API}/version_files"),
        &serde_json::json!({ "hashes": keys, "algorithm": "sha1" }),
    )
    .await?;
    let latest: HashMap<String, MrVersion> = post_json(
        &format!("{API}/version_files/update"),
        &serde_json::json!({
            "hashes": keys,
            "algorithm": "sha1",
            "loaders": mr_loaders(&inst.loader, "mod"),
            "game_versions": [inst.game_version],
        }),
    )
    .await?;

    let mut out = Vec::new();
    for (hash, file) in &hashes {
        let (Some(cur), Some(new)) = (current.get(hash), latest.get(hash)) else { continue };
        if cur.id == new.id {
            continue;
        }
        let Some(f) = new.primary_file() else { continue };
        if f.hashes.get("sha1") == Some(hash) {
            continue;
        }
        out.push(ModUpdate {
            file: file.clone(),
            name: file.trim_end_matches(".disabled").trim_end_matches(".jar").to_string(),
            current: cur.version_number.clone(),
            latest: new.version_number.clone(),
            url: f.url.clone(),
            filename: f.filename.clone(),
            sha1: f.hashes.get("sha1").cloned().unwrap_or_default(),
            project_id: new.project_id.clone(),
            version_id: new.id.clone(),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn apply_mod_updates(app: AppHandle, id: String, updates: Vec<ModUpdate>) -> Result<usize, String> {
    let dir = instances::dir(&app, &id)?;
    let mods = dir.join("minecraft").join("mods");
    let mut index = read_index(&dir);
    let mut done = 0;
    for u in updates {
        if u.file.contains(['/', '\\']) || u.filename.contains(['/', '\\']) || u.file.contains("..") || u.filename.contains("..") {
            continue;
        }
        // Выключенный мод после обновления тоже остаётся выключенным
        let disabled = u.file.ends_with(".disabled");
        let new_name = if disabled { format!("{}.disabled", u.filename) } else { u.filename.clone() };
        let tmp: PathBuf = mods.join(format!("{}.download", u.filename));
        net::download(&u.url, &tmp, if u.sha1.is_empty() { None } else { Some(u.sha1.as_str()) }).await?;
        let old_entry = index.remove(&index_key("mods", &u.file));
        let _ = std::fs::remove_file(mods.join(&u.file));
        std::fs::rename(&tmp, mods.join(&new_name)).map_err(|e| e.to_string())?;
        index.insert(
            index_key("mods", &u.filename),
            ContentEntry {
                project_id: u.project_id.clone(),
                version_id: u.version_id.clone(),
                title: old_entry.as_ref().map(|e| e.title.clone()).filter(|t| !t.is_empty()).unwrap_or(u.name.clone()),
            },
        );
        let title = old_entry.map(|e| e.title).filter(|t| !t.is_empty()).unwrap_or(u.name.clone());
        history::log(&dir, "updated", &title, &format!("{} → {}", u.current, u.latest));
        done += 1;
    }
    write_index(&dir, &index)?;
    Ok(done)
}

/// Удалить то, что поставили из каталога (кнопка-корзинка рядом с «Установлено»)
#[tauri::command]
pub fn remove_project(app: AppHandle, id: String, project_id: String) -> Result<Vec<String>, String> {
    let dir = instances::dir(&app, &id)?;
    let game = dir.join("minecraft");
    let mut index = read_index(&dir);
    let keys: Vec<String> = index.iter().filter(|(_, e)| e.project_id == project_id).map(|(k, _)| k.clone()).collect();
    let mut removed = Vec::new();
    for key in keys {
        let Some(rel) = Path::new(&key).components().all(|c| matches!(c, std::path::Component::Normal(_))).then(|| game.join(&key)) else { continue };
        let mut gone = false;
        for path in [rel.clone(), PathBuf::from(format!("{}.disabled", rel.to_string_lossy()))] {
            if path.is_file() && std::fs::remove_file(&path).is_ok() {
                gone = true;
            }
        }
        let entry = index.remove(&key).unwrap_or_default();
        let title = if entry.title.is_empty() { history::pretty(key.rsplit('/').next().unwrap_or(&key)) } else { entry.title };
        if gone {
            history::log(&dir, "removed", &title, &key);
            removed.push(title);
        }
    }
    write_index(&dir, &index)?;
    Ok(removed)
}

// ---------- Зависимости ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepProblem {
    /// missing — нужного мода нет; conflict — стоит мод, с которым этот не дружит
    pub kind: String,
    pub project_id: String,
    pub title: String,
    /// Кому он нужен (или с кем конфликтует)
    pub needed_by: Vec<String>,
}

#[derive(Deserialize)]
struct MrProjectShort {
    id: String,
    title: String,
}

/// Проверяет, все ли зависимости модов на месте. Опирается на данные Modrinth:
/// моды, которых там нет, проверить не получится — их просто пропускаем.
#[tauri::command]
pub async fn check_dependencies(app: AppHandle, id: String) -> Result<Vec<DepProblem>, String> {
    let dir = instances::dir(&app, &id)?;
    let mods = dir.join("minecraft").join("mods");
    // Только включённые моды: выключенные игра не видит
    let hashes: HashMap<String, String> = hash_mods(&mods).into_iter().filter(|(_, f)| !f.ends_with(".disabled")).collect();
    if hashes.is_empty() {
        return Ok(vec![]);
    }
    let keys: Vec<&String> = hashes.keys().collect();
    let versions: HashMap<String, MrVersion> =
        post_json(&format!("{API}/version_files"), &serde_json::json!({ "hashes": keys, "algorithm": "sha1" })).await?;
    let present: HashSet<String> = versions.values().map(|v| v.project_id.clone()).collect();
    let titles_of_present: HashMap<String, String> = {
        let ids: Vec<&String> = present.iter().collect();
        let list: Vec<MrProjectShort> = if ids.is_empty() {
            vec![]
        } else {
            net::fetch_json(&format!("{API}/projects?ids={}", urlencode(&serde_json::to_string(&ids).unwrap_or_default()))).await.unwrap_or_default()
        };
        list.into_iter().map(|p| (p.id, p.title)).collect()
    };

    // project_id → (вид проблемы, кому нужен)
    let mut problems: HashMap<(String, String), Vec<String>> = HashMap::new();
    for v in versions.values() {
        let who = titles_of_present.get(&v.project_id).cloned().unwrap_or_else(|| v.name.clone());
        for d in &v.dependencies {
            let Some(pid) = &d.project_id else { continue };
            let kind = match d.dependency_type.as_str() {
                "required" if !present.contains(pid) => "missing",
                "incompatible" if present.contains(pid) => "conflict",
                _ => continue,
            };
            problems.entry((kind.to_string(), pid.clone())).or_default().push(who.clone());
        }
    }
    if problems.is_empty() {
        return Ok(vec![]);
    }
    let ids: Vec<&String> = problems.keys().map(|(_, p)| p).collect();
    let names: HashMap<String, String> = net::fetch_json::<Vec<MrProjectShort>>(&format!(
        "{API}/projects?ids={}",
        urlencode(&serde_json::to_string(&ids).unwrap_or_default())
    ))
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|p| (p.id, p.title))
    .collect();
    let mut out: Vec<DepProblem> = problems
        .into_iter()
        .map(|((kind, pid), mut who)| {
            who.sort();
            who.dedup();
            DepProblem { title: names.get(&pid).cloned().unwrap_or_else(|| titles_of_present.get(&pid).cloned().unwrap_or(pid.clone())), kind, project_id: pid, needed_by: who }
        })
        .collect();
    out.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.title.cmp(&b.title)));
    Ok(out)
}

pub async fn post_json<T: serde::de::DeserializeOwned>(url: &str, body: &serde_json::Value) -> Result<T, String> {
    let res = net::client().post(url).json(body).send().await.map_err(|e| format!("нет связи с Modrinth: {e}"))?;
    let res = res.error_for_status().map_err(|e| format!("Modrinth ответил ошибкой: {e}"))?;
    res.json().await.map_err(|e| format!("непонятный ответ Modrinth: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode() {
        assert_eq!(urlencode("[\"26.3\"]"), "%5B%2226.3%22%5D");
    }

    #[test]
    fn keys() {
        assert_eq!(index_key("mods", "a.jar.disabled"), "mods/a.jar");
    }
}
