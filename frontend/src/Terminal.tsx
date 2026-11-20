import { useEffect, useRef, useState } from "react";
import type { Line } from "./terminalLines";

const CPS = 90; // caracteres por segundo al teclear

/**
 * Terminal del detalle. Al abrirla, lo que ya pasó aparece escrito; solo se teclea lo que llega
 * mientras se mira. El texto pendiente ya ocupa su sitio (transparente): el layout no se mueve.
 */
export function Terminal({ lines }: { lines: Line[] }) {
  const full = lines.map((l) => l.text).join("\n");
  const [typed, setTyped] = useState(full.length);
  const typedRef = useRef(full.length);
  const prev = useRef(full);

  useEffect(() => {
    const old = prev.current;
    prev.current = full;
    if (old === full) return;
    // Lo que no cambió sigue escrito; se teclea desde el primer carácter distinto.
    let common = 0;
    while (common < old.length && common < full.length && old[common] === full[common]) common++;
    const set = (n: number) => {
      typedRef.current = n;
      setTyped(n);
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return set(full.length);
    let cur = Math.min(typedRef.current, common);
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      cur = Math.min(full.length, cur + (last ? ((now - last) * CPS) / 1000 : 0));
      last = now;
      set(Math.floor(cur));
      if (cur < full.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [full]);

  let offset = 0;
  return (
    <div className="terminal" role="group" aria-label="Registro del evento">
      {lines.map((l, i) => {
        const start = offset;
        offset += l.text.length + 1;
        const shown = Math.max(0, Math.min(l.text.length, typed - start));
        const typing = typed < full.length && typed >= start && typed <= start + l.text.length;
        return (
          <div key={i} className={`t-line t-${l.tone}`}>
            {l.text.slice(0, shown)}
            {typing && <span className="caret" aria-hidden="true" />}
            <span className="t-pending">{l.text.slice(shown)}</span>
          </div>
        );
      })}
    </div>
  );
}
