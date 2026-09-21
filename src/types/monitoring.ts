/** Mirrors `MonitoringRecord` in `src-tauri/src/commands/monitoring.rs`. */
export type MonitoringRecord = {
  id: string;
  createdAt: string;
  clientIp: string | null;
  isRewrited: boolean;
  status: MonitoringStatus;
  riskScore: number | null;
  processingTime: number | null;
  requestCharge: string | null;
  rewriteCharge: string | null;
  tokenCharge: string | null;
  apiCredential: { id: string; name: string } | null;
};

/** Mirrors `MonitoringRecordDetail`. */
export type MonitoringRecordDetail = MonitoringRecord & {
  text: string | null;
  findings: unknown;
  aiModel: { name: string } | null;
  filteringProfileTitle: string | null;
};

/** Mirrors `MonitoringSummary`. */
export type MonitoringSummary = {
  total: number | null;
  rewrites: number | null;
  clean: number | null;
  risky: number | null;
  hitl: number | null;
  incomplete: number | null;
  avgProcessingTime: number | null;
  // Charge totals
  requestChargeTotal: string | null;
  rewriteChargeTotal: string | null;
  tokenChargeTotal: string | null;
  totalCharge: string | null;
};

/** Mirrors `MonitoringPage`. */
export type MonitoringPage = {
  count: number;
  results: MonitoringRecord[];
};

export type MonitoringStatus = "clean" | "risky" | "hitl" | "unknown";
export type MonitoringOperation = "analyze" | "rewrite";
export type MonitoringSortField = "created_at" | "processing_time" | "risk_score";

export type MonitoringFilters = {
  startDate?: string;
  endDate?: string;
  status?: MonitoringStatus;
  operation?: MonitoringOperation;
};
