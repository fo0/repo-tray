fn main() {
    println!("cargo:rerun-if-env-changed=REPOWATCH_UPDATER_PUBLIC_KEY");
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
