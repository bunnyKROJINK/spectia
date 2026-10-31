//! Новости Minecraft — те же, что показывает официальный лаунчер:
//! статьи с minecraft.net и описания обновлений Java Edition.
//! Mojang может поменять формат в любой момент, поэтому читаем очень осторожно.

use serde::Serialize;
use serde_json::Value;

use crate::net;

const BASE: &str = "https://launchercontent.mojang.com";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    /// news | release | snapshot
    pub kind: String,
    pub title: String,
    pub text: String,
    /// ГГГГ-ММ-ДД
    pub date: String,
    pub image: String,
    pub url: String,
    /// Для описаний обновлений: путь к полному тексту
    pub content_path: String,
    pub version: String,
}

fn abs(url: &str) -> String {
    if url.is_empty() || url.starts_with("http") {
        url.to_string()
    } else if url.starts_with('/') {
        format!("{BASE}{url}")
    } else {
        format!("{BASE}/{url}")
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().trim().to_string()
}

async fn get(path: &str) -> Option<Value> {
    for p in [format!("{BASE}/v2/{path}"), format!("{BASE}/{path}")] {
        if let Ok(v) = net::fetch_json::<Value>(&p).await {
            return Some(v);
        }
    }
    None
}

fn parse_news(v: &Value) -> Vec<NewsItem> {
    v["entries"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|e| {
            // Только Java Edition и общие новости
            let cat = s(&e["category"]).to_lowercase();
            let types = e["newsType"].as_array().map(|a| a.iter().map(s).collect::<Vec<_>>().join(" ").to_lowercase()).unwrap_or_default();
            cat.contains("java") || types.contains("java") || cat.is_empty()
        })
        .map(|e| NewsItem {
            id: s(&e["id"]),
            kind: "news".into(),
            title: s(&e["title"]),
            text: s(&e["text"]),
            date: s(&e["date"]).chars().take(10).collect(),
            image: abs(&s(&e["newsPageImage"]["url"])).if_empty(abs(&s(&e["playPageImage"]["url"]))),
            url: s(&e["readMoreLink"]),
            content_path: String::new(),
            version: String::new(),
        })
        .collect()
}

fn parse_patches(v: &Value) -> Vec<NewsItem> {
    v["entries"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|e| {
            let version = s(&e["version"]);
            NewsItem {
                id: s(&e["id"]),
                kind: if s(&e["type"]) == "snapshot" { "snapshot".into() } else { "release".into() },
                title: s(&e["title"]),
                text: s(&e["shortText"]),
                date: s(&e["date"]).chars().take(10).collect(),
                image: abs(&s(&e["image"]["url"])),
                url: String::new(),
                content_path: s(&e["contentPath"]),
                version,
            }
        })
        .collect()
}

trait IfEmpty {
    fn if_empty(self, other: String) -> String;
}
impl IfEmpty for String {
    fn if_empty(self, other: String) -> String {
        if self.is_empty() { other } else { self }
    }
}

/// Новости и обновления, самые свежие — первыми
#[tauri::command]
pub async fn minecraft_news() -> Result<Vec<NewsItem>, String> {
    let (news, patches) = futures_util::future::join(get("news.json"), get("javaPatchNotes.json")).await;
    if news.is_none() && patches.is_none() {
        return Err("NETWORK".into());
    }
    let mut list: Vec<NewsItem> = news.map(|v| parse_news(&v)).unwrap_or_default();
    list.extend(patches.map(|v| parse_patches(&v)).unwrap_or_default().into_iter().take(30));
    list.retain(|i| !i.title.is_empty());
    list.sort_by(|a, b| b.date.cmp(&a.date));
    list.truncate(60);
    Ok(list)
}

/// Полный текст описания обновления (HTML с сайта Mojang)
#[tauri::command]
pub async fn patch_note_body(content_path: String) -> Result<String, String> {
    if content_path.contains("..") || content_path.starts_with('/') || content_path.contains("://") {
        return Err("странный путь".into());
    }
    let v = get(&content_path).await.ok_or("NETWORK")?;
    Ok(s(&v["body"]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tolerant() {
        let v: Value = serde_json::json!({ "entries": [
            { "id": "1", "title": "Snowy update", "text": "Brr", "date": "2026-10-01", "category": "Minecraft: Java Edition",
              "newsPageImage": { "url": "/v2/images/a.jpg" }, "readMoreLink": "https://www.minecraft.net/a" },
            { "id": "2", "title": "Bedrock thing", "category": "Minecraft for Windows" }
        ]});
        let n = parse_news(&v);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].image, "https://launchercontent.mojang.com/v2/images/a.jpg");
        let p = parse_patches(&serde_json::json!({ "entries": [{ "title": "Java 26.3", "type": "release", "version": "26.3", "image": { "url": "x.png" } }] }));
        assert_eq!(p[0].image, "https://launchercontent.mojang.com/x.png");
        assert_eq!(p[0].kind, "release");
    }
}
