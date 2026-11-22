import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../types";

const LABEL: Record<Status, [string, string]> = {
  received: ["●", "Recibido"],
  processing: ["◐", "Procesando"],
  retrying: ["↻", "Reintentando"],
  delivered: ["✓", "Entregado"],
  dead: ["✕", "Fallido"],
};

// El estado nunca se comunica solo con color: icono + texto.
export function StatusBadge({ status }: { status: Status }) {
  const [icon, text] = LABEL[status];
  return (
    <span className={`badge s-${status}`}>
      <span aria-hidden="true">{icon}</span> {text}
    </span>
  );
}

/** Código HTTP como ficha: verde 2xx, ámbar si se reintenta (429/5xx/sin respuesta), rojo 4xx. */
export function HttpCode({ status }: { status: number | null }) {
  // «HTTP» solo para lectores de pantalla: visualmente basta el número en la ficha.
  return status === null
    ? <span className={`code ${outcome(status)}`}><span className="sr-only">sin respuesta, </span>timeout</span>
    : <span className={`code ${outcome(status)}`}><span className="sr-only">HTTP </span>{status}</span>;
}

export const outcome = (status: number | null) =>
  status === null || status === 429 || status >= 500 ? "retry" : status < 300 ? "ok" : "fail";

export const fmtSeconds = (s: number) => (s < 60 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(1)} min`);

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + "Z").toLocaleString() : "—"; // el backend guarda UTC sin zona

/** Carga datos y los refresca cada `every` ms (0 = una vez). */
export function useFetch<T>(load: () => Promise<T>, deps: unknown[], every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(() => {
    load().then((d) => { setData(d); setError(null); }, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    if (!every) return;
    const t = setInterval(run, every);
    return () => clearInterval(t);
  }, [run, every]);
  return { data, error, reload: run };
}

/**
 * A7: la cifra cuenta desde 0 solo la primera vez que llega; los refrescos posteriores la cambian sin animar.
 * El lector de pantalla oye solo el valor real (sr-only), no los números intermedios.
 */
export function CountUp({ value, format }: { value: number | null; format: (n: number) => string }) {
  const [shown, setShown] = useState<number | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (value === null) return;
    if (done.current || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current = true;
      return setShown(value);
    }
    done.current = true;
    setShown(0);
    const t0 = performance.now();
    let finished = false;
    let raf = requestAnimationFrame(function tick(t) {
      const f = Math.min(1, Math.max(0, t - t0) / 800);
      setShown(f < 1 ? value * (1 - (1 - f) ** 3) : value); // frena al final (ease-out)
      if (f < 1) raf = requestAnimationFrame(tick);
      else finished = true;
    });
    return () => {
      cancelAnimationFrame(raf);
      if (!finished) done.current = false; // interrumpida (p. ej. StrictMode): la siguiente pasada vuelve a contar
    };
  }, [value]);
  if (value === null) return <>—</>;
  return (
    <>
      <span aria-hidden="true">{format(shown ?? value)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

export function ErrorNote({ message }: { message: string }) {
  // La pista del puerto solo tiene sentido si ni siquiera hubo respuesta del servidor.
  const hint = message === "Failed to fetch" ? " ¿Está corriendo la API en el puerto 8000?" : "";
  return <p role="alert" className="error">No se pudo cargar: {message}.{hint}</p>;
}
