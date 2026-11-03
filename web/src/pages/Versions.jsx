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
  const [tickets, setTickets] = useState([])
  const [name, setName] = useState('')
  const [picked, setPicked] = useState({})
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [versionRes, ticketRes] = await Promise.all([
      supabase.from('versions').select('id, name, created_at').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('ticket_rows').select('id, public_number, title, status_kind, version_id, rank').eq('company_id', companyId).order('rank'),
    ])
    const failed = [versionRes, ticketRes].find((item) => item.error)
    if (failed) setError(messageFrom(failed.error))
    else {
      setVersions(versionRes.data ?? [])
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

  async function addVersion(event) {
    event.preventDefault()
    await run('add', async () => {
      setError('')
      if (!name.trim()) {
        setError('La versión lleva nombre.')
        return false
      }
      const { error: insertError } = await supabase.from('versions').insert({
        company_id: companyId,
        name: name.trim(),
      })
      if (insertError) {
        setError(insertError.code === '23505' ? 'Ya existe una versión con ese nombre.' : messageFrom(insertError))
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

  return (
    <section className="page">
      <p className="kicker">Versiones</p>
      <h1>Lo que salió en cada entrega.</h1>
      <Alert>{error}</Alert>
      {versions.length === 0 && <p className="quiet">Todavía no hay versiones.</p>}
      <div className="list">
        {versions.map((version) => {
          const held = inside(version.id)
          return (
            <article className="panel" key={version.id}>
              <div className="row">
                <strong>{version.name}</strong>
                <span className="quiet">{held.length === 1 ? '1 ticket' : `${held.length} tickets`}</span>
              </div>
              {held.length === 0
                ? <p className="quiet">Sin tickets. Mete aquí los que se resolvieron en esta versión.</p>
                : (
                  <ul className="version-tickets">
                    {held.map((ticket) => (
                      <li key={ticket.id}>
                        <Link to={`/e/${companyId}/t/${ticket.id}`}>
                          {ticketKey(company.ticket_prefix, ticket.public_number)} {ticket.title}
                        </Link>
                        {editable && (
                          <ActionButton
                            name={`out-${ticket.id}`}
                            busy={busy}
                            pending="Quitando…"
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
                <div className="cluster" style={{ marginTop: '0.8rem' }}>
                  <select
                    value={picked[version.id] || ''}
                    onChange={(event) => setPicked((current) => ({ ...current, [version.id]: event.target.value }))}
                  >
                    <option value="">Ticket resuelto</option>
                    {loose.map((ticket) => (
                      <option key={ticket.id} value={ticket.id}>
                        {ticketKey(company.ticket_prefix, ticket.public_number)} {ticket.title}
                      </option>
                    ))}
                  </select>
                  <ActionButton
                    name={`place-${version.id}`}
                    busy={busy}
                    pending="Metiendo…"
                    className="btn"
                    type="button"
                    onClick={() => place(version.id)}
                    disabled={!picked[version.id]}
                  >
                    Meter
                  </ActionButton>
                  <ActionButton
                    name={`remove-${version.id}`}
                    busy={busy}
                    pending="Quitando…"
                    className="btn danger"
                    type="button"
                    onClick={() => removeVersion(version.id)}
                  >
                    Quitar versión
                  </ActionButton>
                </div>
              )}
              {editable && loose.length === 0 && (
                <p className="quiet" style={{ marginTop: '0.45rem' }}>No hay tickets resueltos fuera de una versión.</p>
              )}
            </article>
          )
        })}
      </div>
      {editable && (
        <form className="panel" onSubmit={addVersion} style={{ marginTop: '1rem', maxWidth: '28rem' }}>
          <label className="field">
            <span>Nueva versión</span>
            <input
              value={name}
              placeholder="1.4"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <ActionButton name="add" busy={busy} pending="Agregando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
            Agregar
          </ActionButton>
          <Done name="add" mark={mark}>{done}</Done>
        </form>
      )}
    </section>
  )
}
