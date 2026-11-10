import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { configured, supabase } from '../lib/supabase'
import { formatWhen, messageFrom } from '../lib/format'
import { Thread } from '../components/Thread'
import { Alert, Progress, useFeedback } from '../components/ui'

function queueLine(ticket) {
  if (typeof ticket.ahead !== 'number') return ''
  if (ticket.ahead === 0) return 'Es el primero de este estado.'
  const noun = ticket.ahead === 1 ? 'ticket' : 'tickets'
  return `Ahora hay ${ticket.ahead} ${noun} antes que el tuyo en este estado.`
}

export function Track() {
  const { token } = useParams()
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    if (!supabase) return
    const { data, error: readError } = await supabase.rpc('read_public_ticket', { p_token: token })
    if (readError) setError(messageFrom(readError))
    else {
      setError('')
      setTicket(data)
    }
  }

  useEffect(() => { load() }, [token])

  function sendMessage(body) {
    return run('message', async () => {
      setError('')
      const { error: sendError } = await supabase.rpc('post_public_message', {
        p_token: token,
        p_body: body,
      })
      if (sendError) {
        setError(messageFrom(sendError))
        return false
      }
      load()
    }, 'Mensaje enviado.')
  }

  const line = ticket ? queueLine(ticket) : ''

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">{ticket?.companyName || 'Tablero'}</p>
      <h1>{ticket ? ticket.title : 'Seguimiento'}</h1>
      <Alert>{error}</Alert>
      {ticket && (
        <>
          <p className="quiet">{ticket.key || `#${ticket.number}`} · {ticket.status}</p>
          <Progress value={ticket.progress} />
          {line && <p className="quiet">{line}</p>}
          <Thread
            messages={ticket.messages ?? []}
            canWrite
            reporterLabel="Tú"
            statusName={ticket.status}
            fromReporter
            busy={busy}
            mark={mark}
            done={done}
            onSend={sendMessage}
          />
          <h2>Proceso</h2>
          <ol className="timeline">
            {ticket.events.map((event) => (
              <li key={event.at}>
                <span className="quiet">{formatWhen(event.at)}</span>
                <div>{event.body}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  )
}
