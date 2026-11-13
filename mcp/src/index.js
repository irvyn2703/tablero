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
const server = new McpServer({
  name: 'tablero',
  version: '0.1.0',
  instructions: [
    'Cuando te pidan revisar tickets, lee con inbox el estado que nombren. Si no nombran uno, inbox trae el primero del flujo.',
    'Antes de decidir, search con palabras del título para ver si ya existe. Si otro ticket abierto describe lo mismo, dilo en la nota y deja autonomy en human.',
    'Comprueba en el repo si el error existe, o si el requerimiento ya está resuelto.',
    'Marca los repos con assign_repos y la complejidad con suggest. Si el nombre se repite, indícalo como org/repo|fromBranch|pullBranch.',
    'Si next es abrir pull, reserva con claim. La rama nace de fromBranch y el pull apunta a pullBranch: abre la rama con la clave desde fromBranch y crea el pull hacia pullBranch. Regístralo con attach_pr y al final pasa thermos. No lo mezcles.',
    'Si next es solo sugerir, no abras el pull.',
    'Cuando termines, claim si no lo reservaste y move el ticket al estado que te pidan. Si dicen asignación de prioridad, el estado es asignación de prioridad. Después release.',
    'Para registrar un ticket usa create_ticket. El título es obligatorio. Lo demás es opcional y usa los mismos nombres de la ficha: kind ticket o request, priority, estimate, autonomy, assignee por alias, status, sprint y version por nombre, categories y repos por nombre.',
  ].join(' '),
})

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
  'create_ticket',
  'Registra un ticket con la ficha del dev. title es obligatorio. kind es ticket o request. priority va de 1 urgente a 4 baja. estimate es xs, s, m o l. autonomy es suggest, pull o human. assignee es el alias. status, sprint, version, categories y repos son nombres. Si un repo se repite, indícalo como org/repo|fromBranch|pullBranch. Si omites uno, queda el valor de un ticket nuevo.',
  {
    title: z.string(),
    body: z.string().optional(),
    kind: z.enum(['ticket', 'request']).optional(),
    priority: z.number().int().min(1).max(4).optional(),
    estimate: z.enum(['xs', 's', 'm', 'l']).optional(),
    autonomy: z.enum(['suggest', 'pull', 'human']).optional(),
    assignee: z.string().optional(),
    status: z.string().optional(),
    sprint: z.string().optional(),
    version: z.string().optional(),
    categories: z.array(z.string()).optional(),
    repos: z.array(z.string()).optional(),
  },
  async (args) => call('agent_create_ticket', {
    p_title: args.title,
    p_body: args.body ?? null,
    p_kind: args.kind ?? null,
    p_priority: args.priority ?? null,
    p_estimate: args.estimate ?? null,
    p_autonomy: args.autonomy ?? null,
    p_assignee: args.assignee ?? null,
    p_status: args.status ?? null,
    p_sprint: args.sprint ?? null,
    p_version: args.version ?? null,
    p_categories: args.categories ?? null,
    p_repos: args.repos ?? null,
  }),
)

server.tool(
  'inbox',
  'Lee los tickets de un estado y el catálogo de repos de la empresa. status es el nombre o un pedazo, por ejemplo revisión o asignación de prioridad. Si lo omites, lee el primero del flujo. Cada repo trae fromBranch, de donde nace la rama, y pullBranch, a donde apunta el pull.',
  { status: z.string().optional() },
  async ({ status }) => call('agent_inbox', { p_status: status ?? null }),
)

server.tool(
  'search',
  'Busca tickets parecidos por palabras del título o del reporte, en cualquier estado. Sirve para ver si el error ya está repetido.',
  { query: z.string() },
  async ({ query }) => call('agent_search', { p_query: query }),
)

server.tool(
  'assign_repos',
  'Marca los repos de un ticket que sigue en trabajo. repos son nombres de catalog, por ejemplo Finloopmx/Frontend. Si el nombre se repite, indícalo como org/repo|fromBranch|pullBranch. Una lista vacía los quita. Sustituye los que ya tenía.',
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
  'Guarda prioridad, tamaño y autonomía de un ticket que sigue en trabajo. priority va de 1 urgente a 4 baja. estimate es xs, s, m o l. autonomy es suggest, pull o human. Si la respuesta dice abrir pull, la rama nace de fromBranch y el pull apunta a pullBranch: resérvalo, abre la rama con su clave desde fromBranch, crea el pull hacia pullBranch, regístralo y al final pasa thermos. Si dice solo sugerir, no abras el pull.',
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
  'Recomienda qué ticket atender en toda la cola de trabajo. Para el estado inicial usa inbox. key es el nombre de la rama. El ticket puede traer varios repos. Si el primero dice ejecutar, la rama nace de fromBranch y el pull apunta a pullBranch. Si dice sugerir, solo proponlo.',
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
  'move',
  'Pasa un ticket reservado al estado que nombren. status es el nombre o un pedazo, por ejemplo asignación de prioridad.',
  {
    ticket_id: z.string().uuid(),
    status: z.string(),
  },
  async ({ ticket_id, status }) => call('agent_move', {
    p_ticket_id: ticket_id,
    p_status: status,
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
