import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { messageFrom, roleLabel } from '../lib/format'
import { ActionButton, Alert, useFeedback } from '../components/ui'

export function Companies() {
  const { session } = useOutletContext()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')
  const { busy, run } = useFeedback()

  async function load() {
    const { data, error: loadError } = await supabase
      .from('company_members')
      .select('role, companies(id, name, slug)')
      .eq('user_id', session.user.id)
    if (loadError) setError(messageFrom(loadError))
    else setRows(data ?? [])
  }

  useEffect(() => { load() }, [session.user.id])

  async function createCompany(event) {
    event.preventDefault()
    await run('create', async () => {
      setError('')
      const { data, error: createError } = await supabase.rpc('create_company', {
        p_name: name,
        p_slug: slug,
      })
      if (createError) {
        setError(messageFrom(createError))
        return false
      }
      navigate(`/e/${data}`)
    })
  }

  function signOut() {
    return run('leave', async () => {
      await supabase.auth.signOut()
      navigate('/entrar')
    })
  }

  return (
    <main className="main page">
      <div className="row">
        <div>
          <p className="kicker">Empresas</p>
          <h1>Tus mesas de trabajo.</h1>
        </div>
        <ActionButton name="leave" busy={busy} pending="Saliendo…" className="btn quiet" type="button" onClick={signOut}>
          Salir
        </ActionButton>
      </div>
      <Alert>{error}</Alert>
      <div className="companies">
        {rows.map((row) => (
          <Link key={row.companies.id} className="company-card" to={`/e/${row.companies.id}`}>
            <strong>{row.companies.name}</strong>
            <span className="quiet">{roleLabel[row.role]}</span>
          </Link>
        ))}
      </div>
      <form className="panel" onSubmit={createCompany} style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
        <h2>Nueva empresa</h2>
        <div className="grid-2" style={{ marginTop: '0.8rem' }}>
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="field">
            <span>Liga</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
          </label>
        </div>
        <ActionButton name="create" busy={busy} pending="Creando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Crear
        </ActionButton>
      </form>
    </main>
  )
}
