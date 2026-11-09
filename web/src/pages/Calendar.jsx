import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { groupDayMarks, marksByDay } from '../lib/calendarMarks'
import { canEdit, formatProgress, localDateKey, memberName, messageFrom, ticketKey } from '../lib/format'
import { Alert, Progress, TicketChips } from '../components/ui'

const weekday = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function finished(ticket) {
  return ticket.status_kind === 'close' || Number(ticket.progress) >= 100
}

function weeksOf(year, month) {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 6 }, (_, week) => (
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start)
      date.setDate(start.getDate() + week * 7 + day)
      return date
    })
  ))
}

export function Calendar() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const editable = canEdit(role)
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [sprints, setSprints] = useState([])
  const [tickets, setTickets] = useState([])
  const [events, setEvents] = useState([])
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const location = useLocation()
  const [notice, setNotice] = useState('')

  async function load() {
    const [sprintRes, ticketRes, eventRes, memberRes] = await Promise.all([
      supabase.from('sprints').select('id, name, starts_on, ends_on').eq('company_id', companyId).order('starts_on'),
      supabase.from('ticket_rows').select('id, public_number, title, sprint_id, status_kind, progress, assignee_id, priority, estimate, rank').eq('company_id', companyId).order('rank'),
      supabase.from('ticket_events').select('ticket_id, body, created_at').eq('company_id', companyId).order('created_at'),
      supabase.from('company_members').select('user_id, alias').eq('company_id', companyId),
    ])
    const failed = [sprintRes, ticketRes, eventRes, memberRes].find((item) => item.error)
    if (failed) setError(messageFrom(failed.error))
    else {
      setSprints(sprintRes.data ?? [])
      setTickets(ticketRes.data ?? [])
      setEvents(eventRes.data ?? [])
      setMembers(memberRes.data ?? [])
    }
  }

  useEffect(() => { load() }, [companyId])

  useEffect(() => {
    const text = location.state?.notice
    if (!text) return undefined
    setNotice(text)
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [location.state])

  const weeks = useMemo(() => weeksOf(cursor.year, cursor.month), [cursor])
  const marks = useMemo(() => marksByDay(tickets, events, localDateKey), [tickets, events])
  const assigneeById = useMemo(
    () => new Map(members.map((member) => [member.user_id, memberName(member)])),
    [members],
  )
  const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month, 1))

  function assigneeOf(ticket) {
    if (!ticket.assignee_id) return 'Sin asignar'
    return assigneeById.get(ticket.assignee_id) ?? 'Sin asignar'
  }

  function shift(delta) {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  return (
    <section className="page">
      <div className="row">
        <div>
          <p className="kicker">Calendario</p>
          <h1 style={{ textTransform: 'capitalize' }}>{title}</h1>
        </div>
        <div className="cluster">
          {editable && <Link className="btn" to="nuevo">Nuevo sprint</Link>}
          <button className="btn quiet" type="button" onClick={() => shift(-1)}>Anterior</button>
          <button className="btn quiet" type="button" onClick={() => shift(1)}>Siguiente</button>
        </div>
      </div>
      <Alert>{error}</Alert>
      {notice && <p className="done" role="status">{notice}</p>}
      <div className="ledger">
      <div className="days" style={{ marginBottom: '0.4rem' }}>
        {weekday.map((day) => <span key={day} className="quiet">{day}</span>)}
      </div>
      {weeks.map((days) => (
        <div className="calendar-week" key={localDateKey(days[0])}>
          <div className="days">
            {days.map((day) => {
              const key = localDateKey(day)
              return (
                <div key={key} className={day.getMonth() === cursor.month ? 'day' : 'day out'}>
                  <span>{day.getDate()}</span>
                  <div className="marks">
                    {groupDayMarks(marks.get(key) ?? []).map((group) => {
                      const percents = group.tickets.map((mark) => formatProgress(mark.percent))
                      const shared = percents.every((percent) => percent === percents[0])
                      const closed = group.tickets.every((mark) => Number(mark.percent) >= 100)
                      return (
                        <div key={group.statusName} className={closed ? 'mark closed' : 'mark moved'}>
                          <span className="mark-line">
                            <span className="closed-title">{group.statusName}</span>
                            {shared && <span className="closed-percent">{percents[0]}%</span>}
                          </span>
                          <span className="mark-keys">
                            {group.tickets.map((mark) => (
                              <Link key={mark.id} to={`../t/${mark.id}`}>
                                <span className="closed-key">{ticketKey(company.ticket_prefix, mark.public_number)}</span>
                                {!shared && <span className="closed-percent">({formatProgress(mark.percent)}%)</span>}
                              </Link>
                            ))}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {sprints.map((sprint) => {
            let from = -1
            let to = -1
            days.forEach((day, index) => {
              const key = localDateKey(day)
              if (key >= sprint.starts_on && key <= sprint.ends_on) {
                if (from < 0) from = index
                to = index
              }
            })
            if (from < 0) return null
            const carried = tickets.filter((ticket) => ticket.sprint_id === sprint.id)
            const firstWeek = weeks.find((candidate) => {
              const start = localDateKey(candidate[0])
              const end = localDateKey(candidate[6])
              return sprint.starts_on <= end && sprint.ends_on >= start
            })
            const showTickets = firstWeek && localDateKey(firstWeek[0]) === localDateKey(days[0])
            const detail = (
              <>
                <div className="cluster">
                  <strong>{sprint.name}</strong>
                  {editable && <Link className="text-btn" to={`s/${sprint.id}`}>Editar</Link>}
                </div>
                {carried.length === 0
                  ? <div className="quiet">Sin tickets. Asígnale este sprint en la ficha.</div>
                  : (
                    <ul className="sprint-tickets">
                      {carried.map((ticket) => (
                        <li key={ticket.id}>
                          <Link className="sprint-name" to={`../t/${ticket.id}`}>
                            <span className="closed-key">{ticketKey(company.ticket_prefix, ticket.public_number)}</span>
                            <span className="sprint-copy">
                              <span className="sprint-title">{ticket.title}</span>
                              <span className="quiet">
                                {finished(ticket) ? `Completo · ${assigneeOf(ticket)}` : assigneeOf(ticket)}
                              </span>
                            </span>
                          </Link>
                          <TicketChips priority={ticket.priority} estimate={ticket.estimate} />
                          <Progress value={ticket.progress} />
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )
            return (
              <div className="bar-row" key={sprint.id}>
                <div className="bar slim" style={{ gridColumn: `${from + 1} / ${to + 2}` }}>
                  <strong className="bar-name">{sprint.name}</strong>
                </div>
                {showTickets && <div className="bar-detail">{detail}</div>}
              </div>
            )
          })}
        </div>
      ))}
      </div>
    </section>
  )
}
