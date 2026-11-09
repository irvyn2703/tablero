const sizeWord = {
  l: ['grande', 'grandes'],
  m: ['mediano', 'medianos'],
  s: ['simple', 'simples'],
  xs: ['muy simple', 'muy simples'],
}

export function sizeLine(estimates) {
  const counts = new Map()
  for (const estimate of estimates) {
    if (!sizeWord[estimate]) continue
    counts.set(estimate, (counts.get(estimate) || 0) + 1)
  }
  return ['l', 'm', 's', 'xs'].flatMap((estimate) => {
    const count = counts.get(estimate)
    if (!count) return []
    return [`${count} ${sizeWord[estimate][count === 1 ? 0 : 1]}`]
  }).join(' · ')
}

export function bucketStays(stays, ticketsById) {
  const groups = { open: [], done: [], carried: [] }
  for (const stay of stays) {
    const ticket = ticketsById.get(stay.ticket_id)
    if (!ticket || !groups[stay.outcome]) continue
    groups[stay.outcome].push(ticket)
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.public_number - b.public_number)
  }
  return groups
}

export function objectiveLanes(sprints, objectives, weekStart, weekEnd) {
  const visible = sprints.filter((sprint) => sprint.starts_on <= weekEnd && sprint.ends_on >= weekStart)
  const lanes = []
  const byKey = new Map()
  for (const sprint of visible) {
    const key = sprint.objective_id || sprint.id
    let lane = byKey.get(key)
    if (!lane) {
      lane = {
        key,
        objective: objectives.find((item) => item.id === sprint.objective_id) || null,
        sprints: [],
      }
      byKey.set(key, lane)
      lanes.push(lane)
    }
    lane.sprints.push(sprint)
  }
  return lanes
}
