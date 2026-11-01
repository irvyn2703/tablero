#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY
const token = process.env.TABLERO_TOKEN

if (!url || !key) {
  console.error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)
const server = new McpServer({ name: 'tablero', version: '0.1.0' })

function denied() {
  if (!token || token.startsWith('PEGA_')) {
    return {
      content: [{ type: 'text', text: 'Falta TABLERO_TOKEN. Créalo en Automatización y pégalo en la config.' }],
      isError: true,
    }
  }
  return null
}

async function call(fn, args) {
  const problem = denied()
  if (problem) return problem
  const { data, error } = await supabase.rpc(fn, { p_token: token, ...args })
  if (error) return { content: [{ type: 'text', text: error.message }], isError: true }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

server.tool(
  'inbox',
  'Lee los tickets del estado inicial y el catálogo de repos de la empresa. catalog son los que se pueden marcar. tickets trae el reporte, si es Ticket o Requerimiento, los repos ya marcados y los nombres de archivos.',
  {},
  async () => call('agent_inbox', {}),
)

server.tool(
  'assign_repos',
  'Marca los repos de un ticket que sigue en el estado inicial. repos son nombres de catalog, por ejemplo Finloopmx/Frontend. Una lista vacía los quita. Sustituye los que ya tenía.',
  {
    ticket_id: z.string().uuid(),
    repos: z.array(z.string()),
  },
  async ({ ticket_id, repos }) => call('agent_assign_repos', {
    p_ticket_id: ticket_id,
    p_repos: repos,
  }),
)

server.tool(
  'suggest',
  'Guarda prioridad, tamaño y autonomía de un ticket que sigue en el estado inicial. priority va de 1 urgente a 4 baja. estimate es xs, s, m o l. autonomy es suggest, pull o human. Si la respuesta dice abrir pull, resérvalo, abre la rama con su clave y registra el pull. Si dice solo sugerir, no abras el pull.',
  {
    ticket_id: z.string().uuid(),
    priority: z.number().int().min(1).max(4),
    estimate: z.enum(['xs', 's', 'm', 'l']),
    autonomy: z.enum(['suggest', 'pull', 'human']),
    note: z.string().optional(),
  },
  async ({ ticket_id, priority, estimate, autonomy, note }) => call('agent_suggest', {
    p_ticket_id: ticket_id,
    p_priority: priority,
    p_estimate: estimate,
    p_autonomy: autonomy,
    p_note: note ?? null,
  }),
)

server.tool(
  'recommend',
  'Recomienda qué ticket atender en toda la cola de trabajo. Para el estado inicial usa inbox. key es el nombre de la rama. El ticket puede traer varios repos. Si el primero dice ejecutar, puedes tomarlo y abrir un pull en cada repo. Si dice sugerir, solo proponlo.',
  {},
  async () => call('agent_recommend', {}),
)

server.tool(
  'claim',
  'Reserva un ticket de esta empresa por dos horas.',
  { ticket_id: z.string().uuid() },
  async ({ ticket_id }) => call('agent_claim', { p_ticket_id: ticket_id }),
)

server.tool(
  'report_progress',
  'Actualiza el estado o el porcentaje local de un ticket reservado por este token. La nota es interna salvo que public sea true.',
  {
    ticket_id: z.string().uuid(),
    status_id: z.string().uuid().optional(),
    local_percent: z.number().int().min(0).max(100).optional(),
    note: z.string().optional(),
    public: z.boolean().optional(),
  },
  async ({ ticket_id, status_id, local_percent, note, public: isPublic }) => call('agent_report_progress', {
    p_ticket_id: ticket_id,
    p_status_id: status_id ?? null,
    p_local: local_percent ?? null,
    p_note: note ?? null,
    p_public: isPublic ?? false,
  }),
)

server.tool(
  'attach_pr',
  'Registra la URL del pull request de un ticket reservado. No lo mergea.',
  {
    ticket_id: z.string().uuid(),
    url: z.string().url(),
  },
  async ({ ticket_id, url: pullUrl }) => call('agent_attach_pr', {
    p_ticket_id: ticket_id,
    p_url: pullUrl,
  }),
)

server.tool(
  'release',
  'Suelta la reserva de un ticket.',
  { ticket_id: z.string().uuid() },
  async ({ ticket_id }) => call('agent_release', { p_ticket_id: ticket_id }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
