import { supabase } from './supabase'
import { messageFrom } from './format'

export const fileLimit = 8
export const fileBytes = 10 * 1024 * 1024
const allowed = /\.(jpe?g|png|gif|webp|xls|xlsx|doc|docx|html?)$/i

export function fileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function takeFiles(current, incoming) {
  const next = [...current]
  let error = ''
  for (const file of incoming) {
    if (next.length >= fileLimit) {
      error = 'Son hasta 8 archivos.'
      break
    }
    if (!allowed.test(file.name) || file.name.includes('/') || file.name.includes('\\')) {
      error = 'Solo imágenes, Excel, Word o HTML.'
      continue
    }
    if (file.size > fileBytes) {
      error = `${file.name} pasa de 10 MB.`
      continue
    }
    if (file.size < 1) {
      error = `${file.name} está vacío.`
      continue
    }
    next.push(file)
  }
  return { files: next, error }
}

function uploadMessage(error) {
  const text = messageFrom(error)
  if (/mime/i.test(text)) return 'Ese tipo de archivo no se puede subir.'
  if (/size|maximum|payload/i.test(text)) return 'El archivo pasa de 10 MB.'
  return text
}

export async function uploadTicketFiles({ ticketId, viewToken, files }) {
  const failed = []
  for (const file of files) {
    const reserved = viewToken
      ? await supabase.rpc('reserve_intake_file', { p_token: viewToken, p_name: file.name, p_bytes: file.size })
      : await supabase.rpc('reserve_ticket_file', { p_ticket_id: ticketId, p_name: file.name, p_bytes: file.size })
    if (reserved.error) {
      failed.push({ file, error: uploadMessage(reserved.error) })
      continue
    }
    const uploaded = await supabase.storage.from('ticket-files').upload(reserved.data.path, file, {
      contentType: reserved.data.mime,
      upsert: false,
    })
    if (uploaded.error) {
      failed.push({ file, error: uploadMessage(uploaded.error) })
      continue
    }
    const confirmed = viewToken
      ? await supabase.rpc('confirm_intake_file', { p_token: viewToken, p_file_id: reserved.data.id })
      : await supabase.rpc('confirm_ticket_file', { p_file_id: reserved.data.id })
    if (confirmed.error) failed.push({ file, error: uploadMessage(confirmed.error) })
  }
  return failed
}

const filesLeft = new Map()

export async function discardTicket(ticketId, label) {
  if (!filesLeft.has(ticketId)) {
    if (!window.confirm(`Se elimina ${label}. Ese número no se vuelve a usar.`)) return { cancelled: true }
    const { data, error } = await supabase.rpc('delete_ticket', { p_ticket_id: ticketId })
    if (error) return { error }
    filesLeft.set(ticketId, data ?? [])
  }
  const removed = await removeStoredFiles(filesLeft.get(ticketId))
  if (removed.error) {
    return { error: { message: 'El ticket ya no está. Sus archivos no se pudieron quitar. Inténtalo otra vez.' } }
  }
  filesLeft.delete(ticketId)
  return {}
}

export async function removeStoredFiles(paths) {
  const list = (paths ?? []).filter(Boolean)
  if (!list.length) return { error: null }
  const removed = await supabase.storage.from('ticket-files').remove(list)
  return { error: removed.error || null }
}

export async function openTicketFile(file) {
  const image = String(file.mime || '').startsWith('image/')
  const { data, error } = await supabase.storage.from('ticket-files').createSignedUrl(
    file.object_path,
    120,
    image ? undefined : { download: file.name },
  )
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
}
