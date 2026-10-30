import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert, Secret } from '../components/ui'

export function Links() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [links, setLinks] = useState([])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase.from('intake_links').select('id, label, active, hourly_limit').eq('company_id', companyId).order('created_at', { ascending: false })
    if (loadError) setError(messageFrom(loadError))
    else setLinks(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  async function create(event) {
    event.preventDefault()
    setError('')
    const { data, error: createError } = await supabase.rpc('create_intake_link', {
      p_company_id: companyId,
      p_label: label,
    })
    if (createError) setError(messageFrom(createError))
    else {
      setSecret(absolutePath(`/i/${data}`))
      setLabel('')
      load()
    }
  }

  async function toggle(link) {
    const { error: toggleError } = await supabase.rpc('set_intake_active', {
      p_link_id: link.id,
      p_active: !link.active,
    })
    if (toggleError) setError(messageFrom(toggleError))
    else load()
  }

  if (role === 'dev') return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Ligas</p>
      <h1>Alta sin cuenta.</h1>
      <p className="quiet">Quien tenga la liga puede registrar un ticket y seguir solo ese.</p>
      <Alert>{error}</Alert>
      <Secret label="Liga de alta" value={secret} />
      <div className="list">
        {links.map((link) => (
          <article className="panel cluster" key={link.id} style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{link.label}</strong>
              <div className="quiet">{link.active ? 'Activa' : 'Apagada'} · {link.hourly_limit} por hora</div>
            </div>
            <button className="btn quiet" type="button" onClick={() => toggle(link)}>
              {link.active ? 'Apagar' : 'Prender'}
            </button>
          </article>
        ))}
      </div>
      <form className="panel" onSubmit={create} style={{ marginTop: '1rem' }}>
        <label className="field">
          <span>Nombre de la liga</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Crear liga</button>
      </form>
    </section>
  )
}
