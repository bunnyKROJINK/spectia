// Убирает лишнее чёрное окно консоли в Windows в релизной версии.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    spectia_lib::run()
}
