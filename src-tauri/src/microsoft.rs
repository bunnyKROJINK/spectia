//! Вход через Microsoft (лицензия Minecraft).
//!
//! Как это устроено:
//!  1. Открываем в браузере страницу входа Microsoft. Пароль вводится только там —
//!     лаунчер его никогда не видит.
//!  2. Microsoft возвращает браузер на http://localhost:<порт> с одноразовым кодом,
//!     а лаунчер на этом порту его ловит.
//!  3. Код → токен Microsoft → токен Xbox Live → XSTS → токен Minecraft → профиль.
//!
//! Нужен «Client ID» приложения в Microsoft Azure, одобренного Mojang.
//! Его подставляет GitHub при сборке (переменная SPECTIA_MS_CLIENT_ID).

use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use sha2::Digest;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::net;

pub const CLIENT_ID: &str = match option_env!("SPECTIA_MS_CLIENT_ID") {
    Some(id) => id,
    None => "",
};

const AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";

/// Готов ли вход через Microsoft (есть ли Client ID)
pub fn configured() -> bool {
    !CLIENT_ID.trim().is_empty()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v))).collect::<Vec<_>>().join("&")
}

fn random_string() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Результат входа: всё, что нужно сохранить в аккаунте
pub struct MsLogin {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Deserialize)]
struct MsToken {
    access_token: String,
    refresh_token: Option<String>,
}

/// Полный вход через браузер
pub async fn login(app: &AppHandle) -> Result<MsLogin, String> {
    if !configured() {
        return Err("MS_NOT_CONFIGURED".into());
    }
    let verifier = random_string();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()));
    let state = random_string();

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("не получилось открыть порт для входа: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://localhost:{port}");

    let url = format!(
        "{AUTHORIZE}?client_id={}&response_type=code&response_mode=query&prompt=select_account&scope={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256&state={}",
        urlencode(CLIENT_ID),
        urlencode(SCOPE),
        urlencode(&redirect),
        challenge,
        state
    );
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("не получилось открыть браузер: {e}"))?;

    // Ждём, пока браузер вернётся с кодом (до 5 минут)
    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected_state))
        .await
        .map_err(|e| e.to_string())??;

    let body = form(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect),
        ("code_verifier", &verifier),
        ("scope", SCOPE),
    ]);
    let token = ms_token(&body).await?;
    finish(&token.access_token, token.refresh_token.unwrap_or_default()).await
}

/// Обновляет вход без браузера (по сохранённому refresh-токену)
pub async fn refresh(refresh_token: &str) -> Result<MsLogin, String> {
    if !configured() {
        return Err("MS_NOT_CONFIGURED".into());
    }
    let body = form(&[
        ("client_id", CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", SCOPE),
    ]);
    let token = ms_token(&body).await.map_err(|_| "MS_RELOGIN".to_string())?;
    finish(&token.access_token, token.refresh_token.unwrap_or_else(|| refresh_token.to_string())).await
}

async fn ms_token(body: &str) -> Result<MsToken, String> {
    let res = net::client()
        .post(TOKEN)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Microsoft: {text}"));
    }
    res.json().await.map_err(|e| format!("Microsoft: {e}"))
}

fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > deadline {
            return Err("MS_TIMEOUT".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).into_owned();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
                let param = |key: &str| {
                    query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == key).map(|(_, v)| url_decode(v)))
                };
                // Браузер иногда сам просит /favicon.ico — просто отвечаем и ждём дальше
                if param("code").is_none() && param("error").is_none() {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let ok = param("code").is_some() && param("state").as_deref() == Some(state);
                let page = done_page(ok);
                let _ = stream.write_all(
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len())
                        .as_bytes(),
                );
                if let Some(err) = param("error") {
                    return Err(if err == "access_denied" { "MS_CANCELLED".into() } else { format!("Microsoft: {err}") });
                }
                if !ok {
                    return Err("MS_BAD_STATE".into());
                }
                return Ok(param("code").unwrap_or_default());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn url_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn done_page(ok: bool) -> String {
    let (title, text) = if ok {
        ("Готово!", "Вход выполнен. Можно закрыть эту вкладку и вернуться в Spectia.")
    } else {
        ("Не получилось", "Вход не завершился. Вернитесь в Spectia и попробуйте ещё раз.")
    };
    format!(
        "<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><title>Spectia</title>\
<body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#170B15;color:#ECEEFA;font-family:'Segoe UI',system-ui,sans-serif\">\
<div style=\"text-align:center\"><div style=\"font-size:56px;color:#FF8CC6\">☾</div><h1 style=\"margin:8px 0\">{title}</h1><p style=\"color:#C9A9BC\">{text}</p></div></body></html>"
    )
}

// ---------- Xbox Live → Minecraft ----------

#[derive(Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: serde_json::Value,
}

#[derive(Deserialize)]
struct McLogin {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct McProfile {
    id: String,
    name: String,
}

async fn finish(ms_access: &str, refresh_token: String) -> Result<MsLogin, String> {
    // Xbox Live
    let xbl: XblResponse = post(
        "https://user.auth.xboxlive.com/user/authenticate",
        json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access}") },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }),
    )
    .await?;
    let uhs = xbl.display_claims["xui"][0]["uhs"].as_str().unwrap_or_default().to_string();

    // XSTS (здесь же Xbox сообщает о детских аккаунтах и т.п.)
    let res = net::client()
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if res.status().as_u16() == 401 {
        let err: serde_json::Value = res.json().await.unwrap_or_default();
        return Err(match err["XErr"].as_u64() {
            Some(2148916233) => "MS_NO_XBOX".into(),
            Some(2148916235) => "MS_XBOX_REGION".into(),
            Some(2148916236) | Some(2148916237) => "MS_ADULT_VERIFY".into(),
            Some(2148916238) => "MS_CHILD".into(),
            other => format!("Xbox: {other:?}"),
        });
    }
    let xsts: XblResponse = res.error_for_status().map_err(|e| format!("Xbox: {e}"))?.json().await.map_err(|e| e.to_string())?;

    // Minecraft
    let res = net::client()
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={uhs};{}", xsts.token) }))
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(if text.contains("Invalid app registration") { "MS_NOT_APPROVED".into() } else { format!("Minecraft: {text}") });
    }
    let mc: McLogin = res.json().await.map_err(|e| e.to_string())?;

    // Профиль (если его нет — игра на этом аккаунте не куплена)
    let res = net::client()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc.access_token)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if res.status().as_u16() == 404 {
        return Err("MS_NO_GAME".into());
    }
    let profile: McProfile = res.error_for_status().map_err(|e| format!("Minecraft: {e}"))?.json().await.map_err(|e| e.to_string())?;

    Ok(MsLogin { id: profile.id, name: profile.name, access_token: mc.access_token, refresh_token, expires_at: now() + mc.expires_in })
}

async fn post<T: serde::de::DeserializeOwned>(url: &str, body: serde_json::Value) -> Result<T, String> {
    let res = net::client()
        .post(url)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    let res = res.error_for_status().map_err(|e| format!("Xbox: {e}"))?;
    res.json().await.map_err(|e| format!("Xbox: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode() {
        assert_eq!(url_decode("M.C507_abc%2Bdef"), "M.C507_abc+def");
        assert_eq!(url_decode("a+b%20c"), "a b c");
    }

    #[test]
    fn encode_form() {
        assert_eq!(form(&[("scope", "XboxLive.signin offline_access")]), "scope=XboxLive.signin%20offline_access");
    }
}
