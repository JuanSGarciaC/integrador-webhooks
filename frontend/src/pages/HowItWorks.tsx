import { useEffect, useRef, useState } from "react";
import Flow, { type Focus } from "../Flow";

// C5 scrollytelling: el lienzo queda fijo arriba y el paso que se está leyendo le dice qué iluminar.
interface Step extends Focus {
  title: string;
  body: string;
  code?: string;
}

const STEPS: Step[] = [
  {
    title: "1. Llega un webhook firmado",
    body: "GitHub envía un POST con la cabecera X-Hub-Signature-256: un HMAC-SHA256 del cuerpo crudo calculado con el secreto compartido.",
    code: "POST /webhooks/github\nX-GitHub-Event: push\nX-GitHub-Delivery: 7c1e…\nX-Hub-Signature-256: sha256=9f2b…",
    nodes: ["in"], edges: ["in_api"],
    caption: "El webhook entra por el único camino de entrada.",
  },
  {
    title: "2. La API comprueba la firma",
    body: "Recalcula el HMAC y lo compara en tiempo constante; sin firma válida responde 401. Un cuerpo demasiado grande recibe 413, y un reenvío con el mismo X-GitHub-Delivery responde 200 sin crear otro registro.",
    nodes: ["in", "api"], edges: [],
    caption: "Firma, tamaño e idempotencia se validan antes de guardar.",
  },
  {
    title: "3. Guarda y responde 202 enseguida",
    body: "El evento se guarda en la base de datos, que hace de cola (patrón outbox), y la API responde sin esperar a la entrega. GitHub no se queda colgado aunque el destino vaya lento.",
    code: "HTTP/1.1 202 Accepted\n{\"id\": \"…\", \"status\": \"received\"}",
    nodes: ["in", "api", "q"], edges: ["api_q"],
    caption: "Respuesta rápida: la entrega ocurre después, en otro proceso.",
  },
  {
    title: "4. El worker toma el evento",
    body: "Un proceso aparte reclama los eventos pendientes y los bloquea con locked_until. Si el worker cae, el bloqueo vence y otro ciclo retoma el evento.",
    nodes: ["q", "w"], edges: ["q_w"],
    caption: "El worker reclama el evento con un bloqueo que caduca.",
  },
  {
    title: "5. Lo entrega al destino",
    body: "Envía un payload normalizado, no el original completo, con la cabecera Idempotency-Key igual al id del evento: si llega dos veces, el destino lo reconoce.",
    nodes: ["w", "d"], edges: ["w_d"],
    caption: "Entrega al menos una vez, con consumidor idempotente.",
  },
  {
    title: "6. Si falla, espera exponencial con jitter",
    body: "Un 5xx, un 429 o un timeout devuelven el evento a la cola con espera exponencial y jitter completo. Si el destino manda Retry-After, se respeta.",
    nodes: ["q", "w"], edges: ["w_q"],
    caption: "Vuelta a la cola: cada intento espera más que el anterior.",
  },
  {
    title: "7. Sin pérdida silenciosa",
    body: "Tras 6 intentos, o ante un 4xx que no tiene arreglo reintentando, el evento pasa a Fallidos. Nunca se descarta sin dejar rastro.",
    nodes: ["w", "f"], edges: ["w_f"],
    caption: "Lo que no se puede entregar queda a la vista en Fallidos.",
  },
  {
    title: "8. Una persona lo reprocesa",
    body: "Desde el panel, un admin devuelve el evento a la cola. Un visitante ve «Requiere admin» y la API le responde 401.",
    nodes: ["f", "q"], edges: [],
    caption: "Reproceso manual y protegido con token admin.",
  },
];

export function HowItWorks({ destination, demo }: { destination: string; demo: boolean }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const visual = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Línea de lectura: un 20 % por debajo de lo que tapa el lienzo fijo (o la cabecera si no está fijo).
    // El paso activo es el primero cuyo borde inferior aún no ha subido por encima de esa línea.
    let raf = 0;
    const update = () => {
      raf = 0;
      const v = visual.current;
      if (!v) return;
      const sticky = getComputedStyle(v).position === "sticky";
      const covered = sticky ? v.getBoundingClientRect().bottom : document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const line = covered + (innerHeight - covered) * 0.2;
      const i = items.current.findIndex((el) => el && el.getBoundingClientRect().bottom > line);
      setActive(i === -1 ? STEPS.length - 1 : i);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); }; // como mucho una lectura por fotograma
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section aria-labelledby="t" className="how">
      <h2 id="t">Cómo funciona</h2>
      <p className="lead">
        El recorrido de un webhook, paso a paso. Baja y el lienzo de arriba ilumina la parte que se explica.
      </p>
      <div className="how-visual" ref={visual}>
        <Flow focus={STEPS[active]} destination={destination} />
      </div>
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} ref={(el) => void (items.current[i] = el)} data-i={i}
              className="card" aria-current={i === active ? "step" : undefined}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {s.code && <pre><code>{s.code}</code></pre>}
          </li>
        ))}
      </ol>
      <p className="how-cta">
        {demo
          ? <a href="#/simulate">Pruébalo: simula un webhook y sigue su recorrido →</a>
          : <a href="#/events">Ver los eventos recibidos →</a>}
      </p>
    </section>
  );
}
