import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canEdit, laneVars, messageFrom, ticketKey } from '../lib/format'
import { Alert, Done, Progress, useFeedback } from '../components/ui'

export function Board() {
  const { company, role } = useOutletContext()
  const editable = canEdit(role)
  const { companyId } = useParams()
  const [statuses, setStatuses] = useState([])
  const [tickets, setTickets] = useState([])
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [statusRes, ticketRes] = await Promise.all([
      supabase.from('statuses').select('id, name, kind, position, weight, color').eq('company_id', companyId).order('position'),
      supabase.from('ticket_rows').select('id, public_number, title, status_id, progress, local_percent').eq('company_id', companyId).order('public_number', { ascending: false }),
    ])
    if (statusRes.error || ticketRes.error) {
      setError(messageFrom(statusRes.error || ticketRes.error))
      return
    }
    setStatuses(statusRes.data ?? [])
    setTickets(ticketRes.data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  function move(ticketId, statusId) {
    return run('move', async () => {
      setError('')
      const { error: moveError } = await supabase.rpc('set_ticket_progress', {
        p_ticket_id: ticketId,
        p_status_id: statusId,
        p_local: null,
      })
      if (moveError) {
        setError(messageFrom(moveError))
        return false
      }
      load()
    }, 'Ticket movido.')
  }

  return (
    <section className="page">
      <div className="row">
        <div>
          <p className="kicker">{company.slug}</p>
          <h1>{company.name}</h1>
        </div>
        {editable && <Link className="btn" to="nuevo">Nuevo ticket</Link>}
      </div>
      <Alert>{error}</Alert>
      {busy === 'move' && <p className="done" role="status">Moviendo el ticket…</p>}
      <Done name={mark} mark={mark}>{done}</Done>
      <div className="board">
        {statuses.map((status) => (
          <section className="column" style={laneVars(status.color)} key={status.id}>
            <header>
              <strong>{status.name}</strong>
              <span className="quiet">{status.kind === 'work' ? `${status.weight}%` : status.kind === 'close' ? 'Cierre' : 'Pausa'}</span>
            </header>
            {tickets.filter((ticket) => ticket.status_id === status.id).map((ticket) => (
              <article className="card" key={ticket.id}>
                <Link to={`t/${ticket.id}`}>
                  <em>{ticketKey(company.ticket_prefix, ticket.public_number)}</em>
                  <p>{ticket.title}</p>
                  <Progress value={ticket.progress} />
                </Link>
                {editable && (
                  <label className="field" style={{ marginTop: '0.7rem' }}>
                    <span>Pasar a</span>
                    <select
                      value={ticket.status_id}
                      disabled={Boolean(busy)}
                      aria-busy={busy === 'move' || undefined}
                      onChange={(event) => move(ticket.id, event.target.value)}
                    >
                      {statuses.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </section>
  )
}
