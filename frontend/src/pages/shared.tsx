import { useCallback, useEffect, useState } from "react";
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

export function ErrorNote({ message }: { message: string }) {
  // La pista del puerto solo tiene sentido si ni siquiera hubo respuesta del servidor.
  const hint = message === "Failed to fetch" ? " ¿Está corriendo la API en el puerto 8000?" : "";
  return <p role="alert" className="error">No se pudo cargar: {message}.{hint}</p>;
}
