import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert } from '../components/ui'

const weekday = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function keyOf(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [sprints, setSprints] = useState([])
  const [name, setName] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase
      .from('sprints')
      .select('id, name, starts_on, ends_on')
      .eq('company_id', companyId)
      .order('starts_on')
    if (loadError) setError(messageFrom(loadError))
    else setSprints(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  const weeks = useMemo(() => weeksOf(cursor.year, cursor.month), [cursor])
  const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(cursor.year, cursor.month, 1))

  function shift(delta) {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  async function createSprint(event) {
    event.preventDefault()
    setError('')
    const { error: insertError } = await supabase.from('sprints').insert({
      company_id: companyId,
      name,
      starts_on: starts,
      ends_on: ends,
    })
    if (insertError) setError(messageFrom(insertError))
    else {
      setName('')
      setStarts('')
      setEnds('')
      load()
    }
  }

  return (
    <section className="page">
      <div className="row">
        <div>
          <p className="kicker">Calendario</p>
          <h1 style={{ textTransform: 'capitalize' }}>{title}</h1>
        </div>
        <div className="cluster">
          <button className="btn quiet" type="button" onClick={() => shift(-1)}>Anterior</button>
          <button className="btn quiet" type="button" onClick={() => shift(1)}>Siguiente</button>
        </div>
      </div>
      <Alert>{error}</Alert>
      <div className="days" style={{ marginBottom: '0.4rem' }}>
        {weekday.map((day) => <span key={day} className="quiet">{day}</span>)}
      </div>
      {weeks.map((days) => (
        <div className="calendar-week" key={keyOf(days[0])}>
          <div className="days">
            {days.map((day) => (
              <div key={keyOf(day)} className={day.getMonth() === cursor.month ? 'day' : 'day out'}>
                {day.getDate()}
              </div>
            ))}
          </div>
          {sprints.map((sprint) => {
            let from = -1
            let to = -1
            days.forEach((day, index) => {
              const key = keyOf(day)
              if (key >= sprint.starts_on && key <= sprint.ends_on) {
                if (from < 0) from = index
                to = index
              }
            })
            if (from < 0) return null
            return (
              <div className="bar-row" key={sprint.id}>
                <div className="bar" style={{ gridColumn: `${from + 1} / ${to + 2}` }}>{sprint.name}</div>
              </div>
            )
          })}
        </div>
      ))}
      <form className="panel" onSubmit={createSprint} style={{ marginTop: '1rem' }}>
        <h2>Nuevo sprint</h2>
        <div className="grid-3" style={{ marginTop: '0.8rem' }}>
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
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Agregar</button>
      </form>
    </section>
  )
}
