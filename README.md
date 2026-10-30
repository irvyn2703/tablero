# Tablero

Empresas, tickets con avance y sprints. El front es estático. Supabase guarda los datos. Un agente local recomienda, reserva y adjunta el pull; no lo mergea.

## Web

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

En Supabase, Authentication → Google. En URL configuration:

- Site URL: `http://localhost:5173`
- Redirect URLs: `http://localhost:5173/**` y `https://<usuario>.github.io/tablero/**`

## Datos

Proyecto de Supabase nuevo, distinto al de Hoylog. Aplica `supabase/migrations` en orden. La anon key es el único secreto del front.

## GitHub Pages

El workflow publica `web/dist` en `/tablero/`. En el environment `github-pages`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Settings → Pages → Source: GitHub Actions.

## MCP

Crea el token en Automatización. En la config del agente:

```json
"tablero": {
  "command": "node",
  "args": ["ruta/a/tablero/mcp/src/index.js"],
  "env": {
    "SUPABASE_URL": "https://<proyecto>.supabase.co",
    "SUPABASE_ANON_KEY": "<anon>",
    "TABLERO_TOKEN": "<token>"
  }
}
```

Tools: `recommend`, `claim`, `report_progress`, `attach_pr`, `release`.
