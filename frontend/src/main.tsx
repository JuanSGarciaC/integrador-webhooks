import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// El brillo de las tarjetas sigue al puntero: un solo escucha para toda la página.
document.addEventListener("pointermove", (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>(".glow, .card");
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
