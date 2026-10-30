import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isAdmin, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, useFeedback } from '../components/ui'

export function Repos() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [repos, setRepos] = useState([])
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('develop')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const { data, error: loadError } = await supabase.from('repos').select('id, github_full_name, default_branch').eq('company_id', companyId)
    if (loadError) setError(messageFrom(loadError))
    else setRepos(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  async function add(event) {
    event.preventDefault()
    await run('add', async () => {
      setError('')
      const { error: insertError } = await supabase.from('repos').insert({
        company_id: companyId,
        github_full_name: name,
        default_branch: branch,
      })
      if (insertError) {
        setError(messageFrom(insertError))
        return false
      }
      setName('')
      load()
    }, 'Repo agregado.')
  }

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Repos</p>
      <h1>Dónde se abre el pull.</h1>
      <Alert>{error}</Alert>
      <div className="list">
        {repos.map((repo) => (
          <article className="panel" key={repo.id}>
            <strong>{repo.github_full_name}</strong>
            <div className="quiet">Rama base {repo.default_branch}</div>
          </article>
        ))}
      </div>
      <form className="panel" onSubmit={add} style={{ marginTop: '1rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>GitHub</span>
            <input value={name} placeholder="org/repo" onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="field">
            <span>Rama base</span>
            <input value={branch} onChange={(event) => setBranch(event.target.value)} required />
          </label>
        </div>
        <ActionButton name="add" busy={busy} pending="Agregando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Agregar
        </ActionButton>
        <Done name="add" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
