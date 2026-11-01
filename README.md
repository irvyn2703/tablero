# Tablero

Empresas, tickets con avance y sprints. El front es estático. Supabase guarda los datos. El agente se conecta al endpoint, lee el estado inicial y adjunta el pull; no lo mergea.

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

Crea el token en Automatización. La pantalla muestra la config para Cursor: la URL del endpoint y el token. El agente lee el estado inicial, marca los repos, guarda prioridad, tamaño y autonomía, y abre el pull solo si la política lo permite.

Tools: `inbox`, `assign_repos`, `suggest`, `claim`, `report_progress`, `attach_pr`, `release`, `recommend`.
