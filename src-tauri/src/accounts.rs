//! Аккаунты. Пока поддерживается Ely.by; вход через Microsoft появится позже.
//!
//! Пароль нигде не сохраняется: Ely.by выдаёт «токен доступа», и дальше
//! лаунчер пользуется только им. Документация: https://docs.ely.by

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{net, paths};

const ELY_AUTH: &str = "https://authserver.ely.by/auth";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// UUID игрового профиля (без дефисов)
    pub id: String,
    pub name: String,
    /// "ely" (позже: "microsoft")
    pub kind: String,
    #[serde(default)]
    pub access_token: String,
}

/// То, что видит интерфейс: без токена.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub active: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Store {
    client_token: String,
    active: String,
    accounts: Vec<Account>,
}

fn load(app: &AppHandle) -> Result<Store, String> {
    let file = paths::data_dir(app)?.join("accounts.json");
    let mut store: Store = std::fs::read_to_string(&file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if store.client_token.is_empty() {
        store.client_token = uuid::Uuid::new_v4().simple().to_string();
    }
    Ok(store)
}

fn save(app: &AppHandle, store: &Store) -> Result<(), String> {
    let file = paths::data_dir(app)?.join("accounts.json");
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| format!("не смогли сохранить аккаунты: {e}"))
}

fn info(store: &Store) -> Vec<AccountInfo> {
    store
        .accounts
        .iter()
        .map(|a| AccountInfo { id: a.id.clone(), name: a.name.clone(), kind: a.kind.clone(), active: a.id == store.active })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    access_token: String,
    selected_profile: Option<Profile>,
}

#[derive(Deserialize)]
struct Profile {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthError {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_message: String,
}

/// Ошибки, которые интерфейс понимает и переводит на нужный язык.
fn explain(err: AuthError) -> String {
    let msg = err.error_message.to_lowercase();
    if msg.contains("two factor") {
        "ELY_2FA".into()
    } else if msg.contains("invalid credentials") || err.error == "ForbiddenOperationException" {
        "ELY_BAD_CREDENTIALS".into()
    } else if !err.error_message.is_empty() {
        err.error_message
    } else {
        err.error
    }
}

async fn post(path: &str, body: serde_json::Value) -> Result<AuthResponse, String> {
    let res = net::client()
        .post(format!("{ELY_AUTH}/{path}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("NETWORK: {e}"))?;
    if res.status().is_success() {
        res.json::<AuthResponse>().await.map_err(|e| format!("Ely.by: {e}"))
    } else {
        let err = res.json::<AuthError>().await.unwrap_or(AuthError { error: "Ely.by".into(), error_message: String::new() });
        Err(explain(err))
    }
}

#[tauri::command]
pub fn list_accounts(app: AppHandle) -> Result<Vec<AccountInfo>, String> {
    Ok(info(&load(&app)?))
}

/// Вход в Ely.by. Если включена двухфакторная защита, интерфейс получит ошибку
/// ELY_2FA, спросит код и вызовет эту команду ещё раз уже с кодом.
#[tauri::command]
pub async fn add_ely_account(app: AppHandle, username: String, password: String, totp: Option<String>) -> Result<Vec<AccountInfo>, String> {
    let mut store = load(&app)?;
    let password = match totp.as_deref().map(str::trim) {
        Some(code) if !code.is_empty() => format!("{password}:{code}"),
        _ => password,
    };
    let res = post(
        "authenticate",
        serde_json::json!({
            "username": username.trim(),
            "password": password,
            "clientToken": store.client_token,
            "requestUser": true,
        }),
    )
    .await?;
    let profile = res.selected_profile.ok_or("У этого аккаунта Ely.by нет игрового профиля")?;

    store.accounts.retain(|a| a.id != profile.id);
    store.accounts.push(Account { id: profile.id.clone(), name: profile.name, kind: "ely".into(), access_token: res.access_token });
    store.active = profile.id;
    save(&app, &store)?;
    Ok(info(&store))
}

#[tauri::command]
pub fn set_active_account(app: AppHandle, id: String) -> Result<Vec<AccountInfo>, String> {
    let mut store = load(&app)?;
    if store.accounts.iter().any(|a| a.id == id) {
        store.active = id;
        save(&app, &store)?;
    }
    Ok(info(&store))
}

#[tauri::command]
pub async fn remove_account(app: AppHandle, id: String) -> Result<Vec<AccountInfo>, String> {
    let mut store = load(&app)?;
    if let Some(acc) = store.accounts.iter().find(|a| a.id == id) {
        // Вежливо «выходим» на стороне Ely.by. Если не получилось — не страшно.
        let _ = net::client()
            .post(format!("{ELY_AUTH}/invalidate"))
            .json(&serde_json::json!({ "accessToken": acc.access_token, "clientToken": store.client_token }))
            .send()
            .await;
    }
    store.accounts.retain(|a| a.id != id);
    if store.active == id {
        store.active = store.accounts.first().map(|a| a.id.clone()).unwrap_or_default();
    }
    save(&app, &store)?;
    Ok(info(&store))
}

/// Перед запуском игры обновляем токен, чтобы он точно был свежим.
/// Возвращает активный аккаунт или ошибку NO_ACCOUNT / ELY_RELOGIN.
pub async fn active_for_launch(app: &AppHandle) -> Result<Account, String> {
    let mut store = load(app)?;
    let idx = store.accounts.iter().position(|a| a.id == store.active).ok_or("NO_ACCOUNT")?;
    let acc = store.accounts[idx].clone();

    if acc.kind == "ely" {
        let refreshed = post(
            "refresh",
            serde_json::json!({ "accessToken": acc.access_token, "clientToken": store.client_token, "requestUser": true }),
        )
        .await;
        match refreshed {
            Ok(res) => {
                store.accounts[idx].access_token = res.access_token;
                if let Some(p) = res.selected_profile {
                    store.accounts[idx].name = p.name;
                }
                save(app, &store)?;
            }
            // Нет интернета — пробуем играть со старым токеном, вдруг он ещё живой.
            Err(e) if e.starts_with("NETWORK") => {}
            Err(_) => return Err("ELY_RELOGIN".into()),
        }
    }
    Ok(store.accounts[idx].clone())
}
