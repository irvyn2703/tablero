import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { autonomyLabel, estimateLabel, formatWhen, messageFrom, priorityLabel } from '../lib/format'
import { Alert, Progress } from '../components/ui'

export function Ticket() {
  const { companyId, ticketId } = useParams()
  const { company } = useOutletContext()
  const [ticket, setTicket] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [members, setMembers] = useState([])
  const [sprints, setSprints] = useState([])
  const [repos, setRepos] = useState([])
  const [events, setEvents] = useState([])
  const [pulls, setPulls] = useState([])
  const [error, setError] = useState('')

  async function load() {
    const [ticketRes, statusRes, memberRes, sprintRes, repoRes, eventRes, pullRes] = await Promise.all([
      supabase.from('ticket_rows').select('*').eq('id', ticketId).maybeSingle(),
      supabase.from('statuses').select('id, name').eq('company_id', companyId).order('position'),
      supabase.from('company_members').select('user_id, email').eq('company_id', companyId),
      supabase.from('sprints').select('id, name').eq('company_id', companyId).order('starts_on'),
      supabase.from('repos').select('id, github_full_name').eq('company_id', companyId),
      supabase.from('ticket_events').select('id, body, visibility, created_at').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('pull_requests').select('id, url, created_at').eq('ticket_id', ticketId).order('created_at'),
    ])
    const failed = [ticketRes, statusRes, memberRes, sprintRes, repoRes, eventRes, pullRes].find((item) => item.error)
    if (failed) {
      setError(messageFrom(failed.error))
      return
    }
    setTicket(ticketRes.data)
    setStatuses(statusRes.data ?? [])
    setMembers(memberRes.data ?? [])
    setSprints(sprintRes.data ?? [])
    setRepos(repoRes.data ?? [])
    setEvents(eventRes.data ?? [])
    setPulls(pullRes.data ?? [])
  }

  useEffect(() => { load() }, [ticketId, companyId])

  function patch(partial) {
    setTicket((current) => ({ ...current, ...partial }))
  }

  async function saveFields(event) {
    event.preventDefault()
    setError('')
    const { error: updateError } = await supabase.from('tickets').update({
      title: ticket.title,
      body: ticket.body,
      priority: Number(ticket.priority),
      estimate: ticket.estimate,
      autonomy: ticket.autonomy,
      assignee_id: ticket.assignee_id || null,
      sprint_id: ticket.sprint_id || null,
      repo_id: ticket.repo_id || null,
    }).eq('id', ticketId)
    if (updateError) setError(messageFrom(updateError))
  }

  async function saveProgress(event) {
    event.preventDefault()
    setError('')
    const { error: progressError } = await supabase.rpc('set_ticket_progress', {
      p_ticket_id: ticketId,
      p_status_id: ticket.status_id,
      p_local: Number(ticket.local_percent),
    })
    if (progressError) setError(messageFrom(progressError))
    else load()
  }

  if (!ticket) {
    return (
      <section className="page">
        <Alert>{error}</Alert>
        {!error && <p className="quiet">Un momento.</p>}
      </section>
    )
  }

  return (
    <section className="page">
      <p className="kicker"><Link to={`/e/${companyId}`}>{company.name}</Link></p>
      <div className="row">
        <h1>#{ticket.public_number} {ticket.title}</h1>
      </div>
      <Progress value={ticket.progress} />
      <Alert>{error}</Alert>
      <form onSubmit={saveFields} className="panel" style={{ marginTop: '1rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>Título</span>
            <input value={ticket.title} onChange={(event) => patch({ title: event.target.value })} required />
          </label>
          <label className="field">
            <span>Prioridad</span>
            <select value={ticket.priority} onChange={(event) => patch({ priority: event.target.value })}>
              {Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Tamaño</span>
            <select value={ticket.estimate} onChange={(event) => patch({ estimate: event.target.value })}>
              {Object.entries(estimateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Autonomía</span>
            <select value={ticket.autonomy} onChange={(event) => patch({ autonomy: event.target.value })}>
              {Object.entries(autonomyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Asignado</span>
            <select value={ticket.assignee_id || ''} onChange={(event) => patch({ assignee_id: event.target.value })}>
              <option value="">Sin asignar</option>
              {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Sprint</span>
            <select value={ticket.sprint_id || ''} onChange={(event) => patch({ sprint_id: event.target.value })}>
              <option value="">Backlog</option>
              {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Repo</span>
            <select value={ticket.repo_id || ''} onChange={(event) => patch({ repo_id: event.target.value })}>
              <option value="">Sin repo</option>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.github_full_name}</option>)}
            </select>
          </label>
        </div>
        <label className="field" style={{ marginTop: '0.8rem' }}>
          <span>Descripción</span>
          <textarea value={ticket.body || ''} onChange={(event) => patch({ body: event.target.value })} />
        </label>
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Guardar ficha</button>
      </form>
      <form onSubmit={saveProgress} className="panel" style={{ marginTop: '0.8rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>Estado</span>
            <select value={ticket.status_id} onChange={(event) => patch({ status_id: event.target.value })}>
              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Porcentaje del estado</span>
            <input
              type="number"
              min="0"
              max="100"
              value={ticket.local_percent}
              onChange={(event) => patch({ local_percent: event.target.value })}
            />
          </label>
        </div>
        <button className="btn quiet" type="submit" style={{ marginTop: '0.8rem' }}>Guardar avance</button>
      </form>
      {pulls.length > 0 && (
        <section style={{ marginTop: '1.4rem' }}>
          <h2>Pulls</h2>
          <ul className="timeline">
            {pulls.map((pull) => (
              <li key={pull.id}><a href={pull.url}>{pull.url}</a></li>
            ))}
          </ul>
        </section>
      )}
      <section style={{ marginTop: '1.4rem' }}>
        <h2>Proceso</h2>
        <ul className="timeline">
          {events.map((item) => (
            <li key={item.id}>
              <span className="quiet">{formatWhen(item.created_at)} · {item.visibility === 'public' ? 'Público' : 'Interno'}</span>
              <div>{item.body}</div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
