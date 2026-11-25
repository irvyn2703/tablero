import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { localDateKey, memberName, sprintSpan } from '../lib/format'
import { sprintChoices, versionGroups } from './PlanFields'

const FIELDS = [
  { id: 'assignee', empty: 'Asignar', idle: 'Sin asignar', noun: 'persona', tone: 'is-person' },
  { id: 'version', empty: 'Versión', idle: 'Sin versión', noun: 'versión', tone: 'is-version' },
  { id: 'sprint', empty: 'Sprint', idle: 'Backlog', noun: 'sprint', tone: 'is-sprint' },
]

function fold(value) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function matches(query, ...parts) {
  const needle = fold(query)
  if (!needle) return true
  return parts.some((part) => fold(part).includes(needle))
}

function personGroups(members, query) {
  const items = members
    .map((member) => ({ id: member.user_id, label: memberName(member) }))
    .filter((item) => matches(query, item.label))
  return items.length ? [{ label: '', items }] : []
}

function versionOptions(versions, categories, query) {
  return versionGroups(versions, categories)
    .map((group) => ({
      label: group.label,
      items: group.items
        .map((version) => ({ id: version.id, label: version.name }))
        .filter((item) => matches(query, item.label, group.label)),
    }))
    .filter((group) => group.items.length)
}

function sprintOptions(sprints, selectedId, query) {
  return sprintChoices(sprints, selectedId, localDateKey())
    .map((group) => ({
      label: group.label,
      items: group.sprints
        .map((sprint) => {
          const span = sprintSpan(sprint)
          return { id: sprint.id, label: span ? `${sprint.name} · ${span}` : sprint.name }
        })
        .filter((item) => matches(query, item.label, group.label)),
    }))
    .filter((group) => group.items.length)
}

function optionCount(groups) {
  return groups.reduce((total, group) => total + group.items.length, 0)
}

function holdNextClick() {
  function trap(event) {
    event.preventDefault()
    event.stopPropagation()
  }
  document.addEventListener('pointerdown', trap, true)
  document.addEventListener('click', trap, true)
  window.setTimeout(() => {
    document.removeEventListener('pointerdown', trap, true)
    document.removeEventListener('click', trap, true)
  }, 450)
}

function menuSpot(node) {
  const rect = node.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom
  const above = below < 220 && rect.top > below
  return {
    left: rect.left,
    width: rect.width,
    above,
    top: above ? undefined : rect.bottom - 1,
    bottom: above ? window.innerHeight - rect.top - 1 : undefined,
  }
}

export function CardDispatch({
  editable,
  isChild,
  disabled,
  assigneeId,
  assigneeName,
  members,
  versionId,
  versionName,
  versions,
  versionCategories,
  sprintId,
  sprintName,
  sprints,
  openField,
  onOpen,
  onChange,
}) {
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const [query, setQuery] = useState('')
  const [spot, setSpot] = useState(null)
  const fields = FIELDS.filter((field) => !isChild || field.id === 'assignee')
  const values = {
    assignee: { id: assigneeId || '', name: assigneeName || '' },
    version: { id: versionId || '', name: versionName || '' },
    sprint: { id: sprintId || '', name: sprintName || '' },
  }
  const open = fields.find((field) => field.id === openField) || null

  useEffect(() => {
    setQuery('')
  }, [openField])

  useLayoutEffect(() => {
    if (!open) return undefined
    function place() {
      if (rootRef.current) setSpot(menuSpot(rootRef.current))
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  const menuReady = Boolean(spot)

  useEffect(() => {
    if (!open) {
      setSpot(null)
      return undefined
    }
    if (!menuReady) return undefined
    menuRef.current?.querySelector('input, button')?.focus({ preventScroll: true })
    function onPointer(event) {
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      onOpenRef.current('')
    }
    function onKey(event) {
      if (event.key === 'Escape') onOpenRef.current('')
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, menuReady])

  const groups = !open ? [] : open.id === 'assignee'
    ? personGroups(members, query)
    : open.id === 'version'
      ? versionOptions(versions, versionCategories, query)
      : sprintOptions(sprints, values.sprint.id, query)
  const showFilter = !open ? false : optionCount(
    open.id === 'assignee'
      ? personGroups(members, '')
      : open.id === 'version'
        ? versionOptions(versions, versionCategories, '')
        : sprintOptions(sprints, values.sprint.id, ''),
  ) > 8

  function choose(value) {
    if (!open) return
    holdNextClick()
    onOpen('')
    onChange(open.id, value)
  }

  function onMenuKey(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...(menuRef.current?.querySelectorAll('[data-choice]') || [])]
    const index = items.indexOf(document.activeElement)
    if (index < 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[0]?.focus()
      }
      return
    }
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    items[Math.min(items.length - 1, Math.max(0, next))]?.focus()
  }

  return (
    <div
      className={fields.length === 1 ? 'dispatch is-solo' : 'dispatch'}
      ref={rootRef}
    >
      {fields.map((field) => {
        const value = values[field.id]
        const label = value.name || (editable ? field.empty : field.idle)
        const className = [
          'dispatch-cell',
          value.name ? field.tone : 'is-empty',
          open?.id === field.id ? 'is-open' : '',
        ].filter(Boolean).join(' ')
        if (!editable) {
          return <span className={className} key={field.id}>{label}</span>
        }
        return (
          <button
            className={className}
            type="button"
            key={field.id}
            disabled={disabled}
            aria-expanded={open?.id === field.id}
            aria-label={value.name ? `${field.noun.charAt(0).toLocaleUpperCase('es')}${field.noun.slice(1)}: ${value.name}` : field.empty}
            onClick={() => onOpen(open?.id === field.id ? '' : field.id)}
          >
            {label}
          </button>
        )
      })}
      {open && spot && createPortal(
        <div
          className={spot.above ? 'dispatch-menu is-above' : 'dispatch-menu'}
          ref={menuRef}
          style={{ left: spot.left, width: spot.width, top: spot.top, bottom: spot.bottom }}
          onKeyDown={onMenuKey}
        >
          {showFilter && (
            <input
              value={query}
              placeholder="Filtrar"
              aria-label={`Filtrar ${open.noun}`}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <button
            type="button"
            data-choice=""
            className={values[open.id].id ? '' : 'is-current'}
            onClick={() => choose('')}
          >
            {open.idle}
          </button>
          {groups.map((group) => (
            <div key={group.label || 'people'}>
              {group.label && <p className="dispatch-group">{group.label}</p>}
              {group.items.map((item) => (
                <button
                  type="button"
                  data-choice={item.id}
                  key={item.id}
                  className={item.id === values[open.id].id ? 'is-current' : ''}
                  onClick={() => choose(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
          {query && groups.length === 0 && <p className="dispatch-empty">Nada con ese nombre.</p>}
        </div>,
        document.body,
      )}
    </div>
  )
}
