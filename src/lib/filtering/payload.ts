/**
 * Form drafts -> request bodies.
 *
 * Each resource has a draft type (what the form edits, every field present)
 * and a builder that normalises it into the wire shape: trimmed strings,
 * blank optional text as `null`, fields that do not apply dropped. Edits are
 * sent as PATCH with only the fields that changed (`diffPatch`), comparing
 * the built payload of the original against the built payload of the draft
 * so normalisation never shows up as a spurious change.
 */

import type {
  BypassCondition,
  BypassConditionType,
  BypassRule,
  BypassRuleWrite,
  BypassTargetType,
  Codename,
  CodenameWrite,
  FilteringProfile,
  FilteringProfileWrite,
  Keyword,
  KeywordGroup,
  KeywordGroupWrite,
  KeywordWrite,
  LabelSetting,
  LabelSettingWrite,
  MatchMode,
  MatchType,
} from "@/types/filtering";

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** Trim; blank becomes `null`. */
export function emptyToNull(value: string | null | undefined): string | null {
  const s = (value ?? "").trim();
  return s === "" ? null : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural equality. Arrays of strings (id lists) compare as sets, since
 * the API does not promise an order; other arrays compare element-wise.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (a.every((x) => typeof x === "string") && b.every((x) => typeof x === "string")) {
      const sa = [...(a as string[])].sort();
      const sb = [...(b as string[])].sort();
      return sa.every((x, i) => x === sb[i]);
    }
    return a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!valuesEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** The keys of `next` whose value differs from `prev`, for a PATCH body. */
export function diffPatch<T extends Record<string, unknown>>(prev: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!valuesEqual(prev[key], next[key])) out[key] = next[key];
  }
  return out;
}

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

// ─── Profile ──────────────────────────────────────────────────────────────────

export type ProfileDraft = Required<Omit<FilteringProfileWrite, "description" | "ai_model_id">> & {
  description: string;
  ai_model_id: string;
};

export const HITL_OFF_MAX_THRESHOLD = 80;

export function defaultProfileDraft(): ProfileDraft {
  return {
    title: "",
    description: "",
    context: "",
    general_threshold: 60,
    ai_model_id: "",
    keyword_filtering_enabled: true,
    codename_filtering_enabled: true,
    label_filtering_enabled: true,
    rewrite_enabled: true,
    hitl_enabled: true,
    deep_scan_enabled: false,
    attachment_ids: [],
    language_ids: [],
  };
}

export function profileToDraft(p: FilteringProfile): ProfileDraft {
  return {
    title: p.title,
    description: p.description ?? "",
    context: p.context ?? "",
    general_threshold: p.general_threshold,
    ai_model_id: p.ai_model_id ?? "",
    keyword_filtering_enabled: p.keyword_filtering_enabled,
    codename_filtering_enabled: p.codename_filtering_enabled,
    label_filtering_enabled: p.label_filtering_enabled,
    rewrite_enabled: p.rewrite_enabled,
    hitl_enabled: p.hitl_enabled,
    deep_scan_enabled: p.deep_scan_enabled,
    attachment_ids: [...(p.attachment_ids ?? [])],
    language_ids: [...(p.language_ids ?? [])],
  };
}

export function buildProfilePayload(d: ProfileDraft): FilteringProfileWrite {
  const out: FilteringProfileWrite = {
    title: d.title.trim(),
    description: emptyToNull(d.description),
    context: d.context,
    general_threshold: d.general_threshold,
    keyword_filtering_enabled: d.keyword_filtering_enabled,
    codename_filtering_enabled: d.codename_filtering_enabled,
    label_filtering_enabled: d.label_filtering_enabled,
    rewrite_enabled: d.rewrite_enabled,
    hitl_enabled: d.hitl_enabled,
    deep_scan_enabled: d.deep_scan_enabled,
    attachment_ids: d.attachment_ids,
    language_ids: d.language_ids,
  };
  // `ai_model_id` is not nullable on the wire: leave it out to keep the default.
  if (d.ai_model_id) out.ai_model_id = d.ai_model_id;
  return out;
}

/** PATCH body for a profile edit: only the changed fields. */
export function profilePatch(original: FilteringProfile, draft: ProfileDraft) {
  return diffPatch(
    buildProfilePayload(profileToDraft(original)) as Record<string, unknown>,
    buildProfilePayload(draft) as Record<string, unknown>
  ) as FilteringProfileWrite;
}

