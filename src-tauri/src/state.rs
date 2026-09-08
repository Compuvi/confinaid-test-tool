// SPDX-License-Identifier: Apache-2.0
//! Managed application state.

use std::path::PathBuf;
use std::sync::RwLock;

use tauri::{AppHandle, Manager};

use crate::config::AppConfig;
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct AppState {
    pub config: RwLock<AppConfig>,
}

impl AppState {
    /// Directory Tauri assigns this app for configuration, e.g.
    /// `~/Library/Application Support/com.compuvi.confinaid.testtool`.
    pub fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
        app.path()
            .app_config_dir()
            .map_err(|err| AppError::Storage(format!("no app config directory: {err}")))
    }

    /// Called once from `setup`. A corrupt or unreadable config is logged and
    /// replaced with defaults rather than blocking startup — the user can fix
    /// it from the Settings page, but only if the app actually opens.
    pub fn load_from_disk(&self, app: &AppHandle) -> AppResult<()> {
        let dir = Self::config_dir(app)?;
        let config = match AppConfig::load_from_dir(&dir) {
            Ok(config) => config,
            Err(err) => {
                eprintln!("[config] falling back to defaults: {err}");
                AppConfig::default()
            }
        };

        *self
            .config
            .write()
            .map_err(|_| AppError::Internal("config lock poisoned".into()))? = config;

        Ok(())
    }

    pub fn config_snapshot(&self) -> AppResult<AppConfig> {
        self.config
            .read()
            .map_err(|_| AppError::Internal("config lock poisoned".into()))
            .map(|guard| guard.clone())
    }

    pub fn update_config(&self, app: &AppHandle, next: AppConfig) -> AppResult<()> {
        next.save_to_dir(&Self::config_dir(app)?)?;
        *self
            .config
            .write()
            .map_err(|_| AppError::Internal("config lock poisoned".into()))? = next;
        Ok(())
    }
}
