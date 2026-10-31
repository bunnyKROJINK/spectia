//! Мини-режим: окно становится маленькой карточкой с кнопкой «Играть».

use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, State};

/// Размер окна до мини-режима, чтобы вернуть его обратно
#[derive(Default)]
pub struct Saved(pub Mutex<Option<(f64, f64)>>);

#[tauri::command]
pub fn set_mini(app: AppHandle, saved: State<'_, Saved>, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("нет окна")?;
    let scale = w.scale_factor().unwrap_or(1.0);
    if on {
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        }
        let size = w.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
        *saved.0.lock().map_err(|e| e.to_string())? = Some((size.width, size.height));
        w.set_min_size(Some(LogicalSize::new(340.0, 200.0))).map_err(|e| e.to_string())?;
        w.set_size(LogicalSize::new(380.0, 236.0)).map_err(|e| e.to_string())?;
        let _ = w.set_always_on_top(false);
    } else {
        let (width, height) = saved.0.lock().map_err(|e| e.to_string())?.take().unwrap_or((1200.0, 780.0));
        w.set_min_size(Some(LogicalSize::new(900.0, 600.0))).map_err(|e| e.to_string())?;
        w.set_size(LogicalSize::new(width.max(900.0), height.max(600.0))).map_err(|e| e.to_string())?;
    }
    Ok(())
}
