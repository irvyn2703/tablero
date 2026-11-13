import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { assigneeLabel, canEdit, laneVars, memberName, messageFrom, ticketKey } from '../lib/format'
import { discardTicket } from '../lib/files'
import { ActionButton, Alert, Done, Progress, TicketChips, useFeedback } from '../components/ui'

const PAGE = 12
const UNCATEGORIZED = 'none'

function catStorageKey(userId, companyId) {
  return `tablero-cats:${userId}:${companyId}`
}

function readPickedCats(userId, companyId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(catStorageKey(userId, companyId)) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => id === UNCATEGORIZED || (typeof id === 'string' && id.length > 0))
  } catch {
    return []
  }
}

function storePickedCats(userId, companyId, next) {
  try {
    localStorage.setItem(catStorageKey(userId, companyId), JSON.stringify(next))
  } catch {
    // The choice still holds for this visit.
  }
}

export function Board() {
  const { company, role, session } = useOutletContext()
  const editable = canEdit(role)
  const { companyId } = useParams()
  const [statuses, setStatuses] = useState([])
  const [tickets, setTickets] = useState([])
  const [error, setError] = useState('')
  const [draggingId, setDraggingId] = useState('')
  const [drop, setDrop] = useState(null)
  const [shown, setShown] = useState({})
  const [versions, setVersions] = useState([])
  const [versionCategories, setVersionCategories] = useState([])
  const [categories, setCategories] = useState([])
  const [links, setLinks] = useState([])
  const [members, setMembers] = useState([])
  const userId = session.user.id
  const [pickedCats, setPickedCats] = useState(() => readPickedCats(userId, companyId))
  const [categoryName, setCategoryName] = useState('')
  const dragRef = useRef(null)
  const boardRef = useRef(null)
  const spots = useRef(new Map())
  const loadGen = useRef(0)
  const { busy, done, mark, run } = useFeedback()

  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return
    const origin = board.getBoundingClientRect()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map()
    board.querySelectorAll('[data-ticket]').forEach((card) => {
      const id = card.dataset.ticket
      const rect = card.getBoundingClientRect()
      const shift = new DOMMatrix(getComputedStyle(card).transform)
      const spot = {
        left: rect.left - origin.left - shift.m41 + board.scrollLeft,
        top: rect.top - origin.top - shift.m42 + board.scrollTop,
        status: card.dataset.status,
      }
      const previous = spots.current.get(id)
      next.set(id, spot)
      if (!previous || reduce) return
      const dx = previous.left - spot.left
      const dy = previous.top - spot.top
      const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1
      if (moved) {
        card.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, zIndex: 2 },
            { transform: 'translate(0, 0)', zIndex: 2 },
          ],
          { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
      }
      if (previous.status !== spot.status) {
        card.classList.add('is-settling')
        card.addEventListener('animationend', () => card.classList.remove('is-settling'), { once: true })
      }
    })
    spots.current = next
  })

  async function load() {
    const gen = ++loadGen.current
    const forUser = userId
    const forCompany = companyId
    const [statusRes, ticketRes, versionRes, versionCategoryRes, categoryRes, linkRes, memberRes] = await Promise.all([
      supabase.from('statuses').select('id, name, kind, position, weight, color, allows_delete').eq('company_id', companyId).order('position'),
      supabase.from('ticket_rows').select('id, public_number, title, status_id, progress, local_percent, priority, estimate, rank, version_id, assignee_id').eq('company_id', companyId).order('rank'),
      supabase.from('versions').select('id, name, category_id').eq('company_id', companyId),
      supabase.from('version_categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('ticket_categories').select('ticket_id, category_id').eq('company_id', companyId),
      supabase.from('company_members').select('user_id, alias').eq('company_id', companyId),
    ])
    if (gen !== loadGen.current) return
    const failed = [statusRes, ticketRes, versionRes, versionCategoryRes, categoryRes, linkRes, memberRes].find((item) => item.error)
    if (failed) {
      setError(messageFrom(failed.error))
      return
    }
    setStatuses(statusRes.data ?? [])
    setTickets(ticketRes.data ?? [])
    setVersions(versionRes.data ?? [])
    setVersionCategories(versionCategoryRes.data ?? [])
    setCategories(categoryRes.data ?? [])
    setLinks(linkRes.data ?? [])
    setMembers(memberRes.data ?? [])
    const known = new Set((categoryRes.data ?? []).map((item) => item.id))
    setPickedCats((current) => {
      const next = current.filter((id) => id === UNCATEGORIZED || known.has(id))
      if (next.length !== current.length) storePickedCats(forUser, forCompany, next)
      return next
    })
  }

  useEffect(() => {
    setShown({})
    setPickedCats(readPickedCats(userId, companyId))
    load()
  }, [companyId, userId])

  function applyPicked(updater) {
    setPickedCats((current) => {
      const next = updater(current)
      storePickedCats(userId, companyId, next)
      return next
    })
  }

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

  function shiftColumn(ticketId, targetId, before) {
    setTickets((current) => {
      const ticket = current.find((item) => item.id === ticketId)
      if (!ticket) return current
      const column = current
        .filter((item) => item.status_id === ticket.status_id)
        .sort((a, b) => a.rank - b.rank)
      const ranks = column.map((item) => item.rank)
      const order = column.filter((item) => item.id !== ticketId)
      let index = targetId
        ? order.findIndex((item) => item.id === targetId)
        : column.findIndex((item) => item.id === ticketId) + before
      if (index < 0) return current
      if (targetId && !before) index += 1
      order.splice(index, 0, ticket)
      const rankOf = new Map(order.map((item, position) => [item.id, ranks[position]]))
      return current.map((item) => (rankOf.has(item.id) ? { ...item, rank: rankOf.get(item.id) } : item))
    })
  }

  function reorder(ticketId, direction) {
    return run(`order-${ticketId}`, async () => {
      setError('')
      shiftColumn(ticketId, null, direction)
      const { error: orderError } = await supabase.rpc('move_ticket', {
        p_ticket_id: ticketId,
        p_direction: direction,
      })
      if (orderError) {
        setError(messageFrom(orderError))
        load()
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
      shiftColumn(ticketId, targetId, before)
      const { error: placeError } = await supabase.rpc('place_ticket', {
        p_ticket_id: ticketId,
        p_target_id: targetId,
        p_before: before,
      })
      if (placeError) {
        setError(messageFrom(placeError))
        load()
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

  function dropTarget(event, drag) {
    const board = boardRef.current
    if (board) {
      const rect = board.getBoundingClientRect()
      if (event.clientX < rect.left + 56) board.scrollLeft -= 18
      else if (event.clientX > rect.right - 56) board.scrollLeft += 18
    }
    const stack = document.elementsFromPoint(event.clientX, event.clientY)
    const hit = stack.find((node) => !node.closest?.(`[data-ticket="${drag.id}"]`))
    const columnEl = hit?.closest?.('[data-column]')
    if (!columnEl) return null
    const statusId = columnEl.dataset.column
    const cards = [...columnEl.querySelectorAll('[data-ticket]')].filter((node) => node.dataset.ticket !== drag.id)
    const y = event.clientY
    if (cards.length === 0) {
      return statusId === drag.statusId ? null : { statusId, targetId: null, before: false }
    }
    if (y < cards[0].getBoundingClientRect().top) {
      return statusId === drag.statusId ? null : { statusId, targetId: cards[0].dataset.ticket, before: true }
    }
    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      const margin = Number.parseFloat(getComputedStyle(card).marginBottom) || 0
      if (y > rect.bottom + margin) continue
      return {
        statusId,
        targetId: card.dataset.ticket,
        before: y < rect.top + rect.height / 2,
      }
    }
    if (statusId === drag.statusId) return null
    const ordered = tickets
      .filter((item) => item.status_id === statusId)
      .sort((a, b) => a.rank - b.rank)
    const lastMounted = cards[cards.length - 1].dataset.ticket
    const lastTicket = ordered[ordered.length - 1]?.id
    if (lastMounted === lastTicket) return { statusId, targetId: null, before: false }
    return { statusId, targetId: lastMounted, before: false }
  }

  function trackDrag(event) {
    const drag = dragRef.current
    if (!drag) return
    const next = dropTarget(event, drag)
    drag.over = next
    setDrop((current) => {
      if (
        current?.statusId === next?.statusId
        && current?.targetId === next?.targetId
        && current?.before === next?.before
      ) return current
      return next
    })
  }

  function endDrag() {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId('')
    setDrop(null)
    const over = drag?.over
    if (!over) return
    if (over.statusId === drag.statusId) {
      if (over.targetId) place(drag.id, over.targetId, over.before)
      return
    }
    relocate(drag.id, over)
  }

  function relocate(ticketId, over) {
    return run('move', async () => {
      setError('')
      const column = tickets
        .filter((item) => item.status_id === over.statusId && item.id !== ticketId)
        .sort((a, b) => a.rank - b.rank)
      const targetId = over.targetId || column[column.length - 1]?.id || ''
      const before = over.targetId ? over.before : false
      setTickets((current) => {
        const ticket = current.find((item) => item.id === ticketId)
        if (!ticket) return current
        let rank = ticket.rank
        if (targetId) {
          const index = column.findIndex((item) => item.id === targetId)
          const neighbor = column[index]
          const other = before ? column[index - 1] : column[index + 1]
          if (neighbor) {
            const edge = before ? (other ? other.rank : neighbor.rank - 1) : neighbor.rank
            const far = before ? neighbor.rank : (other ? other.rank : neighbor.rank + 1)
            rank = (edge + far) / 2
          }
        } else if (column.length) {
          rank = column[column.length - 1].rank + 1
        }
        return current.map((item) => (
          item.id === ticketId ? { ...item, status_id: over.statusId, rank } : item
        ))
      })
      const { error: moveError } = await supabase.rpc('set_ticket_progress', {
        p_ticket_id: ticketId,
        p_status_id: over.statusId,
        p_local: null,
      })
      if (moveError) {
        setError(messageFrom(moveError))
        load()
        return false
      }
      if (targetId) {
        const { error: placeError } = await supabase.rpc('place_ticket', {
          p_ticket_id: ticketId,
          p_target_id: targetId,
          p_before: before,
        })
        if (placeError) {
          setError(messageFrom(placeError))
          load()
          return false
        }
      }
      const index = targetId
        ? column.findIndex((item) => item.id === targetId) + (before ? 0 : 1)
        : column.length
      showThrough(over.statusId, Math.max(index, 0))
      load()
    }, 'Ticket movido.')
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

  const assigneeById = useMemo(
    () => new Map(members.map((member) => [member.user_id, memberName(member)])),
    [members],
  )

  function versionOf(ticket) {
    if (!ticket.version_id) return ''
    const version = versions.find((item) => item.id === ticket.version_id)
    if (!version) return ''
    const category = versionCategories.find((item) => item.id === version.category_id)
    return category ? `${category.name} ${version.name}` : version.name
  }

  function categoriesOf(ticketId) {
    const ids = links.filter((link) => link.ticket_id === ticketId).map((link) => link.category_id)
    return categories.filter((category) => ids.includes(category.id))
  }

  function matches(ticket) {
    if (pickedCats.length === 0) return true
    const ids = links.filter((link) => link.ticket_id === ticket.id).map((link) => link.category_id)
    if (ids.length === 0) return pickedCats.includes(UNCATEGORIZED)
    return pickedCats.some((id) => ids.includes(id))
  }

  function toggleCat(id) {
    applyPicked((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  async function addCategory(event) {
    event.preventDefault()
    await run('category', async () => {
      setError('')
      const name = categoryName.trim()
      if (!name) {
        setError('La categoría lleva nombre.')
        return false
      }
      const { error: insertError } = await supabase.from('categories').insert({
        company_id: companyId,
        name,
      })
      if (insertError) {
        setError(insertError.code === '23505' ? 'Ya existe esa categoría.' : messageFrom(insertError))
        return false
      }
      setCategoryName('')
      await load()
    }, 'Categoría agregada.')
  }

  function removeCategory(category) {
    if (!window.confirm(`Se quita ${category.name}. También sale de los tickets que la tenían.`)) return
    return run(`category-${category.id}`, async () => {
      setError('')
      const { error: deleteError } = await supabase.from('categories').delete().eq('id', category.id).eq('company_id', companyId)
      if (deleteError) {
        setError(messageFrom(deleteError))
        return false
      }
      applyPicked((current) => current.filter((item) => item !== category.id))
      await load()
    }, 'Categoría quitada.')
  }

  function move(ticketId, statusId) {
    return run('move', async () => {
      setError('')
      setTickets((current) => current.map((item) => (
        item.id === ticketId ? { ...item, status_id: statusId } : item
      )))
      const { error: moveError } = await supabase.rpc('set_ticket_progress', {
        p_ticket_id: ticketId,
        p_status_id: statusId,
        p_local: null,
      })
      if (moveError) {
        setError(messageFrom(moveError))
        load()
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
      <div className="cat-bar">
        <div className="cat-list" role="group" aria-label="Filtrar por categoría">
          <button
            className={pickedCats.includes(UNCATEGORIZED) ? 'cat on' : 'cat'}
            type="button"
            aria-pressed={pickedCats.includes(UNCATEGORIZED)}
            onClick={() => toggleCat(UNCATEGORIZED)}
          >
            Sin categoría
          </button>
          {categories.map((category) => (
            <span className="cat-item" key={category.id}>
              <button
                className={pickedCats.includes(category.id) ? 'cat on' : 'cat'}
                type="button"
                aria-pressed={pickedCats.includes(category.id)}
                onClick={() => toggleCat(category.id)}
              >
                {category.name}
              </button>
              {editable && (
                <button
                  className="cat-x"
                  type="button"
                  aria-label={`Quitar ${category.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => removeCategory(category)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {editable && (
          <form className="cat-new" onSubmit={addCategory}>
            <input
              value={categoryName}
              placeholder="Nueva categoría"
              maxLength={40}
              aria-label="Nueva categoría"
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <ActionButton name="category" busy={busy} pending="…" className="btn" type="submit">
              Agregar
            </ActionButton>
          </form>
        )}
      </div>
      <div className="board" ref={boardRef}>
        {statuses.map((status) => {
          const columnTickets = tickets.filter((ticket) => ticket.status_id === status.id && matches(ticket))
          const limit = Math.min(shown[status.id] ?? PAGE, columnTickets.length)
          const visible = columnTickets.slice(0, limit)
          const hidden = columnTickets.length - visible.length
          return (
          <section
            className={drop?.statusId === status.id && !drop.targetId ? 'column is-drop' : 'column'}
            style={laneVars(status.color)}
            data-column={status.id}
            key={status.id}
          >
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
                  drop?.targetId === ticket.id ? (drop.before ? 'is-drop-before' : 'is-drop-after') : '',
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
                      disabled={Boolean(busy)}
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
                  {versionOf(ticket) && <span className="card-version">{versionOf(ticket)}</span>}
                  <p>{ticket.title}</p>
                  <span className="card-who quiet">{assigneeLabel(assigneeById, ticket.assignee_id)}</span>
                  {categoriesOf(ticket.id).length > 0 && (
                    <span className="card-cats">
                      {categoriesOf(ticket.id).map((category) => (
                        <span key={category.id}>{category.name}</span>
                      ))}
                    </span>
                  )}
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
