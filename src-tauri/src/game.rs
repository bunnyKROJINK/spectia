//! Всё про файлы самой игры: описание версии от Mojang, библиотеки,
//! «нативные» библиотеки, звуки и текстуры (ассеты) и сборка команды запуска.
//!
//! Общие файлы лежат в папке данных лаунчера и переиспользуются всеми сборками:
//!   versions/<версия>/   описание версии и client.jar
//!   libraries/           библиотеки Java
//!   assets/              звуки, текстуры, языки
//!   natives/<версия>/    распакованные системные библиотеки (для старых версий)

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::launch::Progress;
use crate::net;

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES_URL: &str = "https://resources.download.minecraft.net";
const LIBRARIES_URL: &str = "https://libraries.minecraft.net";
/// Сколько файлов качать одновременно
const PARALLEL: usize = 16;

// ---------- Описание версии ----------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    pub main_class: String,
    #[serde(default)]
    pub arguments: Option<Arguments>,
    /// Старый формат аргументов (до 1.13)
    #[serde(default)]
    pub minecraft_arguments: Option<String>,
    #[serde(default)]
    pub asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    pub assets: Option<String>,
    #[serde(default)]
    pub downloads: Option<VersionDownloads>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    #[serde(default)]
    pub java_version: Option<JavaVersion>,
    #[serde(default)]
    pub logging: Option<Logging>,
    /// Для загрузчиков модов (Fabric и др.) — версия, на которой они основаны. Пригодится в 0.3.
    #[serde(default)]
    pub inherits_from: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<serde_json::Value>,
    #[serde(default)]
    pub jvm: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AssetIndexRef {
    pub id: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct VersionDownloads {
    pub client: Option<Artifact>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Logging {
    pub client: Option<LoggingClient>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LoggingClient {
    pub argument: String,
    pub file: LoggingFile,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Artifact {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Library {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,
    #[serde(default)]
    pub rules: Option<Vec<Rule>>,
    /// У библиотек загрузчиков модов вместо downloads бывает адрес maven-репозитория
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    #[serde(default)]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Rule {
    pub action: String,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
}

// ---------- Правила «для какой системы этот файл» ----------

pub fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn os_arch() -> &'static str {
    if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86_64"
    }
}

/// Включённые «особенности» запуска (своё разрешение окна, быстрый вход на сервер…)
pub type Features = HashMap<&'static str, bool>;

pub fn rules_allow(rules: &Option<Vec<Rule>>, features: &Features) -> bool {
    let Some(rules) = rules else { return true };
    let mut allowed = false;
    for rule in rules {
        let mut matches = true;
        if let Some(os) = &rule.os {
            if let Some(name) = &os.name {
                matches &= name == os_name();
            }
            if let Some(arch) = &os.arch {
                matches &= arch == os_arch() || (arch == "x86" && os_arch() == "x86");
            }
        }
        if let Some(f) = &rule.features {
            for (key, want) in f {
                matches &= features.get(key.as_str()).copied().unwrap_or(false) == *want;
            }
        }
        if matches {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

/// "group:artifact:version[:classifier][@ext]" → путь в maven-репозитории.
pub fn maven_path(name: &str) -> Option<String> {
    let (coords, ext) = match name.split_once('@') {
        Some((c, e)) => (c, e),
        None => (name, "jar"),
    };
    let parts: Vec<&str> = coords.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let (artifact, version) = (parts[1], parts[2]);
    let file = match parts.get(3) {
        Some(classifier) => format!("{artifact}-{version}-{classifier}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    Some(format!("{group}/{artifact}/{version}/{file}"))
}

// ---------- Загрузка описания версии ----------

#[derive(Deserialize)]
struct Manifest {
    versions: Vec<ManifestEntry>,
}

#[derive(Deserialize)]
struct ManifestEntry {
    id: String,
    url: String,
    sha1: Option<String>,
}

/// Скачивает (или берёт из кэша) описание версии.
pub async fn load_version(data: &Path, id: &str) -> Result<VersionJson, String> {
    let file = data.join("versions").join(id).join(format!("{id}.json"));
    if !file.exists() {
        let manifest: Manifest = net::fetch_json(MANIFEST_URL).await?;
        let entry = manifest
            .versions
            .iter()
            .find(|v| v.id == id)
            .ok_or_else(|| format!("Mojang не знает версию {id}"))?;
        net::download(&entry.url, &file, entry.sha1.as_deref()).await?;
    }
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("не смогли прочитать описание версии {id}: {e}"))
}

// ---------- Скачивание всего нужного ----------

/// Один файл, который нужно иметь на диске.
#[derive(Clone)]
struct Job {
    url: String,
    path: PathBuf,
    sha1: Option<String>,
    size: Option<u64>,
}

async fn run_jobs(jobs: Vec<Job>, progress: &Progress, stage: &str) -> Result<(), String> {
    let jobs: Vec<Job> = jobs.into_iter().filter(|j| !net::is_present(&j.path, j.sha1.as_deref(), j.size)).collect();
    let total = jobs.len();
    if total == 0 {
        return Ok(());
    }
    let done = AtomicUsize::new(0);
    progress.stage(stage, 0, total);
    let results: Vec<Result<(), String>> = stream::iter(jobs)
        .map(|job| {
            let done = &done;
            async move {
                let r = net::download(&job.url, &job.path, job.sha1.as_deref()).await;
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                if n % 20 == 0 || n == total {
                    progress.stage(stage, n, total);
                }
                r
            }
        })
        .buffer_unordered(PARALLEL)
        .collect()
        .await;
    results.into_iter().collect()
}

/// Что получилось после подготовки: всё, что нужно для команды запуска.
pub struct Prepared {
    pub classpath: Vec<PathBuf>,
    pub natives_dir: PathBuf,
    pub assets_root: PathBuf,
    pub assets_index: String,
    /// Для очень старых версий: папка, куда разложены ассеты «по именам»
    pub game_assets: PathBuf,
    pub logging_arg: Option<String>,
}

pub async fn prepare(data: &Path, game_dir: &Path, v: &VersionJson, progress: &Progress) -> Result<Prepared, String> {
    let features = Features::new();
    let libraries_dir = data.join("libraries");
    let natives_dir = data.join("natives").join(&v.id);

    // 1. Игра и библиотеки
    let mut jobs = Vec::new();
    let mut classpath = Vec::new();
    let mut natives_jars = Vec::new();

    for lib in &v.libraries {
        if !rules_allow(&lib.rules, &features) {
            continue;
        }
        // Обычная библиотека
        let artifact = lib.downloads.as_ref().and_then(|d| d.artifact.clone());
        match artifact {
            Some(a) => {
                let rel = a.path.clone().or_else(|| maven_path(&lib.name)).ok_or("странное имя библиотеки")?;
                let path = libraries_dir.join(&rel);
                if !a.url.is_empty() {
                    jobs.push(Job { url: a.url.clone(), path: path.clone(), sha1: a.sha1.clone(), size: a.size });
                }
                classpath.push(path);
            }
            None if lib.natives.is_none() => {
                // Библиотека в стиле maven (у загрузчиков модов)
                if let Some(rel) = maven_path(&lib.name) {
                    let base = lib.url.clone().unwrap_or_else(|| LIBRARIES_URL.to_string());
                    let path = libraries_dir.join(&rel);
                    jobs.push(Job { url: format!("{}/{}", base.trim_end_matches('/'), rel), path: path.clone(), sha1: None, size: None });
                    classpath.push(path);
                }
            }
            None => {}
        }
        // «Нативная» часть в старом формате (до 1.19)
        if let (Some(natives), Some(classifiers)) = (&lib.natives, lib.downloads.as_ref().and_then(|d| d.classifiers.as_ref())) {
            if let Some(key) = natives.get(os_name()) {
                let key = key.replace("${arch}", if cfg!(target_pointer_width = "64") { "64" } else { "32" });
                if let Some(a) = classifiers.get(&key) {
                    let rel = a.path.clone().unwrap_or_else(|| format!("{}-{key}.jar", lib.name.replace(':', "-")));
                    let path = libraries_dir.join(rel);
                    jobs.push(Job { url: a.url.clone(), path: path.clone(), sha1: a.sha1.clone(), size: a.size });
                    natives_jars.push(path);
                }
            }
        }
    }

    // Убираем повторы (одна и та же библиотека может встретиться дважды)
    let mut seen = std::collections::HashSet::new();
    classpath.retain(|p| seen.insert(p.clone()));

    let client_jar = data.join("versions").join(&v.id).join(format!("{}.jar", v.id));
    if let Some(c) = v.downloads.as_ref().and_then(|d| d.client.clone()) {
        jobs.push(Job { url: c.url, path: client_jar.clone(), sha1: c.sha1, size: c.size });
    }
    classpath.push(client_jar);

    // Настройки логов (заодно защищают старые версии от уязвимости Log4Shell)
    let mut logging_arg = None;
    if let Some(lc) = v.logging.as_ref().and_then(|l| l.client.clone()) {
        let path = data.join("assets").join("log_configs").join(&lc.file.id);
        jobs.push(Job { url: lc.file.url.clone(), path: path.clone(), sha1: lc.file.sha1.clone(), size: lc.file.size });
        logging_arg = Some(lc.argument.replace("${path}", &path.to_string_lossy()));
    }

    run_jobs(jobs, progress, "libraries").await?;

    // Распаковываем старые нативные библиотеки
    if !natives_jars.is_empty() {
        std::fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;
        for jar in &natives_jars {
            extract_natives(jar, &natives_dir)?;
        }
    }

    // 2. Ассеты: звуки, текстуры, переводы
    let assets_root = data.join("assets");
    let (assets_index, game_assets) = match &v.asset_index {
        Some(idx) => prepare_assets(&assets_root, game_dir, idx, progress).await?,
        None => ("legacy".to_string(), assets_root.clone()),
    };

    Ok(Prepared { classpath, natives_dir, assets_root, assets_index, game_assets, logging_arg })
}

fn extract_natives(jar: &Path, to: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar).map_err(|e| format!("{}: {e}", jar.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{}: {e}", jar.display()))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || entry.name().starts_with("META-INF") {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = to.join(rel);
        if out.exists() {
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
    #[serde(default, rename = "virtual")]
    is_virtual: bool,
    #[serde(default)]
    map_to_resources: bool,
}

#[derive(Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

async fn prepare_assets(root: &Path, game_dir: &Path, idx: &AssetIndexRef, progress: &Progress) -> Result<(String, PathBuf), String> {
    let index_file = root.join("indexes").join(format!("{}.json", idx.id));
    if !net::is_present(&index_file, idx.sha1.as_deref(), idx.size) {
        net::download(&idx.url, &index_file, idx.sha1.as_deref()).await?;
    }
    let text = std::fs::read_to_string(&index_file).map_err(|e| e.to_string())?;
    let index: AssetIndex = serde_json::from_str(&text).map_err(|e| format!("список ассетов: {e}"))?;

    let jobs = index
        .objects
        .values()
        .map(|o| {
            let sub = &o.hash[..2];
            Job {
                url: format!("{RESOURCES_URL}/{sub}/{}", o.hash),
                path: root.join("objects").join(sub).join(&o.hash),
                sha1: Some(o.hash.clone()),
                size: Some(o.size),
            }
        })
        .collect();
    run_jobs(jobs, progress, "assets").await?;

    // Очень старые версии (до 1.7) ищут ассеты по именам, а не по хэшам
    let mut game_assets = root.to_path_buf();
    if index.is_virtual || index.map_to_resources {
        let target = if index.map_to_resources { game_dir.join("resources") } else { root.join("virtual").join(&idx.id) };
        for (name, o) in &index.objects {
            let dst = target.join(name);
            if dst.exists() {
                continue;
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let src = root.join("objects").join(&o.hash[..2]).join(&o.hash);
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        }
        game_assets = target;
    }
    Ok((idx.id.clone(), game_assets))
}

// ---------- Аргументы запуска ----------

/// Превращает список аргументов из описания версии в строки, учитывая правила.
pub fn collect_args(list: &[serde_json::Value], features: &Features) -> Vec<String> {
    let mut out = Vec::new();
    for item in list {
        match item {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Object(obj) => {
                let rules: Option<Vec<Rule>> = obj.get("rules").and_then(|r| serde_json::from_value(r.clone()).ok());
                if !rules_allow(&rules, features) {
                    continue;
                }
                match obj.get("value") {
                    Some(serde_json::Value::String(s)) => out.push(s.clone()),
                    Some(serde_json::Value::Array(arr)) => {
                        out.extend(arr.iter().filter_map(|v| v.as_str().map(String::from)));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    out
}

/// Есть ли у версии аргумент с определённой «особенностью» (например, быстрый вход на сервер).
pub fn has_feature(v: &VersionJson, feature: &str) -> bool {
    let Some(args) = &v.arguments else { return false };
    args.game.iter().any(|item| {
        item.get("rules")
            .and_then(|r| r.as_array())
            .map(|rules| rules.iter().any(|r| r.get("features").and_then(|f| f.get(feature)).is_some()))
            .unwrap_or(false)
    })
}

pub fn substitute(arg: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = arg.to_string();
    // Быстрый путь: в большинстве аргументов нет переменных
    if !out.contains("${") {
        return out;
    }
    for (key, value) in vars {
        out = out.replace(&format!("${{{key}}}"), value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven() {
        assert_eq!(maven_path("org.ow2.asm:asm:9.6").unwrap(), "org/ow2/asm/asm/9.6/asm-9.6.jar");
        assert_eq!(
            maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"
        );
    }

    #[test]
    fn rules() {
        let f = Features::new();
        assert!(rules_allow(&None, &f));
        let only_osx: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"osx"}}]"#).unwrap();
        assert_eq!(rules_allow(&Some(only_osx), &f), os_name() == "osx");
        let not_osx: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]"#).unwrap();
        assert_eq!(rules_allow(&Some(not_osx), &f), os_name() != "osx");
    }

    #[test]
    fn args_with_rules() {
        let mut f = Features::new();
        f.insert("has_custom_resolution", true);
        let list: Vec<serde_json::Value> = serde_json::from_str(
            r#"["--a", {"rules":[{"action":"allow","features":{"has_custom_resolution":true}}],"value":["--width","${w}"]},
                {"rules":[{"action":"allow","features":{"is_demo_user":true}}],"value":"--demo"}]"#,
        )
        .unwrap();
        assert_eq!(collect_args(&list, &f), vec!["--a", "--width", "${w}"]);
    }
}
