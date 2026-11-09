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
  const [objectiveId, setObjectiveId] = useState('')
  const [objectiveName, setObjectiveName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [objectives, setObjectives] = useState([])
  const [categories, setCategories] = useState([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const { busy, run } = useFeedback()

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('objectives').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      sprintId
        ? supabase.from('sprints').select('id, name, starts_on, ends_on, objective_id').eq('id', sprintId).eq('company_id', companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]).then(([objectiveRes, categoryRes, sprintRes]) => {
      if (!alive) return
      const failed = [objectiveRes, categoryRes, sprintRes].find((item) => item.error)
      if (failed) {
        setError(messageFrom(failed.error))
        return
      }
      if (sprintId && !sprintRes.data) {
        setError('No está ese sprint.')
        return
      }
      setObjectives(objectiveRes.data ?? [])
      setCategories(categoryRes.data ?? [])
      if (sprintRes.data) {
        setName(sprintRes.data.name)
        setStarts(sprintRes.data.starts_on)
        setEnds(sprintRes.data.ends_on)
        setObjectiveId(sprintRes.data.objective_id || '')
      }
      setReady(true)
    })
    return () => { alive = false }
  }, [companyId, sprintId])

  async function saveSprint(event) {
    event.preventDefault()
    const wasEditing = Boolean(sprintId)
    await run('save', async () => {
      setError('')
      let nextObjective = objectiveId || null
      if (objectiveId === 'new') {
        const trimmed = objectiveName.trim()
        if (!trimmed) {
          setError('El objetivo lleva nombre.')
          return false
        }
        const { data: created, error: objectiveError } = await supabase.from('objectives').insert({
          company_id: companyId,
          name: trimmed,
          category_id: categoryId || null,
        }).select('id').single()
        if (objectiveError) {
          setError(objectiveError.code === '23505' ? 'Ya existe ese objetivo.' : messageFrom(objectiveError))
          return false
        }
        nextObjective = created.id
      }
      const payload = { name, starts_on: starts, ends_on: ends, objective_id: nextObjective }
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
            <label className="field">
              <span>Objetivo</span>
              <select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)}>
                <option value="">Sin objetivo</option>
                {objectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>{objective.name}</option>
                ))}
                <option value="new">Nuevo objetivo</option>
              </select>
            </label>
            {objectiveId === 'new' && (
              <>
                <label className="field">
                  <span>Nombre del objetivo</span>
                  <input value={objectiveName} onChange={(event) => setObjectiveName(event.target.value)} required />
                </label>
                <label className="field">
                  <span>Categoría</span>
                  <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">Sin categoría</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
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
