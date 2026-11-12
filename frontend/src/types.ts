export type Scenario = "ok" | "recover" | "rate_limit" | "timeout" | "rejected" | "issue";

export type Status = "received" | "processing" | "retrying" | "delivered" | "dead";

export interface EventItem {
  id: string;
  source: string;
  delivery_id: string;
  event_type: string;
  status: Status;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  received_at: string;
  delivered_at: string | null;
}

export interface Attempt {
  attempted_at: string;
  http_status: number | null;
  duration_ms: number;
  error: string | null;
}

export interface EventDetailData extends EventItem {
  payload: string;
  outbound: Record<string, unknown>;
  attempt_history: Attempt[];
}

export interface EventPage {
  total: number;
  items: EventItem[];
}

export interface Stats {
  total: number;
  by_status: Record<Status, number>;
  avg_attempts: number | null;
  delivered_ratio: number | null;
  delivery_seconds: { p50: number | null; p95: number | null };
}
