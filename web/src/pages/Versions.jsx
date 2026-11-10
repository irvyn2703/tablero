import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canEdit, messageFrom, ticketKey } from '../lib/format'
import { ActionButton, Alert, Done, useFeedback } from '../components/ui'

export function Versions() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const editable = canEdit(role)
  const [versions, setVersions] = useState([])
  const [categories, setCategories] = useState([])
  const [tickets, setTickets] = useState([])
  const [name, setName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [picked, setPicked] = useState({})
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [versionRes, categoryRes, ticketRes] = await Promise.all([
      supabase.from('versions').select('id, name, category_id, created_at').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('version_categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('ticket_rows').select('id, public_number, title, status_kind, version_id, rank').eq('company_id', companyId).order('rank'),
    ])
    const failed = [versionRes, categoryRes, ticketRes].find((item) => item.error)
    if (failed) setError(messageFrom(failed.error))
    else {
      setVersions(versionRes.data ?? [])
      setCategories(categoryRes.data ?? [])
      setTickets(ticketRes.data ?? [])
    }
  }

  useEffect(() => { load() }, [companyId])

  function inside(versionId) {
    return tickets.filter((ticket) => ticket.version_id === versionId)
  }

  function available() {
    return tickets.filter((ticket) => ticket.status_kind === 'close' && !ticket.version_id)
  }

  async function addCategory(event) {
    event.preventDefault()
    await run('front', async () => {
      setError('')
      if (!categoryName.trim()) {
        setError('La categoría lleva nombre.')
        return false
      }
      const { data, error: insertError } = await supabase.from('version_categories').insert({
        company_id: companyId,
        name: categoryName.trim(),
      }).select('id').single()
      if (insertError) {
        setError(insertError.code === '23505' ? 'Ya existe esa categoría de versión.' : messageFrom(insertError))
        return false
      }
      setCategoryName('')
      setCategoryId(data.id)
      await load()
    }, 'Categoría creada.')
  }

  function removeCategory(id) {
    return run(`front-${id}`, async () => {
      setError('')
      const { error: deleteError } = await supabase
        .from('version_categories')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId)
      if (deleteError) {
        setError(messageFrom(deleteError))
        return false
      }
      if (categoryId === id) setCategoryId('')
      await load()
    }, 'Categoría quitada. Las versiones quedan sin categoría.')
  }

  async function addVersion(event) {
    event.preventDefault()
    await run('add', async () => {
      setError('')
      if (!categoryId) {
        setError('Elige la categoría de la versión. Así no se mezcla móvil con dash.')
        return false
      }
      if (!name.trim()) {
        setError('La versión lleva nombre.')
        return false
      }
      const { error: insertError } = await supabase.from('versions').insert({
        company_id: companyId,
        name: name.trim(),
        category_id: categoryId,
      })
      if (insertError) {
        setError(insertError.code === '23505' ? 'Ya existe esa versión en esa categoría.' : messageFrom(insertError))
        return false
      }
      setName('')
      await load()
    }, 'Versión agregada.')
  }

  function place(versionId) {
    const ticketId = picked[versionId]
    if (!ticketId) return
    return run(`place-${versionId}`, async () => {
      setError('')
      const { error: updateError } = await supabase
        .from('tickets')
        .update({ version_id: versionId })
        .eq('id', ticketId)
        .eq('company_id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      setPicked((current) => ({ ...current, [versionId]: '' }))
      await load()
    }, 'Ticket metido en la versión.')
  }

  function takeOut(ticketId) {
    return run(`out-${ticketId}`, async () => {
      setError('')
      const { error: updateError } = await supabase
        .from('tickets')
        .update({ version_id: null })
        .eq('id', ticketId)
        .eq('company_id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      await load()
    }, 'Ticket fuera de la versión.')
  }

  function moveCategory(versionId, nextCategoryId) {
    return run(`category-${versionId}`, async () => {
      setError('')
      const { error: updateError } = await supabase
        .from('versions')
        .update({ category_id: nextCategoryId || null })
        .eq('id', versionId)
        .eq('company_id', companyId)
      if (updateError) {
        setError(updateError.code === '23505' ? 'Ya existe esa versión en esa categoría.' : messageFrom(updateError))
        return false
      }
      await load()
    }, 'Categoría guardada.')
  }

  function removeVersion(versionId) {
    return run(`remove-${versionId}`, async () => {
      setError('')
      const { error: clearError } = await supabase
        .from('tickets')
        .update({ version_id: null })
        .eq('version_id', versionId)
        .eq('company_id', companyId)
      if (clearError) {
        setError(messageFrom(clearError))
        return false
      }
      const { error: deleteError } = await supabase
        .from('versions')
        .delete()
        .eq('id', versionId)
        .eq('company_id', companyId)
      if (deleteError) {
        setError(messageFrom(deleteError))
        return false
      }
      await load()
    }, 'Versión quitada.')
  }

  const loose = available()
  const lanes = [
    ...categories.map((category) => ({
      key: category.id,
      name: category.name,
      versions: versions.filter((version) => version.category_id === category.id),
    })),
    {
      key: 'none',
      name: 'Sin categoría',
      versions: versions.filter((version) => !version.category_id),
    },
  ].filter((lane) => lane.key === 'none' ? lane.versions.length : true)

  return (
    <section className="page">
      <div className="release-head">
        <div>
          <p className="kicker">Versiones</p>
          <h1>Lo que salió en cada entrega.</h1>
        </div>
        {editable && (
          <div className="release-forms">
          <form className="release-new" onSubmit={addCategory}>
            <label className="field">
              <span>Categoría de versión</span>
              <input
                value={categoryName}
                placeholder="Móvil, Dash"
                maxLength={40}
                onChange={(event) => setCategoryName(event.target.value)}
                required
              />
            </label>
            <ActionButton name="front" busy={busy} pending="Creando…" className="btn" type="submit">
              Crear
            </ActionButton>
          </form>
          <form className="release-new" onSubmit={addVersion}>
            <label className="field">
              <span>Categoría</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                <option value="">{categories.length === 0 ? 'Crea Móvil o Dash' : 'Elegir'}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Nueva versión</span>
              <input
                value={name}
                placeholder="Nombre"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <ActionButton name="add" busy={busy} pending="Agregando…" className="btn" type="submit">
              Agregar
            </ActionButton>
          </form>
          </div>
        )}
      </div>
      <Done name="front" mark={mark}>{done}</Done>
      <Done name={mark.startsWith('front-') ? mark : ''} mark={mark}>{done}</Done>
      <Done name="add" mark={mark}>{done}</Done>
      <Alert>{error}</Alert>
      {versions.length === 0 && categories.length === 0 && <p className="quiet">Todavía no hay versiones.</p>}
      {lanes.map((lane) => (
      <section className="release-group" key={lane.key}>
        <header className="release-lane">
          <p className="kicker">{lane.name}</p>
          {editable && lane.key !== 'none' && (
            <ActionButton
              name={`front-${lane.key}`}
              busy={busy}
              pending="…"
              className="text-btn"
              type="button"
              onClick={() => removeCategory(lane.key)}
            >
              Quitar categoría
            </ActionButton>
          )}
        </header>
        {lane.versions.length === 0 && <p className="quiet">Todavía no hay versiones en {lane.name}.</p>}
      <div className="releases">
        {lane.versions.map((version) => {
          const held = inside(version.id)
          const count = held.length === 1 ? '1 ticket' : `${held.length} tickets`
          return (
            <article className="release" key={version.id}>
              <header>
                <div>
                  {editable
                    ? (
                      <label className="field">
                        <span className="quiet">Categoría</span>
                        <select
                          value={version.category_id || ''}
                          onChange={(event) => moveCategory(version.id, event.target.value)}
                        >
                          <option value="">Sin categoría</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                      </label>
                    )
                    : <p className="kicker">{lane.name}</p>}
                  <h2>{version.name}</h2>
                </div>
                <span className="release-count">{count}</span>
              </header>
              {held.length === 0
                ? <p className="quiet">Mete aquí los tickets que se resolvieron en esta entrega.</p>
                : (
                  <ul>
                    {held.map((ticket) => (
                      <li key={ticket.id}>
                        <Link to={`/e/${companyId}/t/${ticket.id}`}>
                          <em>{ticketKey(company.ticket_prefix, ticket.public_number)}</em>
                          <span>{ticket.title}</span>
                        </Link>
                        {editable && (
                          <ActionButton
                            name={`out-${ticket.id}`}
                            busy={busy}
                            pending="…"
                            className="text-btn"
                            type="button"
                            onClick={() => takeOut(ticket.id)}
                          >
                            Quitar
                          </ActionButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              {editable && (
                <form className="release-add" onSubmit={(event) => { event.preventDefault(); place(version.id) }}>
                  <label className="field">
                    <span>Ticket resuelto</span>
                    <select
                      value={picked[version.id] || ''}
                      onChange={(event) => setPicked((current) => ({ ...current, [version.id]: event.target.value }))}
                    >
                      <option value="">{loose.length === 0 ? 'No hay pendientes' : 'Elegir'}</option>
                      {loose.map((ticket) => (
                        <option key={ticket.id} value={ticket.id}>
                          {ticketKey(company.ticket_prefix, ticket.public_number)} {ticket.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ActionButton
                    name={`place-${version.id}`}
                    busy={busy}
                    pending="Metiendo…"
                    className="btn"
                    type="submit"
                    disabled={!picked[version.id]}
                  >
                    Meter
                  </ActionButton>
                </form>
              )}
              {editable && (
                <ActionButton
                  name={`remove-${version.id}`}
                  busy={busy}
                  pending="Quitando…"
                  className="text-btn release-remove"
                  type="button"
                  onClick={() => removeVersion(version.id)}
                >
                  Quitar versión
                </ActionButton>
              )}
            </article>
          )
        })}
      </div>
      </section>
      ))}
    </section>
  )
}
