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
  const [source, setSource] = useState('main')
  const [branch, setBranch] = useState('develop')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const { data, error: loadError } = await supabase
      .from('repos')
      .select('id, github_full_name, source_branch, default_branch')
      .eq('company_id', companyId)
      .order('github_full_name')
      .order('source_branch')
      .order('default_branch')
    if (loadError) setError(messageFrom(loadError))
    else setRepos(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  async function add(event) {
    event.preventDefault()
    await run('add', async () => {
      setError('')
      const github = name.trim()
      const born = source.trim()
      const lands = branch.trim()
      if (!github || !born || !lands) {
        setError('Indica el repo y las dos ramas.')
        return false
      }
      const { error: insertError } = await supabase.from('repos').insert({
        company_id: companyId,
        github_full_name: github,
        source_branch: born,
        default_branch: lands,
      })
      if (insertError) {
        setError(insertError.code === '23505' ? 'Ya existe ese repo con las mismas ramas.' : messageFrom(insertError))
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
      <h1>De dónde nace la rama y a dónde entra el pull.</h1>
      <Alert>{error}</Alert>
      <div className="list">
        {repos.map((repo) => (
          <article className="panel" key={repo.id}>
            <strong>{repo.github_full_name}</strong>
            <div className="quiet">Nace de {repo.source_branch}. El pull apunta a {repo.default_branch}.</div>
          </article>
        ))}
      </div>
      <form className="panel" onSubmit={add} style={{ marginTop: '1rem' }}>
        <div className="grid-3">
          <label className="field">
            <span>GitHub</span>
            <input value={name} placeholder="org/repo" onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="field">
            <span>Nace de</span>
            <input value={source} onChange={(event) => setSource(event.target.value)} required />
          </label>
          <label className="field">
            <span>El pull apunta a</span>
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
