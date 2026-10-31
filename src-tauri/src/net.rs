//! Скачивание файлов: с проверкой контрольной суммы, повторными попытками
//! и пропуском того, что уже скачано.

use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter};

// ---------- Счётчики для окна загрузок ----------

/// Сколько байт скачано с запуска лаунчера
static BYTES: AtomicU64 = AtomicU64::new(0);
/// Сколько файлов качается прямо сейчас
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
/// Сколько файлов качать одновременно (меняется в настройках: обычно / быстро / турбо)
static PARALLEL: AtomicUsize = AtomicUsize::new(16);

pub fn parallel() -> usize {
    PARALLEL.load(Ordering::Relaxed).clamp(4, 96)
}

/// «normal» | «fast» | «turbo»
pub fn set_speed(mode: &str) {
    PARALLEL.store(match mode { "turbo" => 64, "fast" => 32, _ => 16 }, Ordering::Relaxed);
}

/// Раз в полсекунды отправляем в интерфейс скорость скачивания (только пока что-то качается)
pub fn start_stats(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = BYTES.load(Ordering::Relaxed);
        let mut idle = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let now = BYTES.load(Ordering::Relaxed);
            let active = ACTIVE.load(Ordering::Relaxed);
            let delta = now.saturating_sub(last);
            last = now;
            if active == 0 && delta == 0 {
                idle += 1;
                // Пара «пустых» сообщений, чтобы график успел опуститься до нуля
                if idle > 2 {
                    continue;
                }
            } else {
                idle = 0;
            }
            let _ = app.emit("net-stats", json!({ "bytes": now, "speed": delta * 2, "active": active }));
        }
    });
}

struct ActiveGuard;
impl ActiveGuard {
    fn new() -> Self {
        ACTIVE.fetch_add(1, Ordering::Relaxed);
        ActiveGuard
    }
}
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::Relaxed);
    }
}

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Spectia/", env!("CARGO_PKG_VERSION"), " (github.com/bunnyKROJINK/spectia)"))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300))
            .build()
            .expect("не удалось создать HTTP-клиент")
    })
}

pub fn sha1_hex(bytes: &[u8]) -> String {
    sha1_smol::Sha1::from(bytes).digest().to_string()
}

/// Есть ли уже нужный файл на диске. Чтобы не пересчитывать хэши тысяч файлов
/// при каждом запуске, сначала сверяем размер; хэш проверяем, только если размер неизвестен.
pub fn is_present(path: &Path, sha1: Option<&str>, size: Option<u64>) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_file() {
        return false;
    }
    match (size, sha1) {
        (Some(size), _) => meta.len() == size,
        (None, Some(hash)) => std::fs::read(path).map(|b| sha1_hex(&b) == hash).unwrap_or(false),
        (None, None) => meta.len() > 0,
    }
}

/// Скачивает файл (до 3 попыток) и проверяет sha1, если он известен.
pub async fn download(url: &str, path: &Path, sha1: Option<&str>) -> Result<(), String> {
    let mut last_err = String::new();
    for attempt in 0..4 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
        }
        match fetch(url).await {
            Ok(bytes) => {
                if let Some(expected) = sha1 {
                    let got = sha1_hex(&bytes);
                    if !got.eq_ignore_ascii_case(expected) {
                        last_err = format!("файл повреждён при скачивании ({url})");
                        continue;
                    }
                }
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
                }
                // Пишем во временный файл и переименовываем: так не останется «полфайла», если что-то оборвётся.
                let tmp = path.with_extension("part");
                std::fs::write(&tmp, &bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
                std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))?;
                return Ok(());
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// Если сервер молчит дольше этого времени — бросаем попытку и пробуем снова,
/// а не ждём минутами (так «зависшая» загрузка Java больше не стопорит запуск).
const STALL: Duration = Duration::from_secs(20);

pub async fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let _active = ActiveGuard::new();
    let res = tokio::time::timeout(STALL, client().get(url).send())
        .await
        .map_err(|_| format!("сервер не отвечает ({url})"))?
        .map_err(|e| format!("нет связи ({url}): {e}"))?;
    let mut res = res.error_for_status().map_err(|e| format!("сервер ответил ошибкой ({url}): {e}"))?;
    let mut out = Vec::with_capacity(res.content_length().unwrap_or(0).min(64 << 20) as usize);
    loop {
        match tokio::time::timeout(STALL, res.chunk()).await {
            Err(_) => return Err(format!("загрузка зависла ({url})")),
            Ok(Err(e)) => return Err(format!("обрыв загрузки ({url}): {e}")),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => {
                BYTES.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                out.extend_from_slice(&chunk);
            }
        }
    }
    Ok(out)
}

pub async fn fetch_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let bytes = fetch(url).await?;
    serde_json::from_slice(&bytes).map_err(|e| format!("непонятный ответ от {url}: {e}"))
}
