import { useState } from 'react'
import { formatWhen } from '../lib/format'
import { ActionButton, Done } from './ui'

const missingStatus = 'Falta información'

function placeholderFor(statusName, fromReporter) {
  if (statusName !== missingStatus) return 'Escribe un mensaje'
  return fromReporter ? 'Escribe el dato' : 'Qué dato falta'
}

export function Thread({ messages, canWrite, statusName, fromReporter = false, reporterLabel, busy, mark, done, onSend }) {
  const [text, setText] = useState('')

  async function submit(event) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    const ok = await onSend(body)
    if (ok !== false) setText('')
  }

  return (
    <section className="thread-block">
      <h2>Mensajes</h2>
      {messages.length === 0 ? (
        <p className="quiet">Todavía no hay mensajes.</p>
      ) : (
        <ol className="thread">
          {messages.map((message) => (
            <li key={message.id} className={message.side === 'reporte' ? 'is-reporter' : undefined}>
              <div className="who">
                <span>{message.side === 'reporte' ? reporterLabel : (message.name || 'Equipo')}</span>
                <time>{formatWhen(message.at)}</time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form onSubmit={submit}>
          <label className="field">
            <span>Mensaje</span>
            <textarea
              className="short"
              maxLength={800}
              value={text}
              required
              placeholder={placeholderFor(statusName, fromReporter)}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <ActionButton name="message" busy={busy} pending="Enviando…" className="btn" type="submit" style={{ marginTop: '0.7rem' }}>
            Enviar
          </ActionButton>
          <Done name="message" mark={mark}>{done}</Done>
        </form>
      )}
    </section>
  )
}