// ─── Keyword ──────────────────────────────────────────────────────────────────

export type KeywordDraft = {
  name: string;
  description: string;
  is_active: boolean;
  match_type: MatchType;
  regex_pattern: string;
  language_id: string;
};

export const defaultKeywordDraft = (): KeywordDraft => ({
  name: "",
  description: "",
  is_active: true,
  match_type: "exact",
  regex_pattern: "",
  language_id: "",
});

export const keywordToDraft = (k: Keyword): KeywordDraft => ({
  name: k.name,
  description: k.description ?? "",
  is_active: k.is_active,
  match_type: k.match_type,
  regex_pattern: k.regex_pattern ?? "",
  language_id: k.language_id ?? "",
});

export function buildKeywordPayload(d: KeywordDraft): KeywordWrite {
  return {
    name: d.name.trim(),
    description: emptyToNull(d.description),
    is_active: d.is_active,
    match_type: d.match_type,
    // The pattern only means something for regex keywords.
    regex_pattern: d.match_type === "regex" ? d.regex_pattern : null,
    language_id: emptyToNull(d.language_id),
  };
}

// ─── Codename ─────────────────────────────────────────────────────────────────

export type CodenameDraft = {
  name: string;
  original_name: string;
  description: string;
  is_active: boolean;
  language_id: string;
};

export const defaultCodenameDraft = (): CodenameDraft => ({
  name: "",
  original_name: "",
  description: "",
  is_active: true,
  language_id: "",
});

export const codenameToDraft = (c: Codename): CodenameDraft => ({
  name: c.name,
  original_name: c.original_name ?? "",
  description: c.description ?? "",
  is_active: c.is_active,
  language_id: c.language_id ?? "",
});

export const buildCodenamePayload = (d: CodenameDraft): CodenameWrite => ({
  name: d.name.trim(),
  original_name: emptyToNull(d.original_name),
  description: emptyToNull(d.description),
  is_active: d.is_active,
  language_id: emptyToNull(d.language_id),
});

// ─── Keyword group ────────────────────────────────────────────────────────────

export type KeywordGroupDraft = {
  title: string;
  description: string;
  keyword_ids: string[];
  min_matches: number;
  proximity_window: number;
  is_active: boolean;
};

export const defaultKeywordGroupDraft = (): KeywordGroupDraft => ({
  title: "",
  description: "",
  keyword_ids: [],
  min_matches: 2,
  proximity_window: 0,
  is_active: true,
});

export const keywordGroupToDraft = (g: KeywordGroup): KeywordGroupDraft => ({
  title: g.title,
  description: g.description ?? "",
  keyword_ids: [...g.keyword_ids],
  min_matches: g.min_matches,
  proximity_window: g.proximity_window,
  is_active: g.is_active,
});

export const buildKeywordGroupPayload = (d: KeywordGroupDraft): KeywordGroupWrite => ({
  title: d.title.trim(),
  description: emptyToNull(d.description),
  keyword_ids: d.keyword_ids,
  min_matches: d.min_matches,
  proximity_window: d.proximity_window,
  is_active: d.is_active,
});

// ─── Label setting ────────────────────────────────────────────────────────────

export type LabelSettingDraft = {
  label_id: string;
  threshold: number;
  is_active: boolean;
  is_clean: boolean;
  is_blocked: boolean;
  hitl_threshold_enabled: boolean;
  hitl_threshold_min: number | null;
  hitl_threshold_max: number | null;
  exception_text: string;
  is_exempt: boolean;
};

export const defaultLabelSettingDraft = (): LabelSettingDraft => ({
  label_id: "",
  threshold: 60,
  is_active: true,
  is_clean: false,
  is_blocked: false,
  hitl_threshold_enabled: false,
  hitl_threshold_min: null,
  hitl_threshold_max: null,
  exception_text: "",
  is_exempt: false,
});

export const labelSettingToDraft = (s: LabelSetting): LabelSettingDraft => ({
  label_id: s.label_id,
  threshold: s.threshold,
  is_active: s.is_active,
  is_clean: s.is_clean,
  is_blocked: s.is_blocked,
  hitl_threshold_enabled: s.hitl_threshold_enabled,
  hitl_threshold_min: s.hitl_threshold_min,
  hitl_threshold_max: s.hitl_threshold_max,
  exception_text: s.exception_text ?? "",
  is_exempt: s.is_exempt,
});

