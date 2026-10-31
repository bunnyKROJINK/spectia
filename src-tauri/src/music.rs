//! Музыка Minecraft. Мы ничего не скачиваем специально и не распространяем:
//! игра сама приносит свои треки вместе с остальными файлами (ассетами),
//! а плеер просто находит их у вас на компьютере.

use serde::Serialize;
use std::collections::BTreeMap;
use tauri::AppHandle;

use crate::paths;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Путь внутри игры: minecraft/sounds/music/game/calm1.ogg
    pub key: String,
    pub title: String,
    /// menu | game | creative | nether | end | water | records | other
    pub group: String,
    /// Полный путь к файлу на диске
    pub path: String,
}

/// Названия старых треков: в файлах они пронумерованы, а не подписаны
fn known_title(stem: &str, group: &str) -> Option<&'static str> {
    Some(match (group, stem) {
        ("game", "calm1") => "Minecraft",
        ("game", "calm2") => "Clark",
        ("game", "calm3") => "Sweden",
        ("game", "hal1") => "Subwoofer Lullaby",
        ("game", "hal2") => "Living Mice",
        ("game", "hal3") => "Haggstrom",
        ("game", "hal4") => "Danny",
        ("game", "nuance1") => "Key",
        ("game", "nuance2") => "Oxygène",
        ("game", "piano1") => "Dry Hands",
        ("game", "piano2") => "Wet Hands",
        ("game", "piano3") => "Mice on Venus",
        ("creative", "creative1") => "Biome Fest",
        ("creative", "creative2") => "Blind Spots",
        ("creative", "creative3") => "Haunt Muskie",
        ("creative", "creative4") => "Aria Math",
        ("creative", "creative5") => "Dreiton",
        ("creative", "creative6") => "Taswell",
        ("menu", "menu1") => "Mutation",
        ("menu", "menu2") => "Moog City 2",
        ("menu", "menu3") => "Beginning 2",
        ("menu", "menu4") => "Floating Trees",
        ("nether", "nether1") => "Concrete Halls",
        ("nether", "nether2") => "Dead Voxel",
        ("nether", "nether3") => "Warmth",
        ("nether", "nether4") => "Ballad of the Cats",
        ("end", "end") => "The End",
        ("end", "boss") => "Boss",
        ("end", "credits") => "Alpha",
        ("water", "axolotl") => "Axolotl",
        ("water", "dragon_fish") => "Dragon Fish",
        ("water", "shuniji") => "Shuniji",
        _ => return None,
    })
}

/// «a_familiar_room» → «A Familiar Room»
fn title_case(stem: &str) -> String {
    stem.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Разобрать путь ассета в трек (или None, если это не музыка)
fn classify(key: &str) -> Option<(String, String)> {
    let rest = key.strip_prefix("minecraft/sounds/")?;
    if !rest.ends_with(".ogg") {
        return None;
    }
    let stem = rest.rsplit('/').next()?.trim_end_matches(".ogg");
    if rest.starts_with("records/") {
        // Пластинки: «13», «cat», «pigstep»…
        return Some(("records".into(), title_case(stem)));
    }
    let m = rest.strip_prefix("music/")?;
    let group = m.split('/').next()?;
    let group = match group {
        "menu" | "game" | "creative" | "end" => group.to_string(),
        g if m.starts_with("game/nether/") || g == "nether" => "nether".into(),
        _ => "other".into(),
    };
    // Новые треки лежат в подпапках game/…: game/nether/…, game/water/…, game/swamp/…
    let group = if m.starts_with("game/nether/") {
        "nether".to_string()
    } else if m.starts_with("game/water/") {
        "water".to_string()
    } else {
        group
    };
    let title = known_title(stem, &group).map(String::from).unwrap_or_else(|| title_case(stem));
    Some((group, title))
}

#[tauri::command]
pub fn list_music(app: AppHandle) -> Result<Vec<Track>, String> {
    let assets = paths::data_dir(&app)?.join("assets");
    let Ok(rd) = std::fs::read_dir(assets.join("indexes")) else { return Ok(vec![]) };
    // Один и тот же трек есть во многих версиях — берём каждый по одному разу
    let mut found: BTreeMap<String, Track> = BTreeMap::new();
    for e in rd.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let Some(objects) = json["objects"].as_object() else { continue };
        for (key, obj) in objects {
            if found.contains_key(key) {
                continue;
            }
            let Some((group, title)) = classify(key) else { continue };
            let Some(hash) = obj["hash"].as_str() else { continue };
            if hash.len() < 2 {
                continue;
            }
            let path = assets.join("objects").join(&hash[..2]).join(hash);
            if !path.is_file() {
                continue;
            }
            found.insert(key.clone(), Track { key: key.clone(), title, group, path: path.to_string_lossy().into_owned() });
        }
    }
    let mut list: Vec<Track> = found.into_values().collect();
    list.sort_by(|a, b| a.group.cmp(&b.group).then(a.title.cmp(&b.title)));
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(classify("minecraft/sounds/music/game/calm1.ogg"), Some(("game".into(), "Minecraft".into())));
        assert_eq!(classify("minecraft/sounds/music/menu/menu2.ogg"), Some(("menu".into(), "Moog City 2".into())));
        assert_eq!(classify("minecraft/sounds/music/game/nether/crimson_forest/chrysopoeia.ogg"), Some(("nether".into(), "Chrysopoeia".into())));
        assert_eq!(classify("minecraft/sounds/music/game/a_familiar_room.ogg"), Some(("game".into(), "A Familiar Room".into())));
        assert_eq!(classify("minecraft/sounds/records/pigstep.ogg"), Some(("records".into(), "Pigstep".into())));
        assert_eq!(classify("minecraft/sounds/mob/cow/say1.ogg"), None);
    }
}
