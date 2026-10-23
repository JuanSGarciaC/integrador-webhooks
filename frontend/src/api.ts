import type { EventDetailData, EventItem, EventPage, Stats } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* cuerpo no JSON */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  events: (p: { status?: string; event_type?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => v !== undefined && v !== "" && q.set(k, String(v)));
    return request<EventPage>(`/api/events?${q}`);
  },
  event: (id: string) => request<EventDetailData>(`/api/events/${id}`),
  replay: (id: string) => request<EventItem>(`/api/events/${id}/replay`, { method: "POST" }),
  stats: () => request<Stats>("/api/stats"),
};
