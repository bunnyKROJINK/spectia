//! Spectia — точка входа приложения.
//!
//! Здесь регистрируются все «команды»: функции на Rust, которые интерфейс
//! (папка `src/`) может вызывать через `invoke("имя_команды")`.

mod accounts;
mod content;
mod game;
mod instances;
mod java;
mod launch;
mod loaders;
mod modrinth;
mod mods;
mod mrpack;
mod net;
mod paths;
mod settings;
mod updater;
mod versions;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
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
            instances::duplicate_instance,
            loaders::get_loader_versions,
            mods::list_mods,
            mods::toggle_mod,
            mods::delete_mod,
            mods::add_mods,
            modrinth::install_project,
            modrinth::installed_projects,
            modrinth::check_mod_updates,
            modrinth::apply_mod_updates,
            mrpack::export_mrpack,
            mrpack::import_mrpack,
            mrpack::install_modpack,
            content::data_dir,
            content::list_worlds,
            content::copy_world,
            content::delete_world,
            content::open_world_folder,
            content::list_screenshots,
            content::open_screenshot,
            content::delete_screenshot,
            content::pick_cover,
            content::cover_from_screenshot,
            content::clear_cover,
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
