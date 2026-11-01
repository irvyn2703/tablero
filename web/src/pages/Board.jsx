import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canEdit, laneVars, messageFrom, ticketKey } from '../lib/format'
import { discardTicket } from '../lib/files'
import { Alert, Done, Progress, TicketChips, useFeedback } from '../components/ui'

const PAGE = 12

export function Board() {
  const { company, role } = useOutletContext()
  const editable = canEdit(role)
  const { companyId } = useParams()
  const [statuses, setStatuses] = useState([])
  const [tickets, setTickets] = useState([])
  const [error, setError] = useState('')
  const [draggingId, setDraggingId] = useState('')
  const [drop, setDrop] = useState(null)
  const [shown, setShown] = useState({})
  const dragRef = useRef(null)
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [statusRes, ticketRes] = await Promise.all([
      supabase.from('statuses').select('id, name, kind, position, weight, color, allows_delete').eq('company_id', companyId).order('position'),
      supabase.from('ticket_rows').select('id, public_number, title, status_id, progress, local_percent, priority, estimate, rank').eq('company_id', companyId).order('rank'),
    ])
    if (statusRes.error || ticketRes.error) {
      setError(messageFrom(statusRes.error || ticketRes.error))
      return
    }
    setStatuses(statusRes.data ?? [])
    setTickets(ticketRes.data ?? [])
  }

  useEffect(() => {
    setShown({})
    load()
  }, [companyId])

  function reveal(statusId, total) {
    setShown((current) => {
      const now = current[statusId] ?? PAGE
      if (now >= total) return current
      return { ...current, [statusId]: Math.min(now + PAGE, total) }
    })
  }

  function showThrough(statusId, index) {
    if (index == null || index < 0) return
    setShown((current) => {
      const need = index + 1
      if (need <= (current[statusId] ?? PAGE)) return current
      return { ...current, [statusId]: need }
    })
  }

  function landingIndex(ticketId, targetId, before) {
    const ticket = tickets.find((item) => item.id === ticketId)
    if (!ticket) return null
    const column = tickets.filter((item) => item.status_id === ticket.status_id && item.id !== ticketId)
    let index = column.findIndex((item) => item.id === targetId)
    if (index < 0) return null
    if (!before) index += 1
    return { statusId: ticket.status_id, index }
  }

  function reorder(ticketId, direction) {
    return run(`order-${ticketId}`, async () => {
      setError('')
      const { error: orderError } = await supabase.rpc('move_ticket', {
        p_ticket_id: ticketId,
        p_direction: direction,
      })
      if (orderError) {
        setError(messageFrom(orderError))
        return false
      }
      const ticket = tickets.find((item) => item.id === ticketId)
      if (ticket) {
        const index = tickets.filter((item) => item.status_id === ticket.status_id).findIndex((item) => item.id === ticketId)
        showThrough(ticket.status_id, index + direction)
      }
      load()
    }, direction < 0 ? 'El ticket subió.' : 'El ticket bajó.')
  }

  function place(ticketId, targetId, before) {
    return run(`order-${ticketId}`, async () => {
      setError('')
      const { error: placeError } = await supabase.rpc('place_ticket', {
        p_ticket_id: ticketId,
        p_target_id: targetId,
        p_before: before,
      })
      if (placeError) {
        setError(messageFrom(placeError))
        return false
      }
      const landing = landingIndex(ticketId, targetId, before)
      if (landing) showThrough(landing.statusId, landing.index)
      load()
    }, 'El ticket cambió de lugar.')
  }

  function startDrag(event, ticket) {
    if (busy || event.button > 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: ticket.id, statusId: ticket.status_id, over: null }
    setDraggingId(ticket.id)
    setDrop(null)
  }

  function trackDrag(event) {
    const drag = dragRef.current
    if (!drag) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const card = hit?.closest?.('[data-ticket]')
    const sameColumn = card && card.dataset.status === drag.statusId && card.dataset.ticket !== drag.id
    const next = sameColumn
      ? {
          id: card.dataset.ticket,
          before: event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2,
        }
      : null
    drag.over = next
    setDrop((current) => {
      if (current?.id === next?.id && current?.before === next?.before) return current
      return next
    })
  }

  function endDrag() {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId('')
    setDrop(null)
    if (drag?.over) place(drag.id, drag.over.id, drag.over.before)
  }

  function discard(ticket) {
    const key = ticketKey(company.ticket_prefix, ticket.public_number)
    return run(`delete-${ticket.id}`, async () => {
      setError('')
      const result = await discardTicket(ticket.id, key)
      if (result.cancelled) return false
      if (result.error) {
        setError(messageFrom(result.error))
        return false
      }
      load()
    }, 'Ticket eliminado.')
  }

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
      const ticket = tickets.find((item) => item.id === ticketId)
      if (ticket && ticket.status_id !== statusId) {
        const ahead = tickets.filter((item) => item.status_id === statusId && item.rank < ticket.rank).length
        showThrough(statusId, ahead)
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
        {statuses.map((status) => {
          const columnTickets = tickets.filter((ticket) => ticket.status_id === status.id)
          const limit = Math.min(shown[status.id] ?? PAGE, columnTickets.length)
          const visible = columnTickets.slice(0, limit)
          const hidden = columnTickets.length - visible.length
          return (
          <section className="column" style={laneVars(status.color)} key={status.id}>
            <header>
              <strong>{status.name}</strong>
              <span className="quiet">
                {hidden > 0
                  ? `${visible.length} de ${columnTickets.length}`
                  : status.kind === 'work'
                    ? `${status.weight}%`
                    : status.kind === 'close'
                      ? 'Cierre'
                      : 'Pausa'}
              </span>
            </header>
            {visible.map((ticket, index) => (
              <article
                className={[
                  'card',
                  draggingId === ticket.id ? 'is-dragging' : '',
                  drop?.id === ticket.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '',
                ].filter(Boolean).join(' ')}
                data-ticket={ticket.id}
                data-status={status.id}
                key={ticket.id}
              >
                <div className="card-top">
                  <Link className="card-key" to={`t/${ticket.id}`}>
                    <em>{ticketKey(company.ticket_prefix, ticket.public_number)}</em>
                  </Link>
                  {editable && (
                  <div className="card-order">
                    <button className="btn quiet" type="button" aria-label="Subir" disabled={Boolean(busy) || index === 0} onClick={() => reorder(ticket.id, -1)}>
                      <Arrow up />
                    </button>
                    <button
                      className="btn quiet grip"
                      type="button"
                      aria-label="Arrastrar"
                      disabled={Boolean(busy) || visible.length < 2}
                      onPointerDown={(event) => startDrag(event, ticket)}
                      onPointerMove={trackDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      <Grip />
                    </button>
                    <button className="btn quiet" type="button" aria-label="Bajar" disabled={Boolean(busy) || index === columnTickets.length - 1} onClick={() => reorder(ticket.id, 1)}>
                      <Arrow />
                    </button>
                  </div>
                  )}
                </div>
                <Link className="card-body" to={`t/${ticket.id}`}>
                  <p>{ticket.title}</p>
                  <TicketChips priority={ticket.priority} estimate={ticket.estimate} />
                  <Progress value={ticket.progress} />
                </Link>
                {editable && (
                  <label className="field card-move">
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
                {editable && status.allows_delete && (
                  <button className="btn danger card-delete" type="button" disabled={Boolean(busy)} onClick={() => discard(ticket)}>
                    Eliminar
                  </button>
                )}
              </article>
            ))}
            {hidden > 0 && status.kind === 'work' && (
              <ColumnTail limit={limit} onMore={() => reveal(status.id, columnTickets.length)} />
            )}
            {hidden > 0 && status.kind !== 'work' && (
              <button className="btn quiet column-more" type="button" onClick={() => reveal(status.id, columnTickets.length)}>
                Ver más
              </button>
            )}
          </section>
          )
        })}
      </div>
    </section>
  )
}

function ColumnTail({ limit, onMore }) {
  const ref = useRef(null)
  const onMoreRef = useRef(onMore)
  onMoreRef.current = onMore

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onMoreRef.current()
    }, { rootMargin: '280px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [limit])

  return <div ref={ref} className="column-tail" />
}

function Arrow({ up = false }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={up ? 'M7 11 V3 M3.5 6.5 L7 3 L10.5 6.5' : 'M7 3 V11 M3.5 7.5 L7 11 L10.5 7.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function Grip() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
      <path d="M1 3 H9 M1 7 H9 M1 11 H9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
