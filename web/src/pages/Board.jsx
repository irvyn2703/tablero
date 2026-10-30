import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert, Progress, Secret } from '../components/ui'

export function Board() {
  const { company } = useOutletContext()
  const { companyId } = useParams()
  const [statuses, setStatuses] = useState([])
  const [tickets, setTickets] = useState([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const [statusRes, ticketRes] = await Promise.all([
      supabase.from('statuses').select('id, name, kind, position, weight').eq('company_id', companyId).order('position'),
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

  async function createTicket(event) {
    event.preventDefault()
    setError('')
    const { data, error: createError } = await supabase.rpc('create_ticket', {
      p_company_id: companyId,
      p_title: title,
      p_body: body,
    })
    if (createError) {
      setError(messageFrom(createError))
      return
    }
    setTitle('')
    setBody('')
    setSecret(absolutePath(`/t/${data.viewToken}`))
    load()
  }

  async function move(ticketId, statusId) {
    setError('')
    const { error: moveError } = await supabase.rpc('set_ticket_progress', {
      p_ticket_id: ticketId,
      p_status_id: statusId,
      p_local: null,
    })
    if (moveError) setError(messageFrom(moveError))
    else load()
  }

  return (
    <section className="page">
      <div className="row">
        <div>
          <p className="kicker">{company.slug}</p>
          <h1>{company.name}</h1>
        </div>
      </div>
      <Alert>{error}</Alert>
      <Secret label="Liga de seguimiento" value={secret} />
      <form className="panel" onSubmit={createTicket} style={{ marginBottom: '1.2rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>Nuevo ticket</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="field">
            <span>Detalle</span>
            <input value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        </div>
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Registrar</button>
      </form>
      <div className="board">
        {statuses.map((status) => (
          <section className="column" key={status.id}>
            <header>
              <strong>{status.name}</strong>
              <span className="quiet">{status.kind === 'work' ? `${status.weight}%` : status.kind === 'close' ? 'Cierre' : 'Pausa'}</span>
            </header>
            {tickets.filter((ticket) => ticket.status_id === status.id).map((ticket) => (
              <article className="card" key={ticket.id}>
                <Link to={`t/${ticket.id}`}>
                  <em>#{ticket.public_number}</em>
                  <p>{ticket.title}</p>
                  <Progress value={ticket.progress} />
                </Link>
                <label className="field" style={{ marginTop: '0.7rem' }}>
                  <span>Pasar a</span>
                  <select
                    value={ticket.status_id}
                    onChange={(event) => move(ticket.id, event.target.value)}
                  >
                    {statuses.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </section>
        ))}
      </div>
    </section>
  )
}
