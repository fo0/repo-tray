#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod desktop_updates;
mod tray_popup;

fn main() {
    desktop::run();
}
