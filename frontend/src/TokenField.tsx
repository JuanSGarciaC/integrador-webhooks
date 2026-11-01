import { useEffect, useState } from "react";
import { getToken, setToken } from "./api";

/** Devuelve el token actual y se actualiza cuando cambia. */
export function useToken(): string {
  const [token, set] = useState(getToken);
  useEffect(() => {
    const on = () => set(getToken());
    window.addEventListener("token-change", on);
    return () => window.removeEventListener("token-change", on);
  }, []);
  return token;
}

export function TokenField() {
  const token = useToken();
  const [draft, setDraft] = useState("");

  if (token) {
    return (
      <div className="token">
        <span className="role">Rol: <strong>Admin</strong></span>
        <button onClick={() => setToken("")}>Salir</button>
      </div>
    );
  }
  return (
    <form className="token" onSubmit={(e) => { e.preventDefault(); setToken(draft.trim()); setDraft(""); }}>
      <span className="role">Rol: <strong>Visitante</strong></span>
      <label>Token admin
        <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="submit" disabled={!draft.trim()}>Guardar</button>
    </form>
  );
}
