//! Скачивание файлов: с проверкой контрольной суммы, повторными попытками
//! и пропуском того, что уже скачано.

use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

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
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(700 * attempt as u64)).await;
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

pub async fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let res = client().get(url).send().await.map_err(|e| format!("нет связи ({url}): {e}"))?;
    let res = res.error_for_status().map_err(|e| format!("сервер ответил ошибкой ({url}): {e}"))?;
    res.bytes().await.map(|b| b.to_vec()).map_err(|e| format!("обрыв загрузки ({url}): {e}"))
}

pub async fn fetch_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let bytes = fetch(url).await?;
    serde_json::from_slice(&bytes).map_err(|e| format!("непонятный ответ от {url}: {e}"))
}
