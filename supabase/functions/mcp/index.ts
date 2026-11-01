const protocol = '2025-03-26'

const instructions = [
  'Lee el estado inicial con inbox. catalog son los repos de la empresa. Cada ticket trae type Ticket o Requerimiento, el reporte en body y los repos ya marcados.',
  'Marca los repos que correspondan con assign_repos, usando los nombres de catalog, antes de sugerir.',
  'Comprueba en el repo si el error existe, o si el requerimiento ya está resuelto.',
  'Guarda la sugerencia con suggest: priority 1 urgente a 4 baja, estimate xs, s, m o l, y autonomy suggest, pull o human.',
  'Si next es abrir pull, reserva con claim, abre la rama con la clave del ticket, crea el pull y regístralo con attach_pr. No lo mezcles.',
  'Si next es solo sugerir, deja la sugerencia y no abras el pull.',
].join(' ')

const tools = [
  {
    name: 'inbox',
    description: 'Lee los tickets del estado inicial y el catálogo de repos de la empresa. catalog son los que se pueden marcar. tickets trae el reporte, si es Ticket o Requerimiento, los repos ya marcados y los nombres de archivos.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'assign_repos',
    description: 'Marca los repos de un ticket que sigue en el estado inicial. repos son nombres de catalog, por ejemplo Finloopmx/Frontend. Una lista vacía los quita. Sustituye los que ya tenía.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', format: 'uuid' },
        repos: { type: 'array', items: { type: 'string' } },
      },
      required: ['ticket_id', 'repos'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest',
    description: 'Guarda prioridad, tamaño y autonomía de un ticket que sigue en el estado inicial. priority va de 1 urgente a 4 baja. estimate es xs, s, m o l. autonomy es suggest, pull o human. La respuesta dice si toca abrir el pull.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', format: 'uuid' },
        priority: { type: 'integer', minimum: 1, maximum: 4 },
        estimate: { type: 'string', enum: ['xs', 's', 'm', 'l'] },
        autonomy: { type: 'string', enum: ['suggest', 'pull', 'human'] },
        note: { type: 'string' },
      },
      required: ['ticket_id', 'priority', 'estimate', 'autonomy'],
      additionalProperties: false,
    },
  },
  {
    name: 'claim',
    description: 'Reserva un ticket de esta empresa por dos horas.',
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'string', format: 'uuid' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_progress',
    description: 'Actualiza el estado o el porcentaje local de un ticket reservado por este token. La nota es interna salvo que public sea true.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', format: 'uuid' },
        status_id: { type: 'string', format: 'uuid' },
        local_percent: { type: 'integer', minimum: 0, maximum: 100 },
        note: { type: 'string' },
        public: { type: 'boolean' },
      },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'attach_pr',
    description: 'Registra la URL del pull request de un ticket reservado. No lo mergea.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', format: 'uuid' },
        url: { type: 'string' },
      },
      required: ['ticket_id', 'url'],
      additionalProperties: false,
    },
  },
  {
    name: 'release',
    description: 'Suelta la reserva de un ticket.',
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'string', format: 'uuid' } },
      required: ['ticket_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'recommend',
    description: 'Recomienda qué ticket atender en toda la cola de trabajo. Para el estado inicial usa inbox.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'MCP-Protocol-Version': protocol },
  })
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function toolResult(id, value, isError = false) {
  return json({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      structuredContent: typeof value === 'string' ? undefined : value,
      isError,
    },
  })
}

function bearer(req) {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : ''
}

async function callRpc(name, args) {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) throw new Error('Falta la configuración de Supabase.')
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo completar.')
  }
  return data
}

function argumentsFor(name, token, args) {
  if (name === 'inbox') return ['agent_inbox', { p_token: token }]
  if (name === 'recommend') return ['agent_recommend', { p_token: token }]
  if (name === 'assign_repos') {
    return ['agent_assign_repos', {
      p_token: token,
      p_ticket_id: args.ticket_id,
      p_repos: args.repos ?? null,
    }]
  }
  if (name === 'suggest') {
    return ['agent_suggest', {
      p_token: token,
      p_ticket_id: args.ticket_id,
      p_priority: args.priority,
      p_estimate: args.estimate,
      p_autonomy: args.autonomy,
      p_note: args.note ?? null,
    }]
  }
  if (name === 'claim') return ['agent_claim', { p_token: token, p_ticket_id: args.ticket_id }]
  if (name === 'release') return ['agent_release', { p_token: token, p_ticket_id: args.ticket_id }]
  if (name === 'attach_pr') return ['agent_attach_pr', { p_token: token, p_ticket_id: args.ticket_id, p_url: args.url }]
  if (name === 'report_progress') {
    return ['agent_report_progress', {
      p_token: token,
      p_ticket_id: args.ticket_id,
      p_status_id: args.status_id ?? null,
      p_local: args.local_percent ?? null,
      p_note: args.note ?? null,
      p_public: args.public ?? false,
    }]
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(rpcError(null, -32600, 'Usa POST.'), 405)

  let request
  try {
    request = await req.json()
  } catch {
    return json(rpcError(null, -32700, 'JSON inválido.'), 400)
  }
  if (Array.isArray(request) || request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return json(rpcError(request?.id ?? null, -32600, 'Solicitud JSON-RPC inválida.'), 400)
  }

  const { id, method, params = {} } = request
  const token = bearer(req)
  if (!token) return json(rpcError(id, -32001, 'Falta el token del agente.'), 401)

  try {
    await callRpc('agent_session', { p_token: token })
  } catch (error) {
    return json(rpcError(id, -32001, error.message || 'Token no válido.'), 401)
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return new Response(null, { status: 202, headers: cors })
  }
  if (method === 'initialize') {
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: protocol,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tablero', version: '0.2.0' },
        instructions,
      },
    })
  }
  if (method === 'ping') return json({ jsonrpc: '2.0', id, result: {} })
  if (method === 'tools/list') return json({ jsonrpc: '2.0', id, result: { tools } })
  if (method !== 'tools/call') return json(rpcError(id, -32601, 'Método MCP no encontrado.'))

  const call = argumentsFor(params.name, token, params.arguments || {})
  if (!call) return toolResult(id, 'Herramienta no encontrada.', true)
  try {
    return toolResult(id, await callRpc(call[0], call[1]))
  } catch (error) {
    return toolResult(id, error.message || 'No se pudo completar.', true)
  }
})
