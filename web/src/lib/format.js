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

export function ticketKey(prefix, number) {
  const clean = String(prefix || '').trim().toUpperCase()
  return clean ? `${clean}-${number}` : `#${number}`
}

const darkInk = '#1c1915'
const lightInk = '#f7f4ee'

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

export function messageFrom(error) {
  if (!error) return 'No se pudo completar.'
  const text = error.message || String(error)
  return text.replace(/^.*ERROR:\s*/i, '').replace(/\s+$/, '')
}
