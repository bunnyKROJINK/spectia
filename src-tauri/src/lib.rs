//! Spectia — точка входа приложения.
//!
//! Здесь регистрируются все «команды»: функции на Rust, которые интерфейс
//! (папка `src/`) может вызывать через `invoke("имя_команды")`.

mod instances;
mod paths;
mod settings;
mod versions;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            versions::get_versions,
            instances::list_instances,
            instances::create_instance,
            instances::update_instance,
            instances::delete_instance,
            instances::open_instance_folder,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Spectia");
}
