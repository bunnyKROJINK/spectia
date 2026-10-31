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
mod microsoft;
mod modrinth;
mod mods;
mod mrpack;
mod net;
mod paths;
mod prism;
mod settings;
mod skins;
mod stats;
mod updater;
mod versions;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            content::list_datapacks,
            content::delete_datapack,
            content::list_backups,
            content::make_backup,
            content::delete_backup,
            content::restore_backup,
            content::pick_background,
            content::export_theme,
            content::notify,
            accounts::microsoft_ready,
            accounts::add_microsoft_account,
            skins::account_skin,
            skins::list_skins,
            skins::import_skin,
            skins::save_skin_data,
            skins::update_skin,
            skins::delete_skin,
            skins::apply_skin,
            skins::set_cape,
            prism::find_prism_instances,
            prism::import_prism,
            stats::stats_summary,
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
