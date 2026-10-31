//! Запуск игры: собираем всё вместе и стартуем Java.
//!
//! Порядок: аккаунт → описание версии → Java → библиотеки и ассеты →
//! команда запуска → процесс игры. Интерфейс получает события:
//!   launch-progress  { instanceId, stage, done, total }  — что сейчас скачивается
//!   game-state       { instanceId, running, exitCode, log }  — игра запустилась / закрылась

use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{accounts, game, instances, java, net, paths, settings};

const AUTHLIB_INJECTOR_URL: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";

/// Сообщает интерфейсу, что сейчас происходит.
pub struct Progress {
    app: AppHandle,
    instance: String,
}

impl Progress {
    pub fn stage(&self, stage: &str, done: usize, total: usize) {
        let _ = self.app.emit("launch-progress", json!({ "instanceId": self.instance, "stage": stage, "done": done, "total": total }));
    }
}

/// Запущенные сейчас игры.
#[derive(Default)]
pub struct Running(Mutex<HashMap<String, Arc<Mutex<Child>>>>);

#[tauri::command]
pub fn running_instances(running: State<'_, Running>) -> Vec<String> {
    running.0.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

#[tauri::command]
pub fn stop_instance(running: State<'_, Running>, id: String) -> Result<(), String> {
    let child = running.0.lock().map_err(|e| e.to_string())?.get(&id).cloned();
    if let Some(child) = child {
        child.lock().map_err(|e| e.to_string())?.kill().map_err(|e| format!("не смогли остановить игру: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn launch_instance(app: AppHandle, running: State<'_, Running>, id: String) -> Result<(), String> {
    if running.0.lock().map_err(|e| e.to_string())?.contains_key(&id) {
        return Err("ALREADY_RUNNING".into());
    }
    let progress = Progress { app: app.clone(), instance: id.clone() };
    progress.stage("account", 0, 1);

    let inst = instances::read(&app, &id)?;
    if inst.loader != "vanilla" {
        return Err("LOADER_NOT_YET".into());
    }
    let settings = settings::load(&app);
    let account = accounts::active_for_launch(&app).await?;

    let data = paths::data_dir(&app)?;
    let inst_dir = instances::dir(&app, &id)?;
    let game_dir = inst_dir.join("minecraft");
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;

    progress.stage("version", 0, 1);
    let version = game::load_version(&data, &inst.game_version).await?;

    // Java: своя из настроек сборки → скачанная лаунчером → системная
    let java_path = if !inst.java_path.trim().is_empty() {
        PathBuf::from(inst.java_path.trim())
    } else if settings.auto_java {
        let component = version.java_version.as_ref().map(|j| j.component.clone()).unwrap_or_else(|| "jre-legacy".into());
        java::ensure(&data, &component, &progress).await?
    } else {
        PathBuf::from(if cfg!(windows) { "javaw" } else { "java" })
    };

    let prepared = game::prepare(&data, &game_dir, &version, &progress).await?;

    let authlib = if account.kind == "ely" { Some(ensure_authlib_injector(&data).await?) } else { None };

    progress.stage("starting", 0, 1);

    // ----- Переменные, которые подставляются в аргументы -----
    let server = inst.auto_join_server.trim().to_string();
    let quick_play = !server.is_empty() && game::has_feature(&version, "is_quick_play_multiplayer");
    let mut features = game::Features::new();
    features.insert("has_custom_resolution", !inst.fullscreen);
    features.insert("is_quick_play_multiplayer", quick_play);

    let sep = if cfg!(windows) { ";" } else { ":" };
    let classpath = prepared.classpath.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>().join(sep);
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("auth_player_name", account.name.clone());
    vars.insert("auth_uuid", account.id.clone());
    vars.insert("auth_access_token", account.access_token.clone());
    vars.insert("auth_session", format!("token:{}:{}", account.access_token, account.id));
    vars.insert("auth_xuid", "0".into());
    vars.insert("clientid", "0".into());
    vars.insert("user_type", "mojang".into());
    vars.insert("user_properties", "{}".into());
    vars.insert("version_name", version.id.clone());
    vars.insert("version_type", "Spectia".into());
    vars.insert("game_directory", s(&game_dir));
    vars.insert("assets_root", s(&prepared.assets_root));
    vars.insert("game_assets", s(&prepared.game_assets));
    vars.insert("assets_index_name", prepared.assets_index.clone());
    vars.insert("natives_directory", s(&prepared.natives_dir));
    vars.insert("library_directory", s(&data.join("libraries")));
    vars.insert("classpath_separator", sep.into());
    vars.insert("classpath", classpath);
    vars.insert("launcher_name", "Spectia".into());
    vars.insert("launcher_version", env!("CARGO_PKG_VERSION").into());
    vars.insert("resolution_width", inst.window_width.to_string());
    vars.insert("resolution_height", inst.window_height.to_string());
    vars.insert("quickPlayMultiplayer", server.clone());
    vars.insert("quickPlayPath", s(&game_dir.join("quickPlay").join("log.json")));

    // ----- Аргументы Java -----
    let mut args: Vec<String> = Vec::new();
    if let Some(jar) = &authlib {
        args.push(format!("-javaagent:{}=ely.by", jar.to_string_lossy()));
    }
    args.push(format!("-Xmx{}M", u32::from(inst.memory_gb.max(1)) * 1024));
    args.push("-Xms512M".into());
    match &version.arguments {
        Some(a) if !a.jvm.is_empty() => args.extend(game::collect_args(&a.jvm, &features)),
        _ => {
            args.push("-Djava.library.path=${natives_directory}".into());
            args.push("-cp".into());
            args.push("${classpath}".into());
        }
    }
    if let Some(log) = &prepared.logging_arg {
        args.push(log.clone());
    }
    args.extend(split_args(&inst.jvm_args));
    args.push(version.main_class.clone());

    // ----- Аргументы игры -----
    match (&version.arguments, &version.minecraft_arguments) {
        (Some(a), _) if !a.game.is_empty() => args.extend(game::collect_args(&a.game, &features)),
        (_, Some(old)) => {
            args.extend(old.split_whitespace().map(String::from));
            if !inst.fullscreen {
                args.extend(["--width".into(), "${resolution_width}".into(), "--height".into(), "${resolution_height}".into()]);
            }
        }
        _ => {}
    }
    if inst.fullscreen {
        args.push("--fullscreen".into());
    }
    if !server.is_empty() && !quick_play {
        let (host, port) = server.rsplit_once(':').filter(|(_, p)| p.parse::<u16>().is_ok()).unwrap_or((server.as_str(), "25565"));
        args.extend(["--server".into(), host.to_string(), "--port".into(), port.to_string()]);
    }
    let args: Vec<String> = args.iter().map(|a| game::substitute(a, &vars)).collect();

    // ----- Команда перед запуском -----
    let env = parse_env(&inst.env_vars);
    let inst_env = [
        ("INST_NAME", inst.name.clone()),
        ("INST_ID", id.clone()),
        ("INST_DIR", s(&inst_dir)),
        ("INST_MC_DIR", s(&game_dir)),
        ("INST_JAVA", s(&java_path)),
    ];
    if !inst.pre_launch_command.trim().is_empty() {
        let ok = shell(&inst.pre_launch_command, &game_dir, &inst_env, &env).status().map(|st| st.success()).unwrap_or(false);
        if !ok {
            return Err("PRE_LAUNCH_FAILED".into());
        }
    }

    // ----- Запуск -----
    let mut cmd = match split_args(&inst.wrapper_command).split_first() {
        Some((program, rest)) => {
            let mut c = Command::new(program);
            c.args(rest).arg(&java_path);
            c
        }
        None => Command::new(&java_path),
    };
    let log_path = inst_dir.join("launcher.log");
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    cmd.args(&args)
        .current_dir(&game_dir)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log));
    hide_console(&mut cmd);

    let child = cmd.spawn().map_err(|e| format!("JAVA_START_FAILED: {e} ({})", java_path.display()))?;
    let child = Arc::new(Mutex::new(child));
    running.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), child.clone());
    let _ = app.emit("game-state", json!({ "instanceId": id, "running": true }));

    if settings.hide_on_launch {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.minimize();
        }
    }

    // Следим за игрой в отдельном потоке, чтобы лаунчер не «замирал».
    let post = inst.post_exit_command.clone();
    let hide = settings.hide_on_launch;
    std::thread::spawn(move || {
        let started = Instant::now();
        let code = loop {
            std::thread::sleep(Duration::from_millis(500));
            let status = child.lock().ok().and_then(|mut c| c.try_wait().ok().flatten());
            if let Some(st) = status {
                break st.code();
            }
        };
        if let Ok(mut map) = app.state::<Running>().0.lock() {
            map.remove(&id);
        }
        if !post.trim().is_empty() {
            let _ = shell(&post, &game_dir, &inst_env, &env).status();
        }
        // Если игра упала с ошибкой — покажем последние строки лога, чтобы было понятно, что случилось.
        let crashed = code.unwrap_or(0) != 0;
        let tail = if crashed { log_tail(&log_path, 40) } else { String::new() };
        let _ = app.emit(
            "game-state",
            json!({ "instanceId": id, "running": false, "exitCode": code, "log": tail, "seconds": started.elapsed().as_secs() }),
        );
        if hide {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    });

    Ok(())
}

