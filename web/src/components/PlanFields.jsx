import { localDateKey, sprintSpan } from '../lib/format'

function sprintChoices(sprints, selectedId, today) {
  const current = []
  const upcoming = []
  const previous = []
  for (const sprint of sprints) {
    const start = String(sprint.starts_on || '')
    const end = String(sprint.ends_on || '')
    if (start && end && start <= today && end >= today) current.push(sprint)
    else if (start && start > today) upcoming.push(sprint)
    else if (sprint.id === selectedId) previous.push(sprint)
  }
  return [
    current.length ? { label: 'En curso', sprints: current } : null,
    upcoming.length ? { label: 'Próximos', sprints: upcoming } : null,
    previous.length ? { label: 'Anterior', sprints: previous } : null,
  ].filter(Boolean)
}

function versionGroups(versions, categories) {
  return [
    ...categories.map((category) => ({
      key: category.id,
      label: category.name,
      items: versions.filter((version) => version.category_id === category.id),
    })),
    {
      key: 'none',
      label: 'Sin categoría',
      items: versions.filter((version) => !version.category_id),
    },
  ].filter((group) => group.items.length)
}

export function SprintField({ sprints, value, keepId, disabled, onChange }) {
  return (
    <label className="field">
      <span>Sprint</span>
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Backlog</option>
        {sprintChoices(sprints, keepId || value, localDateKey()).map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.sprints.map((sprint) => {
              const span = sprintSpan(sprint)
              return (
                <option key={sprint.id} value={sprint.id}>
                  {span ? `${sprint.name} · ${span}` : sprint.name}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

export function VersionField({ versions, categories, value, disabled, onChange }) {
  return (
    <label className="field">
      <span>Versión</span>
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Sin versión</option>
        {versionGroups(versions, categories).map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.items.map((version) => (
              <option key={version.id} value={version.id}>{version.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
