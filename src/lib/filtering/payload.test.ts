import { describe, expect, it } from "vitest";

import type { BypassRule, FilteringProfile, Keyword } from "@/types/filtering";

import {
  buildBypassRulePayload,
  buildConditionPayload,
  buildKeywordPayload,
  buildLabelSettingPayload,
  bypassRuleToDraft,
  defaultConditionDraft,
  defaultLabelSettingDraft,
  diffPatch,
  emptyToNull,
  isUuid,
  keywordToDraft,
  patchFrom,
  profilePatch,
  profileToDraft,
  valuesEqual,
} from "./payload";

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const profile: FilteringProfile = {
  id: B,
  title: "Finance",
  description: null,
  is_primary: false,
  general_threshold: 60,
  ai_model_id: A,
  keyword_filtering_enabled: true,
  codename_filtering_enabled: false,
  label_filtering_enabled: true,
  rewrite_enabled: true,
  hitl_enabled: true,
  deep_scan_enabled: false,
  context: "",
  region: { id: A, name: "EU" },
  attachment_ids: [A, B],
  language_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("helpers", () => {
  it("emptyToNull trims and nulls blanks", () => {
    expect(emptyToNull("  x ")).toBe("x");
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull(null)).toBeNull();
  });

  it("valuesEqual treats id arrays as sets and objects deeply", () => {
    expect(valuesEqual([A, B], [B, A])).toBe(true);
    expect(valuesEqual([A], [A, B])).toBe(false);
    expect(valuesEqual([{ x: 1 }], [{ x: 1 }])).toBe(true);
    expect(valuesEqual([{ x: 1 }, { x: 2 }], [{ x: 2 }, { x: 1 }])).toBe(false);
    expect(valuesEqual({ a: null }, { a: undefined })).toBe(false);
    expect(valuesEqual(null, null)).toBe(true);
  });

  it("diffPatch keeps only changed keys", () => {
    expect(diffPatch({ a: 1, b: "x", c: [A] }, { a: 1, b: "y", c: [A] })).toEqual({ b: "y" });
  });

  it("isUuid accepts canonical ids of either case", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid(A.toUpperCase())).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });
});

describe("profilePatch", () => {
  it("is empty when nothing changed, including reordered ids", () => {
    const draft = profileToDraft(profile);
    draft.attachment_ids = [B, A];
    expect(profilePatch(profile, draft)).toEqual({});
  });

  it("sends only the changed fields with normalised values", () => {
    const draft = profileToDraft(profile);
    draft.title = "  Finance team ";
    draft.description = "   ";
    draft.hitl_enabled = false;
    draft.general_threshold = 80;
    draft.language_ids = [A];
    expect(profilePatch(profile, draft)).toEqual({
      title: "Finance team",
      hitl_enabled: false,
      general_threshold: 80,
      language_ids: [A],
    });
  });

  it("never sends an empty ai_model_id", () => {
    const draft = profileToDraft({ ...profile, ai_model_id: null });
    expect(profilePatch({ ...profile, ai_model_id: null }, draft)).toEqual({});
    expect("ai_model_id" in profilePatch(profile, { ...draft, ai_model_id: "" })).toBe(false);
  });
});

describe("keyword payload", () => {
  const kw: Keyword = {
    id: A,
    name: "iban",
    description: null,
    is_active: true,
    match_type: "regex",
    regex_pattern: "TR\\d{24}",
    language_id: null,
    created_at: "",
    updated_at: "",
  };

  it("drops the regex pattern unless the match type is regex", () => {
    const draft = keywordToDraft(kw);
    expect(buildKeywordPayload(draft).regex_pattern).toBe("TR\\d{24}");
    expect(buildKeywordPayload({ ...draft, match_type: "exact" }).regex_pattern).toBeNull();
  });

  it("patches only what changed", () => {
    const original = keywordToDraft(kw);
    expect(patchFrom(buildKeywordPayload, original, { ...original, is_active: false })).toEqual({
      is_active: false,
    });
    expect(
      patchFrom(buildKeywordPayload, original, { ...original, match_type: "partial" })
    ).toEqual({ match_type: "partial", regex_pattern: null });
  });
});

describe("label setting payload", () => {
  it("never includes label_id and nulls blank exception text", () => {
    const payload = buildLabelSettingPayload({ ...defaultLabelSettingDraft(), label_id: A });
    expect("label_id" in payload).toBe(false);
    expect(payload.exception_text).toBeNull();
  });
});

describe("bypass rule payload", () => {
  it("sends only the field each condition type uses", () => {
    const base = {
      ...defaultConditionDraft(),
      threshold: 30,
      keyword_ids: [A],
      label_ids: [B],
      statuses: ["hitl"],
    };
    expect(buildConditionPayload({ ...base, condition_type: "always" })).toEqual({
      condition_type: "always",
    });
    expect(buildConditionPayload({ ...base, condition_type: "risk_score_lte" })).toEqual({
      condition_type: "risk_score_lte",
      threshold: 30,
    });
    expect(buildConditionPayload({ ...base, condition_type: "not_has_keyword" })).toEqual({
      condition_type: "not_has_keyword",
      keyword_ids: [A],
    });
    expect(buildConditionPayload({ ...base, condition_type: "has_label" })).toEqual({
      condition_type: "has_label",
      label_ids: [B],
    });
    expect(buildConditionPayload({ ...base, condition_type: "status_is" })).toEqual({
      condition_type: "status_is",
      statuses: ["hitl"],
    });
  });

  const rule: BypassRule = {
    id: A,
    title: "Legal",
    description: null,
    target_type: "department",
    target_id: B,
    match_mode: "all",
    is_active: true,
    conditions: [
      {
        id: B,
        condition_type: "risk_score_lte",
        threshold: 40,
        keyword_ids: [],
        label_ids: [],
        statuses: [],
      },
    ],
    created_at: "",
    updated_at: "",
  };

  it("gives conditions stable keys that are never sent", () => {
    const draft = bypassRuleToDraft(rule);
    expect(draft.conditions[0].key).toBe(B);
    const a = defaultConditionDraft();
    const b = defaultConditionDraft();
    expect(a.key).not.toBe(b.key);
    expect("key" in buildConditionPayload(a)).toBe(false);
  });

  it("nulls target_id for company rules", () => {
    const draft = bypassRuleToDraft(rule);
    expect(buildBypassRulePayload({ ...draft, target_type: "company" }).target_id).toBeNull();
    expect(buildBypassRulePayload(draft).target_id).toBe(B);
  });

  it("does not resend unchanged conditions, and replaces them wholesale when one changes", () => {
    const original = bypassRuleToDraft(rule);
    expect(patchFrom(buildBypassRulePayload, original, { ...original, is_active: false })).toEqual({
      is_active: false,
    });

    const edited = bypassRuleToDraft(rule);
    edited.conditions[0].threshold = 55;
    edited.conditions.push(defaultConditionDraft("status_is"));
    edited.conditions[1].statuses = ["clean"];
    expect(patchFrom(buildBypassRulePayload, original, edited)).toEqual({
      conditions: [
        { condition_type: "risk_score_lte", threshold: 55 },
        { condition_type: "status_is", statuses: ["clean"] },
      ],
    });
  });
});
