import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { groupDayMarks, marksByDay } from '../lib/calendarMarks'
import { canEdit, formatProgress, localDateKey, messageFrom, sprintSpan, ticketKey } from '../lib/format'
import { bucketStays, objectiveLanes, sizeLine } from '../lib/sprintStory'
import { Alert } from '../components/ui'

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

function StoryLine({ ticket, company, extra, done }) {
  return (
    <li>
      <Link className={done ? 'story-line is-done' : 'story-line'} to={`../t/${ticket.id}`}>
        <span className="closed-key">{ticketKey(company.ticket_prefix, ticket.public_number)}</span>
        <span className="sprint-title">{ticket.title}</span>
        {extra && <span className="story-next">{extra}</span>}
      </Link>
    </li>
  )
}

function Bucket({ title, tickets, company, done, extraFor }) {
  return (
    <div>
      <span className="quiet">{title}</span>
      {tickets.length === 0
        ? <div className="quiet">—</div>
        : (
          <ul className="sprint-tickets">
            {tickets.map((ticket) => (
              <StoryLine
                key={ticket.id}
                ticket={ticket}
                company={company}
                done={done}
                extra={extraFor ? extraFor(ticket) : ''}
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

function weekHolds(date, days) {
  return date >= localDateKey(days[0]) && date <= localDateKey(days[6])
}

function laneTone(categoryName) {
  const name = String(categoryName || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  if (name === 'movil' || name === 'mobile') return 'brass'
  return 'pine'
}

function SprintDetail({ sprint, span, buckets, tone, editable, company, sprintById }) {
  const counted = buckets.open.length + buckets.done.length + buckets.carried.length
  return (
    <div className={`bar-detail tone-${tone}`}>
      <div className="cluster">
        <strong>{span || sprint.name}</strong>
        {editable && <Link className="text-btn" to={`s/${sprint.id}`}>Editar</Link>}
      </div>
      {counted === 0
        ? <div className="quiet">Sin tickets. Asígnale este sprint en la ficha.</div>
        : (
          <div className="sprint-buckets">
            <Bucket title="Comprometido" tickets={buckets.open} company={company} />
            <Bucket title="Completo" tickets={buckets.done} company={company} done />
            <Bucket
              title="Sigue"
              tickets={buckets.carried}
              company={company}
              extraFor={(ticket) => {
                const next = sprintById.get(ticket.sprint_id)
                if (!next || next.id === sprint.id) return ''
                return sprintSpan(next) || next.name
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
  const [error, setError] = useState('')
  const location = useLocation()
  const [notice, setNotice] = useState('')
  const [openSprintId, setOpenSprintId] = useState(null)

  async function load() {
    const [sprintRes, objectiveRes, categoryRes, stayRes, ticketRes, eventRes] = await Promise.all([
      supabase.from('sprints').select('id, name, starts_on, ends_on, objective_id').eq('company_id', companyId).order('starts_on'),
      supabase.from('objectives').select('id, name, category_id').eq('company_id', companyId).order('name'),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('ticket_sprint_stays').select('ticket_id, sprint_id, outcome').eq('company_id', companyId),
      supabase.from('ticket_rows').select('id, public_number, title, sprint_id, estimate').eq('company_id', companyId),
      supabase.from('ticket_events').select('ticket_id, body, created_at').eq('company_id', companyId).order('created_at'),
    ])
    const failed = [sprintRes, objectiveRes, categoryRes, stayRes, ticketRes, eventRes].find((item) => item.error)
    if (failed) setError(messageFrom(failed.error))
    else {
      setSprints(sprintRes.data ?? [])
      setObjectives(objectiveRes.data ?? [])
      setCategories(categoryRes.data ?? [])
      setStays(stayRes.data ?? [])
      setTickets(ticketRes.data ?? [])
      setEvents(eventRes.data ?? [])
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
  const ticketsById = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets])
  const sprintById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint])), [sprints])
  const storyBySprintId = useMemo(() => {
    const staysBySprint = new Map()
    for (const stay of stays) {
      const list = staysBySprint.get(stay.sprint_id) || []
      list.push(stay)
      staysBySprint.set(stay.sprint_id, list)
    }
    return new Map(sprints.map((sprint) => {
      const buckets = bucketStays(staysBySprint.get(sprint.id) || [], ticketsById)
      const counted = [...buckets.open, ...buckets.done, ...buckets.carried]
      return [sprint.id, {
        buckets,
        span: sprintSpan(sprint),
        size: sizeLine(counted.map((ticket) => ticket.estimate)),
      }]
    }))
  }, [sprints, stays, ticketsById])
  const startByObjectiveId = useMemo(() => {
    const starts = new Map()
    for (const sprint of sprints) {
      if (!sprint.objective_id) continue
      const current = starts.get(sprint.objective_id)
      if (!current || sprint.starts_on < current) starts.set(sprint.objective_id, sprint.starts_on)
    }
    return starts
  }, [sprints])
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month, 1))

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
          {objectiveLanes(sprints, objectives, localDateKey(days[0]), localDateKey(days[6])).map((lane) => {
            const category = lane.objective ? categoryById.get(lane.objective.category_id) : null
            const tone = laneTone(category?.name)
            const starts = lane.objective ? startByObjectiveId.get(lane.objective.id) || '' : ''
            const namedHere = Boolean(lane.objective) && Boolean(starts) && weekHolds(starts, days)
            const weekKey = localDateKey(days[0])
            const bars = lane.sprints.flatMap((sprint) => {
              const placed = placeSprint(sprint, days)
              const story = storyBySprintId.get(sprint.id)
              return placed && story ? [{ sprint, placed, story }] : []
            })
            const openBar = bars.find((bar) => openSprintId === `${bar.sprint.id}:${weekKey}`)
            return (
            <div className={namedHere || !lane.objective ? 'bar-row' : 'bar-row is-continued'} key={lane.key}>
              {namedHere && (
                <div className={`objective-head tone-${tone}`}>
                  <strong>{lane.objective.name}</strong>
                  {category?.name && <span className="quiet">{category.name}</span>}
                </div>
              )}
              {bars.map(({ sprint, placed, story }) => {
                const open = openBar?.sprint.id === sprint.id
                const label = [
                  story.span || sprint.name,
                  story.size,
                  `${story.buckets.open.length} comprometido`,
                  `${story.buckets.done.length} completo`,
                  `${story.buckets.carried.length} sigue`,
                ].filter(Boolean).join(', ')
                return (
                  <button
                    key={sprint.id}
                    type="button"
                    className={`bar slim tone-${tone}${open ? ' is-open' : ''}`}
                    style={{ gridColumn: `${placed.from + 1} / ${placed.to + 2}` }}
                    aria-expanded={open}
                    aria-label={label}
                    onClick={() => setOpenSprintId(open ? null : `${sprint.id}:${weekKey}`)}
                  >
                    <span className="bar-when">{story.span || sprint.name}</span>
                    {story.size && <span className="bar-size">{story.size}</span>}
                    <span className="bar-counts" aria-hidden="true">
                      <span className="count-open">{story.buckets.open.length}</span>
                      <span className="count-done">{story.buckets.done.length}</span>
                      <span className="count-carried">{story.buckets.carried.length}</span>
                    </span>
                  </button>
                )
              })}
              {openBar && (
                <SprintDetail
                  sprint={openBar.sprint}
                  span={openBar.story.span}
                  buckets={openBar.story.buckets}
                  tone={tone}
                  editable={editable}
                  company={company}
                  sprintById={sprintById}
                />
              )}
            </div>
            )
          })}
        </div>
      ))}
      </div>
    </section>
  )
}
