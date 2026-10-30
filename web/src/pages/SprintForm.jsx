import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canEdit, messageFrom } from '../lib/format'
import { ActionButton, Alert, useFeedback } from '../components/ui'

export function SprintForm() {
  const { companyId, sprintId } = useParams()
  const { role } = useOutletContext()
  const navigate = useNavigate()
  const back = `/e/${companyId}/calendario`
  const [name, setName] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [ready, setReady] = useState(!sprintId)
  const [error, setError] = useState('')
  const { busy, run } = useFeedback()

  useEffect(() => {
    if (!sprintId) return undefined
    let alive = true
    supabase
      .from('sprints')
      .select('id, name, starts_on, ends_on')
      .eq('id', sprintId)
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!alive) return
        if (loadError || !data) {
          setError(loadError ? messageFrom(loadError) : 'No está ese sprint.')
          return
        }
        setName(data.name)
        setStarts(data.starts_on)
        setEnds(data.ends_on)
        setReady(true)
      })
    return () => { alive = false }
  }, [companyId, sprintId])

  async function saveSprint(event) {
    event.preventDefault()
    const wasEditing = Boolean(sprintId)
    await run('save', async () => {
      setError('')
      const payload = { name, starts_on: starts, ends_on: ends }
      const query = sprintId
        ? supabase.from('sprints').update(payload).eq('id', sprintId).eq('company_id', companyId)
        : supabase.from('sprints').insert({ ...payload, company_id: companyId })
      const { error: saveError } = await query
      if (saveError) {
        setError(messageFrom(saveError))
        return false
      }
      navigate(back, { state: { notice: wasEditing ? 'Sprint guardado.' : 'Sprint agregado.' } })
    })
  }

  function removeSprint() {
    return run('remove', async () => {
      setError('')
      const { error: clearError } = await supabase.from('tickets').update({ sprint_id: null }).eq('sprint_id', sprintId).eq('company_id', companyId)
      if (clearError) {
        setError(messageFrom(clearError))
        return false
      }
      const { error: deleteError } = await supabase.from('sprints').delete().eq('id', sprintId).eq('company_id', companyId)
      if (deleteError) {
        setError(messageFrom(deleteError))
        return false
      }
      navigate(back, { state: { notice: 'Sprint quitado.' } })
    })
  }

  if (!canEdit(role)) {
    return (
      <section className="page">
        <p className="kicker"><Link to={back}>Calendario</Link></p>
        <p className="quiet">Solo puedes ver el calendario.</p>
      </section>
    )
  }

  return (
    <section className="page">
      <p className="kicker"><Link to={back}>Calendario</Link></p>
      <h1>{sprintId ? 'Editar sprint' : 'Nuevo sprint'}</h1>
      <Alert>{error}</Alert>
      {!ready && !error && <p className="quiet">Un momento.</p>}
      {ready && (
        <form className="panel" onSubmit={saveSprint} style={{ marginTop: '1rem', maxWidth: '40rem' }}>
          <div className="grid-3">
            <label className="field">
              <span>Nombre</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="field">
              <span>Inicio</span>
              <input type="date" value={starts} onChange={(event) => setStarts(event.target.value)} required />
            </label>
            <label className="field">
              <span>Fin</span>
              <input type="date" value={ends} onChange={(event) => setEnds(event.target.value)} required />
            </label>
          </div>
          <div className="cluster" style={{ marginTop: '0.8rem' }}>
            <ActionButton name="save" busy={busy} pending={sprintId ? 'Guardando…' : 'Agregando…'} className="btn" type="submit">
              {sprintId ? 'Guardar' : 'Agregar'}
            </ActionButton>
            {sprintId && (
              <ActionButton name="remove" busy={busy} pending="Quitando…" className="btn danger" type="button" onClick={removeSprint}>
                Quitar
              </ActionButton>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
