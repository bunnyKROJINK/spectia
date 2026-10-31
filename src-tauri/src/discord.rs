//! Статус в Discord: «Играет в Spectia · Minecraft 1.20.1».
//!
//! Discord слушает локальный канал (на Windows — именованный канал \\.\pipe\discord-ipc-0).
//! Мы пишем туда маленькие JSON-сообщения. Если Discord не запущен — ничего страшного,
//! просто молча ничего не показываем.

use serde_json::json;
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

/// Application ID приложения «Spectia» на discord.com/developers (не секрет).
/// Можно задать при сборке переменной SPECTIA_DISCORD_ID.
pub const APP_ID: &str = match option_env!("SPECTIA_DISCORD_ID") {
    Some(id) => id,
    None => "",
};

pub enum Msg {
    Playing { details: String, state: String, start: u64 },
    Clear,
}

fn sender() -> &'static Mutex<Option<Sender<Msg>>> {
    static S: OnceLock<Mutex<Option<Sender<Msg>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// Отправить новый статус (работает в отдельном потоке, лаунчер не ждёт)
pub fn send(msg: Msg) {
    if APP_ID.is_empty() {
        return;
    }
    let mut guard = match sender().lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.is_none() {
        let (tx, rx) = channel::<Msg>();
        std::thread::spawn(move || {
            let mut conn: Option<Conn> = None;
            for msg in rx {
                let activity = match msg {
                    Msg::Playing { details, state, start } => json!({
                        "details": details,
                        "state": state,
                        "timestamps": { "start": start },
                        "assets": { "large_image": "spectia", "large_text": concat!("Spectia ", env!("CARGO_PKG_VERSION")) },
                    }),
                    Msg::Clear => serde_json::Value::Null,
                };
                // Пара попыток: Discord мог перезапуститься
                for _ in 0..2 {
                    if conn.is_none() {
                        conn = Conn::open();
                    }
                    let Some(c) = conn.as_mut() else { break };
                    if c.set_activity(&activity).is_ok() {
                        break;
                    }
                    conn = None;
                }
            }
        });
        *guard = Some(tx);
    }
    if let Some(tx) = guard.as_ref() {
        let _ = tx.send(msg);
    }
}

#[cfg(windows)]
type Pipe = std::fs::File;
#[cfg(unix)]
type Pipe = std::os::unix::net::UnixStream;

struct Conn {
    pipe: Pipe,
    nonce: u64,
}

impl Conn {
    #[cfg(windows)]
    fn connect(n: u8) -> Option<Pipe> {
        std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{n}")).ok()
    }

    #[cfg(unix)]
    fn connect(n: u8) -> Option<Pipe> {
        let base = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].iter().find_map(|k| std::env::var(k).ok()).unwrap_or_else(|| "/tmp".into());
        std::os::unix::net::UnixStream::connect(format!("{base}/discord-ipc-{n}")).ok()
    }

    fn open() -> Option<Conn> {
        let pipe = (0..10).find_map(Conn::connect)?;
        let mut c = Conn { pipe, nonce: 0 };
        c.write(0, &json!({ "v": 1, "client_id": APP_ID })).ok()?;
        c.read().ok()?; // READY
        Some(c)
    }

    fn write(&mut self, op: u32, body: &serde_json::Value) -> std::io::Result<()> {
        let data = body.to_string().into_bytes();
        let mut frame = Vec::with_capacity(8 + data.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(data.len() as u32).to_le_bytes());
        frame.extend_from_slice(&data);
        self.pipe.write_all(&frame)?;
        self.pipe.flush()
    }

    fn read(&mut self) -> std::io::Result<serde_json::Value> {
        let mut head = [0u8; 8];
        self.pipe.read_exact(&mut head)?;
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        let mut body = vec![0u8; len.min(1 << 20)];
        self.pipe.read_exact(&mut body)?;
        Ok(serde_json::from_slice(&body).unwrap_or_default())
    }

    fn set_activity(&mut self, activity: &serde_json::Value) -> std::io::Result<()> {
        self.nonce += 1;
        let mut args = json!({ "pid": std::process::id() });
        if !activity.is_null() {
            args["activity"] = activity.clone();
        }
        self.write(1, &json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": self.nonce.to_string() }))?;
        self.read().map(|_| ())
    }
}