/** Body without `label_id`, which cannot change after creation. */
export const buildLabelSettingPayload = (d: LabelSettingDraft): LabelSettingWrite => ({
  threshold: d.threshold,
  is_active: d.is_active,
  is_clean: d.is_clean,
  is_blocked: d.is_blocked,
  hitl_threshold_enabled: d.hitl_threshold_enabled,
  hitl_threshold_min: d.hitl_threshold_min,
  hitl_threshold_max: d.hitl_threshold_max,
  exception_text: emptyToNull(d.exception_text),
  is_exempt: d.is_exempt,
});

// ─── Bypass rule ──────────────────────────────────────────────────────────────

export type ConditionDraft = {
  /** Client-only stable identity for list rendering; never sent. */
  key: string;
  condition_type: BypassConditionType;
  threshold: number;
  keyword_ids: string[];
  label_ids: string[];
  statuses: string[];
};

export type BypassRuleDraft = {
  title: string;
  description: string;
  target_type: BypassTargetType;
  target_id: string;
  match_mode: MatchMode;
  is_active: boolean;
  conditions: ConditionDraft[];
};

let conditionSeq = 0;
const nextConditionKey = () => `c${++conditionSeq}`;

export const defaultConditionDraft = (
  condition_type: BypassConditionType = "always"
): ConditionDraft => ({
  key: nextConditionKey(),
  condition_type,
  threshold: 50,
  keyword_ids: [],
  label_ids: [],
  statuses: [],
});

export const defaultBypassRuleDraft = (): BypassRuleDraft => ({
  title: "",
  description: "",
  target_type: "company",
  target_id: "",
  match_mode: "all",
  is_active: true,
  conditions: [defaultConditionDraft()],
});

export const conditionToDraft = (c: BypassCondition): ConditionDraft => ({
  key: c.id ?? nextConditionKey(),
  condition_type: c.condition_type,
  threshold: c.threshold ?? 50,
  keyword_ids: [...(c.keyword_ids ?? [])],
  label_ids: [...(c.label_ids ?? [])],
  statuses: [...(c.statuses ?? [])],
});

export const bypassRuleToDraft = (r: BypassRule): BypassRuleDraft => ({
  title: r.title,
  description: r.description ?? "",
  target_type: r.target_type,
  target_id: r.target_id ?? "",
  match_mode: r.match_mode,
  is_active: r.is_active,
  conditions: r.conditions.map(conditionToDraft),
});

/** Which payload field a condition type uses, if any. */
export function conditionField(
  type: BypassConditionType
): "threshold" | "keyword_ids" | "label_ids" | "statuses" | null {
  switch (type) {
    case "risk_score_lte":
    case "risk_score_gte":
      return "threshold";
    case "has_keyword":
    case "not_has_keyword":
      return "keyword_ids";
    case "has_label":
    case "not_has_label":
      return "label_ids";
    case "status_is":
      return "statuses";
    default:
      return null;
  }
}

/** Only the field the condition type uses is sent; `id` is read-only. */
export function buildConditionPayload(c: ConditionDraft): BypassCondition {
  const out: BypassCondition = { condition_type: c.condition_type };
  const field = conditionField(c.condition_type);
  if (field === "threshold") out.threshold = c.threshold;
  else if (field) out[field] = [...c[field]];
  return out;
}

export function buildBypassRulePayload(d: BypassRuleDraft): BypassRuleWrite {
  return {
    title: d.title.trim(),
    description: emptyToNull(d.description),
    target_type: d.target_type,
    // Null if and only if the rule targets the whole company.
    target_id: d.target_type === "company" ? null : emptyToNull(d.target_id),
    match_mode: d.match_mode,
    is_active: d.is_active,
    conditions: d.conditions.map(buildConditionPayload),
  };
}

// ─── Edit helper ──────────────────────────────────────────────────────────────

/** PATCH body: build both sides with `build`, then keep only the changes. */
export function patchFrom<D, W>(build: (d: D) => W, original: D, draft: D): Partial<W> {
  return diffPatch(
    build(original) as Record<string, unknown>,
    build(draft) as Record<string, unknown>
  ) as Partial<W>;
}
