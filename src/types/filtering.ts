/**
 * Filtering profile management types.
 *
 * Mirrors the `/v1/filtering-profiles*` and `/v1/filtering/*` schemas in the
 * Partner API OpenAPI document (confinaid-api-service `api/openapi.yaml`).
 * Kept in sync manually — the API is the source of truth.
 */

// ─── IPC ──────────────────────────────────────────────────────────────────────

export type FilteringMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Query pairs. A key may repeat (e.g. `labels`). */
export type QueryPairs = [string, string][];

/** Parameters of the `filtering_request` Rust command. */
export type FilteringRequestParams = {
  method: FilteringMethod;
  /** Absolute API path; Rust validates it against the documented routes. */
  path: string;
  query?: QueryPairs;
  /** JSON object body for POST / PATCH. */
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

// ─── Envelopes ────────────────────────────────────────────────────────────────

export type Page<T> = {
  count: number;
  page: number;
  page_size: number;
  results: T[];
};

/** `details` of a `validation_failed` / `conflict` error: field -> messages. */
export type ErrorDetails = Record<string, string[]>;

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: ErrorDetails;
  };
};

// ─── Profiles ─────────────────────────────────────────────────────────────────

export type RegionRef = { id: string; name: string };

export type FilteringProfileWrite = {
  title?: string;
  description?: string | null;
  general_threshold?: number;
  ai_model_id?: string;
  keyword_filtering_enabled?: boolean;
  codename_filtering_enabled?: boolean;
  label_filtering_enabled?: boolean;
  rewrite_enabled?: boolean;
  hitl_enabled?: boolean;
  deep_scan_enabled?: boolean;
  context?: string;
  attachment_ids?: string[];
  language_ids?: string[];
};

export type FilteringProfileCreate = FilteringProfileWrite & {
  title: string;
  clone_from?: string;
};

export type FilteringProfileCloneRequest = {
  title?: string;
  description?: string | null;
};

export type FilteringProfile = Required<
  Omit<FilteringProfileWrite, "description" | "ai_model_id">
> & {
  id: string;
  description: string | null;
  ai_model_id: string | null;
  is_primary: boolean;
  region: RegionRef | null;
  created_at: string;
  updated_at: string;
};

// ─── Profile entries ──────────────────────────────────────────────────────────

type Timestamps = { created_at: string; updated_at: string };

export type MatchType = "exact" | "partial" | "regex";

export type KeywordWrite = {
  name?: string;
  description?: string | null;
  is_active?: boolean;
  match_type?: MatchType;
  regex_pattern?: string | null;
  language_id?: string | null;
};

export type Keyword = Timestamps & {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  match_type: MatchType;
  regex_pattern: string | null;
  language_id: string | null;
};

export type CodenameWrite = {
  name?: string;
  original_name?: string | null;
  description?: string | null;
  is_active?: boolean;
  language_id?: string | null;
};

export type Codename = Timestamps & {
  id: string;
  name: string;
  original_name: string | null;
  description: string | null;
  is_active: boolean;
  language_id: string | null;
};

export type KeywordGroupWrite = {
  title?: string;
  description?: string | null;
  keyword_ids?: string[];
  min_matches?: number;
  proximity_window?: number;
  is_active?: boolean;
};

export type KeywordGroup = Timestamps & {
  id: string;
  title: string;
  description: string | null;
  keyword_ids: string[];
  min_matches: number;
  proximity_window: number;
  is_active: boolean;
};

export type LabelSettingWrite = {
  threshold?: number;
  is_active?: boolean;
  is_clean?: boolean;
  is_blocked?: boolean;
  hitl_threshold_enabled?: boolean;
  hitl_threshold_min?: number | null;
  hitl_threshold_max?: number | null;
  exception_text?: string | null;
  is_exempt?: boolean;
};

export type LabelSettingCreate = LabelSettingWrite & { label_id: string };

export type LabelSetting = Timestamps & {
  id: string;
  label_id: string;
  threshold: number;
  is_active: boolean;
  is_clean: boolean;
  is_blocked: boolean;
  hitl_threshold_enabled: boolean;
  hitl_threshold_min: number | null;
  hitl_threshold_max: number | null;
  exception_text: string | null;
  is_exempt: boolean;
  condition_status?: string;
};

export const BYPASS_TARGET_TYPES = ["company", "department", "role", "employee"] as const;
export type BypassTargetType = (typeof BYPASS_TARGET_TYPES)[number];

export const BYPASS_CONDITION_TYPES = [
  "always",
  "risk_score_lte",
  "risk_score_gte",
  "has_keyword",
  "not_has_keyword",
  "has_label",
  "not_has_label",
  "status_is",
] as const;
export type BypassConditionType = (typeof BYPASS_CONDITION_TYPES)[number];

/** Verdict bands a `status_is` condition may name. */
export const BYPASS_STATUSES = ["clean", "risky", "hitl"] as const;

export type BypassCondition = {
  id?: string;
  condition_type: BypassConditionType;
  threshold?: number | null;
  keyword_ids?: string[];
  label_ids?: string[];
  statuses?: string[];
};

export type MatchMode = "all" | "any";

export type BypassRuleWrite = {
  title?: string;
  description?: string | null;
  target_type?: BypassTargetType;
  target_id?: string | null;
  match_mode?: MatchMode;
  is_active?: boolean;
  conditions?: BypassCondition[];
};

export type BypassRule = Timestamps & {
  id: string;
  title: string;
  description: string | null;
  target_type: BypassTargetType;
  target_id: string | null;
  match_mode: MatchMode;
  is_active: boolean;
  conditions: BypassCondition[];
};

// ─── Activity log ─────────────────────────────────────────────────────────────

export const LOG_ACTIONS = [
  "created",
  "updated",
  "enabled",
  "disabled",
  "added",
  "removed",
  "threshold_changed",
  "set_primary",
  "deleted",
  "restored",
  "bypassed",
] as const;

export const LOG_ENTITIES = [
  "profile",
  "flag",
  "keyword",
  "keyword_group",
  "codename",
  "language",
  "label",
  "label_setting",
  "label_condition",
  "attachment",
  "bypass_rule",
] as const;

export type FilteringLogChange = { field: string; old?: unknown; new?: unknown };

export type FilteringLog = {
  id: string;
  action: string;
  entity: string;
  target_repr?: string;
  changes?: FilteringLogChange[];
  actor_type: "user" | "api_credential" | "system";
  actor_name: string | null;
  created_at: string;
};

// ─── Catalogs ─────────────────────────────────────────────────────────────────

export type CatalogName =
  "labels" | "languages" | "attachments" | "ai-models" | "label-conditions" | "keyword-templates";

export type CatalogLabel = {
  id: string;
  key: string;
  title: string;
  parent_id?: string | null;
  region_id?: string | null;
};

export type CatalogLanguage = { id: string; code: string; name: string };

export type CatalogAttachment = { id: string; name: string; [extra: string]: unknown };

export type CatalogAiModel = { id: string; name: string; version?: string; is_default?: boolean };

/** The profile sub-collections reachable under `/v1/filtering-profiles/{id}/`. */
export type ProfileCollection =
  "keywords" | "keyword-groups" | "codenames" | "label-settings" | "bypass-rules" | "logs";
