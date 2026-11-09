import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { groupDayMarks, marksByDay } from '../lib/calendarMarks'
import { canEdit, formatProgress, localDateKey, memberName, messageFrom, sprintSpan, ticketKey } from '../lib/format'
import { bucketStays, objectiveLanes, sizeLine } from '../lib/sprintStory'
import { Alert, Progress, TicketChips } from '../components/ui'

const weekday = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

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

function TicketLine({ ticket, company, assigneeOf, hint }) {
  return (
    <li>
      <Link className="sprint-name" to={`../t/${ticket.id}`}>
        <span className="closed-key">{ticketKey(company.ticket_prefix, ticket.public_number)}</span>
        <span className="sprint-copy">
          <span className="sprint-title">{ticket.title}</span>
          <span className="quiet">{hint || assigneeOf(ticket)}</span>
        </span>
      </Link>
      <TicketChips priority={ticket.priority} estimate={ticket.estimate} />
      <Progress value={ticket.progress} />
    </li>
  )
}

function Bucket({ title, tickets, company, assigneeOf, hintFor }) {
  return (
    <div>
      <span className="quiet">{title}</span>
      {tickets.length === 0
        ? <div className="quiet">—</div>
        : (
          <ul className="sprint-tickets">
            {tickets.map((ticket) => (
              <TicketLine
                key={ticket.id}
                ticket={ticket}
                company={company}
                assigneeOf={assigneeOf}
                hint={hintFor ? hintFor(ticket) : ''}
              />
            ))}
          </ul>
        )}
    </div>
  )
}

function placeSprint(sprint, days) {
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
  return { from, to }
}

function sprintStartsThisWeek(sprint, weeks, days) {
  const firstWeek = weeks.find((candidate) => {
    const start = localDateKey(candidate[0])
    const end = localDateKey(candidate[6])
    return sprint.starts_on <= end && sprint.ends_on >= start
  })
  return Boolean(firstWeek) && localDateKey(firstWeek[0]) === localDateKey(days[0])
}

function SprintDetail({ sprint, span, buckets, editable, company, assigneeOf, sprintById }) {
  const counted = buckets.open.length + buckets.done.length + buckets.carried.length
  return (
    <div className="bar-detail">
      <div className="cluster">
        <strong>{span || sprint.name}</strong>
        {editable && <Link className="text-btn" to={`s/${sprint.id}`}>Editar</Link>}
      </div>
      <p className="quiet">
        {`comprometido ${buckets.open.length} · completo ${buckets.done.length} · sigue ${buckets.carried.length}`}
      </p>
      {counted === 0
        ? <div className="quiet">Sin tickets. Asígnale este sprint en la ficha.</div>
        : (
          <div className="sprint-buckets">
            <Bucket title="Comprometido" tickets={buckets.open} company={company} assigneeOf={assigneeOf} />
            <Bucket title="Completo" tickets={buckets.done} company={company} assigneeOf={assigneeOf} />
            <Bucket
              title="Sigue"
              tickets={buckets.carried}
              company={company}
              assigneeOf={assigneeOf}
              hintFor={(ticket) => {
                const next = sprintById.get(ticket.sprint_id)
                if (!next || next.id === sprint.id) return assigneeOf(ticket)
                return `Sigue en ${sprintSpan(next) || next.name}`
              }}
            />
          </div>
        )}
    </div>
  )
}

export function Calendar() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const editable = canEdit(role)
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [sprints, setSprints] = useState([])
  const [objectives, setObjectives] = useState([])
  const [categories, setCategories] = useState([])
  const [stays, setStays] = useState([])
  const [tickets, setTickets] = useState([])
  const [events, setEvents] = useState([])
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const location = useLocation()
  const [notice, setNotice] = useState('')

  async function load() {
    const [sprintRes, objectiveRes, categoryRes, stayRes, ticketRes, eventRes, memberRes] = await Promise.all([
      supabase.from('sprints').select('id, name, starts_on, ends_on, objective_id').eq('company_id', companyId).order('starts_on'),
      supabase.from('objectives').select('id, name, category_id').eq('company_id', companyId).order('name'),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('ticket_sprint_stays').select('ticket_id, sprint_id, outcome').eq('company_id', companyId),
      supabase.from('ticket_rows').select('id, public_number, title, sprint_id, status_kind, progress, assignee_id, priority, estimate, rank').eq('company_id', companyId).order('rank'),
      supabase.from('ticket_events').select('ticket_id, body, created_at').eq('company_id', companyId).order('created_at'),
      supabase.from('company_members').select('user_id, alias').eq('company_id', companyId),
    ])
    const failed = [sprintRes, objectiveRes, categoryRes, stayRes, ticketRes, eventRes, memberRes].find((item) => item.error)
    if (failed) setError(messageFrom(failed.error))
    else {
      setSprints(sprintRes.data ?? [])
      setObjectives(objectiveRes.data ?? [])
      setCategories(categoryRes.data ?? [])
      setStays(stayRes.data ?? [])
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
  const ticketsById = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets])
  const sprintById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint])), [sprints])
  const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month, 1))

  function assigneeOf(ticket) {
    if (!ticket.assignee_id) return 'Sin asignar'
    return assigneeById.get(ticket.assignee_id) ?? 'Sin asignar'
  }

  function storyOf(sprint, objective) {
    const buckets = bucketStays(
      stays.filter((stay) => stay.sprint_id === sprint.id),
      ticketsById,
    )
    const counted = [...buckets.open, ...buckets.done, ...buckets.carried]
    const span = sprintSpan(sprint)
    const size = sizeLine(counted.map((ticket) => ticket.estimate))
    const barName = [objective ? span : (span || sprint.name), size].filter(Boolean).join(' · ')
    return { buckets, span, barName: barName || sprint.name }
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
          {objectiveLanes(sprints, objectives, localDateKey(days[0]), localDateKey(days[6])).map((lane) => (
            <div className="bar-row" key={lane.key}>
              {lane.objective && (
                <div className="objective-head">
                  <strong>{lane.objective.name}</strong>
                  {categories.find((item) => item.id === lane.objective.category_id)?.name && (
                    <span className="quiet">{categories.find((item) => item.id === lane.objective.category_id).name}</span>
                  )}
                </div>
              )}
              {lane.sprints.map((sprint) => {
                const placed = placeSprint(sprint, days)
                if (!placed) return null
                const story = storyOf(sprint, lane.objective)
                return (
                  <div key={sprint.id} className="bar slim" style={{ gridColumn: `${placed.from + 1} / ${placed.to + 2}` }}>
                    <strong className="bar-name">{story.barName}</strong>
                  </div>
                )
              })}
              {lane.sprints.map((sprint) => {
                const placed = placeSprint(sprint, days)
                if (!placed || !sprintStartsThisWeek(sprint, weeks, days)) return null
                const story = storyOf(sprint, lane.objective)
                return (
                  <SprintDetail
                    key={`${sprint.id}-detail`}
                    sprint={sprint}
                    span={story.span}
                    buckets={story.buckets}
                    editable={editable}
                    company={company}
                    assigneeOf={assigneeOf}
                    sprintById={sprintById}
                  />
                )
              })}
            </div>
          ))}
        </div>
      ))}
      </div>
    </section>
  )
}
