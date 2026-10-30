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

export function messageFrom(error) {
  if (!error) return 'No se pudo completar.'
  const text = error.message || String(error)
  return text.replace(/^.*ERROR:\s*/i, '').replace(/\s+$/, '')
}
