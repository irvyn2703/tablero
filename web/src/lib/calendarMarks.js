const STATUS_CHANGE = /^(.*) · (\d+(?:\.\d+)?)%$/

export function parseStatusChange(body) {
  const match = String(body || '').match(STATUS_CHANGE)
  if (!match) return null
  return { status: match[1], percent: Number(match[2]) }
}

export function marksByDay(tickets, events, dayKey) {
  const ticketsById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const latest = new Map()
  events.forEach((event) => {
    const parsed = parseStatusChange(event.body)
    if (!parsed) return
    const ticket = ticketsById.get(event.ticket_id)
    if (!ticket) return
    const day = dayKey(new Date(event.created_at))
    latest.set(`${ticket.id}|${day}`, {
      ...ticket,
      day,
      statusName: parsed.status,
      percent: parsed.percent,
    })
  })
  const map = new Map()
  latest.forEach((mark) => {
    map.set(mark.day, [...(map.get(mark.day) ?? []), mark])
  })
  return map
}
