import { useEffect, useState } from "react";
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
  ["events", "Eventos"],
  ["dead", "Fallidos"],
  ["stats", "Estadísticas"],
] as const;

export default function App() {
  const route = useRoute();
  const section = route[0] ?? "events";
  let page;
  if (section === "events" && route[1]) page = <EventDetail id={route[1]} />;
  else if (section === "dead") page = <DeadLetters />;
  else if (section === "stats") page = <Stats />;
  else page = <Events />;

  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      <header>
        <h1>Integrador de webhooks</h1>
        <nav aria-label="Principal">
          {NAV.map(([key, label]) => (
            <a key={key} href={`#/${key}`} aria-current={section === key ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main id="main">{page}</main>
    </>
  );
}
