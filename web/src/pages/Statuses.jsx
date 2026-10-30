import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { hexColor, isAdmin, laneVars, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, useFeedback } from '../components/ui'

const kinds = [
  ['work', 'Trabajo'],
  ['pause', 'Pausa'],
  ['close', 'Cierre'],
]

function blank() {
  return { key: crypto.randomUUID(), name: '', kind: 'work', weight: 0, color: '#c4a574' }
}

export function Statuses() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [rows, setRows] = useState([])
  const [remap, setRemap] = useState({})
  const [removed, setRemoved] = useState([])
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  useEffect(() => {
    supabase
      .from('statuses')
      .select('id, name, kind, weight, position, color')
      .eq('company_id', companyId)
      .order('position')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(messageFrom(loadError))
        else setRows((data ?? []).map((row) => ({ ...row, key: row.id })))
      })
  }, [companyId])

  const workSum = rows.reduce((sum, row) => sum + (row.kind === 'work' ? Number(row.weight) || 0 : 0), 0)

  function update(key, partial) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...partial } : row)))
  }

  function move(index, delta) {
    const next = [...rows]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setRows(next)
  }

  function remove(index) {
    const row = rows[index]
    if (row.id) setRemoved((current) => [...current, row])
    setRows((current) => current.filter((_, item) => item !== index))
  }

  async function save(event) {
    event.preventDefault()
    if (removed.some((row) => !remap[row.id])) {
      setError('Elige a dónde pasan los tickets de cada estado que quitas.')
      return
    }
    await run('save', async () => {
      setError('')
      const payload = rows.map((row) => ({
        id: row.id ?? null,
        name: row.name,
        kind: row.kind,
        weight: row.kind === 'work' ? Number(row.weight) || 0 : 0,
        color: hexColor(row.color),
      }))
      const { error: saveError } = await supabase.rpc('set_statuses', {
        p_company_id: companyId,
        p_rows: payload,
        p_remap: remap,
      })
      if (saveError) {
        setError(messageFrom(saveError))
        return false
      }
      setRemoved([])
      setRemap({})
      const { data } = await supabase.from('statuses').select('id, name, kind, weight, position, color').eq('company_id', companyId).order('position')
      setRows((data ?? []).map((row) => ({ ...row, key: row.id })))
    }, 'Flujo guardado.')
  }

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <div className="row">
        <div>
          <p className="kicker">Estados</p>
          <h1>El camino del ticket.</h1>
        </div>
        <p className={workSum === 100 ? 'quiet' : 'alert'}>Pesos de trabajo: {workSum} / 100</p>
      </div>
      <Alert>{error}</Alert>
      <form onSubmit={save}>
        <div className="list">
          {rows.map((row, index) => (
            <div className="status-row" key={row.key} style={laneVars(row.color)}>
              <div className="cluster">
                <button className="btn quiet" type="button" onClick={() => move(index, -1)} aria-label="Subir">↑</button>
                <button className="btn quiet" type="button" onClick={() => move(index, 1)} aria-label="Bajar">↓</button>
              </div>
              <label className="field">
                <span>Nombre</span>
                <input value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} required />
              </label>
              <label className="field">
                <span>Tipo</span>
                <select value={row.kind} onChange={(event) => update(row.key, { kind: event.target.value })}>
                  {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Peso</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  disabled={row.kind !== 'work'}
                  value={row.kind === 'work' ? row.weight : 0}
                  onChange={(event) => update(row.key, { weight: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Color</span>
                <input
                  className="color-input"
                  type="color"
                  value={hexColor(row.color)}
                  aria-label={`Color de ${row.name || 'estado'}`}
                  onChange={(event) => update(row.key, { color: event.target.value })}
                />
              </label>
              <button className="btn danger" type="button" onClick={() => remove(index)}>Quitar</button>
            </div>
          ))}
        </div>
        {removed.map((row) => (
          <label className="field" key={row.id} style={{ marginTop: '0.8rem' }}>
            <span>Tickets de {row.name}</span>
            <select value={remap[row.id] || ''} onChange={(event) => setRemap({ ...remap, [row.id]: event.target.value })} required>
              <option value="">Mover a…</option>
              {rows.filter((item) => item.id && item.kind !== 'pause').map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ))}
        <div className="cluster" style={{ marginTop: '1rem' }}>
          <button className="btn quiet" type="button" onClick={() => setRows((current) => [...current, blank()])}>Agregar estado</button>
          <ActionButton name="save" busy={busy} pending="Guardando…" className="btn" type="submit">
            Guardar flujo
          </ActionButton>
        </div>
        <Done name="save" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
