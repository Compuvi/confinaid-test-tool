// SPDX-License-Identifier: Apache-2.0

fn main() {
    // CI runs `cargo test --lib` without a built frontend. tauri_build::build()
    // would fail there, so allow it to be skipped. Note this does NOT skip
    // `generate_context!()` in lib.rs, which still needs a dist/ directory to
    // exist — CI stubs one.
    if std::env::var("SKIP_TAURI_BUILD").is_ok() {
        println!("cargo:rerun-if-env-changed=SKIP_TAURI_BUILD");
        // tauri_build::build() normally declares these cfgs. Skipping it makes
        // every #[cfg(mobile)] / #[cfg(desktop)] an `unexpected_cfgs` warning,
        // which CI's `clippy -D warnings` turns into a hard failure.
        for cfg in ["mobile", "desktop", "dev"] {
            println!("cargo::rustc-check-cfg=cfg({cfg})");
        }
        return;
    }

    tauri_build::build()
}
