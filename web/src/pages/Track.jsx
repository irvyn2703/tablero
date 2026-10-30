import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { configured, supabase } from '../lib/supabase'
import { formatWhen, messageFrom } from '../lib/format'
import { Alert, Progress } from '../components/ui'

export function Track() {
  const { token } = useParams()
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.rpc('read_public_ticket', { p_token: token }).then(({ data, error: readError }) => {
      if (readError) setError(messageFrom(readError))
      else setTicket(data)
    })
  }, [token])

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
