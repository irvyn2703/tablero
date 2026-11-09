export function formatProgress(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatWhen(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export const priorityLabel = {
  1: 'Urgente',
  2: 'Alta',
  3: 'Normal',
  4: 'Baja',
}

export const estimateLabel = {
  xs: 'Muy simple',
  s: 'Simple',
  m: 'Mediano',
  l: 'Grande',
}

export const autonomyLabel = {
  suggest: 'Sugerir',
  pull: 'Abrir pull',
  human: 'Solo humano',
}

export function memberName(member) {
  const alias = String(member?.alias || '').trim()
  return alias || 'Sin nombre'
}

export const roleLabel = {
  owner: 'Dueño',
  admin: 'Admin',
  dev: 'Dev',
  observer: 'Observador',
}

export function canEdit(role) {
  return role === 'owner' || role === 'admin' || role === 'dev'
}

export function isAdmin(role) {
  return role === 'owner' || role === 'admin'
}

export const ticketKinds = [
  { id: 'ticket', name: 'Ticket', hint: 'Un error' },
  { id: 'request', name: 'Requerimiento', hint: 'Una mejora o una idea' },
]

export function kindName(id) {
  return ticketKinds.find((kind) => kind.id === id)?.name || 'Ticket'
}

export function ticketKey(prefix, number) {
  const clean = String(prefix || '').trim().toUpperCase()
  return clean ? `${clean}-${number}` : `#${number}`
}

const darkInk = '#1c1915'
const lightInk = '#f7f4ee'
const mutedInk = '#5e584f'
const minContrast = 4.5

export function hexColor(value) {
  const text = String(value || '').trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(text) ? text : '#1c3d34'
}

function luminance(hex) {
  const line = (start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * line(1) + 0.7152 * line(3) + 0.0722 * line(5)
}

function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

export function inkOn(value) {
  const background = luminance(hexColor(value))
  const onDark = contrast(background, luminance(darkInk))
  const onLight = contrast(background, luminance(lightInk))
  return onDark >= onLight ? darkInk : lightInk
}

export function laneVars(value) {
  const background = hexColor(value)
  return { '--lane': background, '--lane-ink': inkOn(background) }
}

export const builtInPine = '#1c3d34'
export const builtInBrass = '#8d6b3a'
export const builtInPaper = '#f4f1ea'

export function paperReads(value) {
  const paper = String(value || '').trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(paper)) return false
  const background = luminance(paper)
  return contrast(background, luminance(darkInk)) >= minContrast
    && contrast(background, luminance(mutedInk)) >= minContrast
}

export function brandVars(company) {
  const style = {}
  const pine = String(company?.brand_color || '').trim().toLowerCase()
  const brass = String(company?.accent_color || '').trim().toLowerCase()
  const paper = String(company?.background_color || '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(pine)) {
    style['--pine'] = pine
    style['--pine-soft'] = `color-mix(in srgb, ${pine} 14%, var(--paper))`
    style['--on-pine'] = inkOn(pine)
  }
  if (/^#[0-9a-f]{6}$/.test(brass)) {
    style['--brass'] = brass
  }
  if (paperReads(paper)) {
    style['--paper'] = paper
    style['--paper-deep'] = `color-mix(in srgb, ${paper} 82%, ${darkInk})`
  }
  return style
}

export function messageFrom(error) {
  if (!error) return 'No se pudo completar.'
  const text = error.message || String(error)
  return text.replace(/^.*ERROR:\s*/i, '').replace(/\s+$/, '')
}

const monthName = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year: Number(match[1]), month, day }
}

export function sprintSpan(sprint) {
  const start = dateParts(sprint?.starts_on)
  const end = dateParts(sprint?.ends_on)
  if (!start || !end) return ''
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${monthName[end.month - 1]}`
  }
  if (start.year === end.year) {
    return `${start.day} ${monthName[start.month - 1]}–${end.day} ${monthName[end.month - 1]}`
  }
  return `${start.day} ${monthName[start.month - 1]} ${start.year}–${end.day} ${monthName[end.month - 1]} ${end.year}`
}

