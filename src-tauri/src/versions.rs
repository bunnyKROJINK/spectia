//! Список версий Minecraft прямо с серверов Mojang.
//! Новые версии (например, 26.4) появятся в лаунчере сами, без обновления Spectia.

use serde::{Deserialize, Serialize};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Deserialize)]
struct Manifest {
    latest: Latest,
    versions: Vec<RawVersion>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVersion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    release_time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub id: String,
    /// "release", "snapshot", "old_beta" или "old_alpha"
    pub kind: String,
    pub release_time: String,
}

#[derive(Debug, Serialize)]
pub struct VersionList {
    pub latest: Latest,
    pub versions: Vec<GameVersion>,
}

#[tauri::command]
pub async fn get_versions() -> Result<VersionList, String> {
    let manifest: Manifest = reqwest::Client::new()
        .get(MANIFEST_URL)
        .header("User-Agent", concat!("Spectia/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("нет связи с серверами Mojang: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Mojang ответил ошибкой: {e}"))?
        .json()
        .await
        .map_err(|e| format!("не смогли прочитать список версий: {e}"))?;

    Ok(VersionList {
        latest: manifest.latest,
        versions: manifest
            .versions
            .into_iter()
            .map(|v| GameVersion { id: v.id, kind: v.kind, release_time: v.release_time })
            .collect(),
    })
}
