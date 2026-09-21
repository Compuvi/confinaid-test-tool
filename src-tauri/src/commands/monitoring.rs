// SPDX-License-Identifier: Apache-2.0
//! Monitoring commands — fetch partner API traffic data from the Confinaid backend.
//!
//! Endpoints called (all GET, bearer-authenticated):
//!   /partner/monitoring/{company_id}/records/           paginated request log
//!   /partner/monitoring/{company_id}/records/{id}/      single request detail
//!   /partner/monitoring/{company_id}/records/summary/   KPI counters

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::http::endpoints::{bearer_for_active_profile, fire_get};
use crate::state::AppState;

const TIMEOUT_MS: u64 = 30_000;

// ── Wire types returned to the frontend ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringCredentialRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringRecord {
    pub id: String,
    pub created_at: String,
    pub client_ip: Option<String>,
    pub is_rewrited: bool,
    pub status: String,
    pub risk_score: Option<f64>,
    pub processing_time: Option<f64>,
    pub request_charge: Option<String>,
    pub rewrite_charge: Option<String>,
    pub token_charge: Option<String>,
    pub api_credential: Option<MonitoringCredentialRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringRecordDetail {
    pub id: String,
    pub created_at: String,
    pub client_ip: Option<String>,
    pub is_rewrited: bool,
    pub status: String,
    pub risk_score: Option<f64>,
    pub processing_time: Option<f64>,
    pub request_charge: Option<String>,
    pub rewrite_charge: Option<String>,
    pub token_charge: Option<String>,
    pub api_credential: Option<MonitoringCredentialRef>,
    pub text: Option<String>,
    pub findings: Option<serde_json::Value>,
    pub ai_model: Option<serde_json::Value>,
    pub filtering_profile_title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringSummary {
    pub total: Option<i64>,
    pub rewrites: Option<i64>,
    pub clean: Option<i64>,
    pub risky: Option<i64>,
    pub hitl: Option<i64>,
    pub incomplete: Option<i64>,
    pub avg_processing_time: Option<f64>,
    // Charge totals (may not be present on older backends)
    pub request_charge_total: Option<String>,
    pub rewrite_charge_total: Option<String>,
    pub token_charge_total: Option<String>,
    pub total_charge: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringPage {
    pub count: i64,
    pub results: Vec<MonitoringRecord>,
}

// ── Input params ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringFilters {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub operation: Option<String>,
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn build_filter_query(filters: &MonitoringFilters, buf: &mut Vec<(String, String)>) {
    if let Some(ref v) = filters.start_date {
        buf.push(("start_date".into(), v.clone()));
    }
    if let Some(ref v) = filters.end_date {
        buf.push(("end_date".into(), v.clone()));
    }
    if let Some(ref v) = filters.status {
        buf.push(("status".into(), v.clone()));
    }
    if let Some(ref v) = filters.operation {
        buf.push(("operation".into(), v.clone()));
    }
}

/// Build the monitoring collection URL.
///
/// - With company_id: `{monitoringUrl}/partner/monitoring/{company_id}/`
/// - Without:         `{monitoringUrl}/v1/monitoring/`
fn monitoring_base(monitoring_url: &str, company_id: Option<String>) -> String {
    match company_id.filter(|s| !s.is_empty()) {
        Some(cid) => format!("{monitoring_url}/partner/monitoring/{cid}/"),
        None => format!("{monitoring_url}/v1/monitoring/"),
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Paginated request log.
#[tauri::command]
pub async fn list_monitoring_records(
    state: State<'_, AppState>,
    filters: MonitoringFilters,
    page: Option<u32>,
    page_size: Option<u32>,
    ordering: Option<String>,
) -> AppResult<MonitoringPage> {
    let ctx = bearer_for_active_profile(&state).await?;
    let mon_base = monitoring_base(&ctx.monitoring_base_url, ctx.company_id);
    let token = ctx.access_token;
    let url = format!("{mon_base}records/");

    let mut params: Vec<(String, String)> = Vec::new();
    build_filter_query(&filters, &mut params);
    params.push(("page".into(), page.unwrap_or(1).to_string()));
    params.push(("page_size".into(), page_size.unwrap_or(15).to_string()));
    if let Some(ref o) = ordering {
        params.push(("ordering".into(), o.clone()));
    }

    let query_refs: Vec<(&str, &str)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let body = fire_get(&url, &token, &query_refs, TIMEOUT_MS).await?;

    // Backend returns { count, results: [...] }
    #[derive(Deserialize)]
    struct RawPage {
        count: Option<i64>,
        results: Option<Vec<MonitoringRecord>>,
    }
    let raw: RawPage = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("monitoring records parse error: {e}")))?;

    Ok(MonitoringPage {
        count: raw.count.unwrap_or(0),
        results: raw.results.unwrap_or_default(),
    })
}

/// KPI counters for the selected range.
#[tauri::command]
pub async fn get_monitoring_summary(
    state: State<'_, AppState>,
    filters: MonitoringFilters,
) -> AppResult<MonitoringSummary> {
    let ctx = bearer_for_active_profile(&state).await?;
    let mon_base = monitoring_base(&ctx.monitoring_base_url, ctx.company_id);
    let token = ctx.access_token;
    let url = format!("{mon_base}records/summary/");

    let mut params: Vec<(String, String)> = Vec::new();
    build_filter_query(&filters, &mut params);
    let query_refs: Vec<(&str, &str)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let body = fire_get(&url, &token, &query_refs, TIMEOUT_MS).await?;
    serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("monitoring summary parse error: {e}")))
}

/// Single request in full (includes analyzed text).
#[tauri::command]
pub async fn get_monitoring_record(
    state: State<'_, AppState>,
    record_id: String,
) -> AppResult<MonitoringRecordDetail> {
    let ctx = bearer_for_active_profile(&state).await?;
    let mon_base = monitoring_base(&ctx.monitoring_base_url, ctx.company_id);
    let token = ctx.access_token;
    let url = format!("{mon_base}records/{record_id}/");

    let body = fire_get(&url, &token, &[], TIMEOUT_MS).await?;
    serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("monitoring record parse error: {e}")))
}
