//! Spectia — точка входа приложения.
//!
//! Здесь регистрируются все «команды»: функции на Rust, которые интерфейс
//! (папка `src/`) может вызывать через `invoke("имя_команды")`.

mod accounts;
mod game;
mod instances;
mod java;
mod launch;
mod net;
mod paths;
mod settings;
mod updater;
mod versions;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(launch::Running::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            versions::get_versions,
            instances::list_instances,
            instances::create_instance,
            instances::update_instance,
            instances::delete_instance,
            instances::open_instance_folder,
            accounts::list_accounts,
            accounts::add_ely_account,
            accounts::set_active_account,
            accounts::remove_account,
            launch::launch_instance,
            launch::stop_instance,
            launch::running_instances,
            launch::read_launch_log,
            updater::check_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Spectia");
}