/// authlib-injector — маленькая программа, которая направляет игру на серверы Ely.by
/// (для входа и скинов). Рекомендована самим Ely.by.
async fn ensure_authlib_injector(data: &Path) -> Result<PathBuf, String> {
    let path = data.join("authlib-injector.jar");
    if path.exists() {
        return Ok(path);
    }
    #[derive(serde::Deserialize)]
    struct Latest {
        download_url: String,
    }
    let latest: Latest = net::fetch_json(AUTHLIB_INJECTOR_URL).await?;
    net::download(&latest.download_url, &path, None).await?;
    Ok(path)
}

/// Разбивает строку на аргументы, учитывая кавычки: `-Da="x y" -Db` → [-Da=x y, -Db]
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for ch in s.chars() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(ch);
                has = true;
            }
            (None, c) if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// "A=1; B=2" или по строке на переменную
fn parse_env(s: &str) -> Vec<(String, String)> {
    s.split(['\n', ';'])
        .filter_map(|part| part.trim().split_once('='))
        .filter(|(k, _)| !k.trim().is_empty())
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

fn shell(command: &str, dir: &Path, inst_env: &[(&str, String)], env: &[(String, String)]) -> Command {
    let mut c = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    c.current_dir(dir);
    for (k, v) in inst_env {
        c.env(k, v);
    }
    for (k, v) in env {
        c.env(k, v);
    }
    hide_console(&mut c);
    c
}

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

fn log_tail(path: &Path, lines: usize) -> String {
    let text = std::fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

#[tauri::command]
pub fn read_launch_log(app: AppHandle, id: String) -> Result<String, String> {
    let path = instances::dir(&app, &id)?.join("launcher.log");
    Ok(log_tail(&path, 400))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split() {
        assert_eq!(split_args(r#"-Xss2M  -Dname="Моя сборка" -Dx='a b'"#), vec!["-Xss2M", "-Dname=Моя сборка", "-Dx=a b"]);
        assert!(split_args("   ").is_empty());
    }

    #[test]
    fn env() {
        assert_eq!(parse_env("A=1; B = two\nbad"), vec![("A".into(), "1".into()), ("B".into(), "two".into())]);
    }
}
