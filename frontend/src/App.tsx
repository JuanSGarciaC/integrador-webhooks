import { useEffect, useState } from "react";
import { api } from "./api";
import { TokenField } from "./TokenField";
import { Simulate } from "./pages/Simulate";
import { DeadLetters } from "./pages/DeadLetters";
import { EventDetail } from "./pages/EventDetail";
import { Events } from "./pages/Events";
import { Stats } from "./pages/Stats";

// Enrutado mínimo por hash: #/events, #/events/<id>, #/dead, #/stats
function useRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

const NAV = [
  ["simulate", "Simular"],
  ["events", "Eventos"],
  ["dead", "Fallidos"],
  ["stats", "Estadísticas"],
] as const;

export default function App() {
  const route = useRoute();
  const [demo, setDemo] = useState(false);
  const [triaje, setTriaje] = useState(false);
  useEffect(() => {
    api.demo().then((d) => { setDemo(d.demo); setTriaje(d.destination === "triaje"); }, () => setDemo(false));
  }, []);
  const destination = triaje ? "Triaje de solicitudes" : "Simulado";
  const section = route[0] ?? (demo ? "simulate" : "events");
  let page;
  if (section === "simulate" && demo) page = <Simulate destination={destination} triaje={triaje} />;
  else if (section === "events" && route[1]) page = <EventDetail key={route[1]} id={route[1]} destination={destination} />;
  else if (section === "dead") page = <DeadLetters />;
  else if (section === "stats") page = <Stats />;
  else page = <Events />;

  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      <header>
        <a className="brand" href="#/">
          <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M8 16h12m-4-6 6 6-6 6" stroke="var(--bg)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <h1>Integrador de webhooks</h1>
            <small>HMAC · reintentos con backoff · reproceso</small>
          </span>
        </a>
        {demo && <span className="pill">Demo pública · datos ficticios</span>}
        <nav aria-label="Principal">
          {NAV.filter(([key]) => demo || key !== "simulate").map(([key, label]) => (
            <a key={key} href={`#/${key}`} aria-current={section === key ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <TokenField />
      </header>
      <main id="main">{page}</main>
    </>
  );
}
