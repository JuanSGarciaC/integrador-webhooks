import type { EventDetailData, EventItem, EventPage, Scenario, Stats, Status } from "./types";

// El token admin vive solo en esta pestaña (sessionStorage), nunca en localStorage.
const TOKEN_KEY = "adminToken";
export const getToken = () => sessionStorage.getItem(TOKEN_KEY) ?? "";
export function setToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("token-change"));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const r = await fetch(path, { ...init, headers });
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* cuerpo no JSON */
    }
    if (r.status === 401)
      msg = token
        ? "el token admin guardado no es válido: pulsa «Salir» para volver a visitante"
        : "necesitas el token admin para esta acción";
    throw new Error(typeof msg === "string" ? msg : `Error ${r.status}`);
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
  demo: () => request<{ demo: boolean; destination: "mock" | "triaje" }>("/api/demo"),
  simulate: (scenario: Scenario) =>
    request<{ id: string; status: Status }>("/api/demo/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    }),
};
