import { useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { isAdmin, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, Secret, useFeedback, writeClipboard } from '../components/ui'

export function Links() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [links, setLinks] = useState([])
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [error, setError] = useState('')
  const copiedTimer = useRef(0)
  const { busy, done, mark, run } = useFeedback()

  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  function markCopied(id) {
    setCopiedId(id)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopiedId(''), 2400)
  }

  async function load() {
    const { data, error: loadError } = await supabase.from('intake_links').select('id, label, active, hourly_limit, token').eq('company_id', companyId).order('created_at', { ascending: false })
    if (loadError) setError(messageFrom(loadError))
    else setLinks(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  async function create(event) {
    event.preventDefault()
    await run('create', async () => {
      setError('')
      const { data, error: createError } = await supabase.rpc('create_intake_link', {
        p_company_id: companyId,
        p_label: label,
      })
      if (createError) {
        setError(messageFrom(createError))
        return false
      }
      const url = absolutePath(`/i/${data}`)
      setSecret(url)
      await writeClipboard(url)
      setLabel('')
      load()
    }, 'Liga creada y copiada.')
  }

  function copyLink(link) {
    if (link.token) {
      return writeClipboard(absolutePath(`/i/${link.token}`)).then((ok) => {
        if (ok) markCopied(link.id)
      })
    }
    const agreed = window.confirm('Esta liga no quedó guardada. Se crea una dirección nueva y la anterior deja de servir.')
    if (!agreed) return
    return run(`reissue-${link.id}`, async () => {
      setError('')
      const { data, error: reissueError } = await supabase.rpc('reissue_intake_link', { p_link_id: link.id })
      if (reissueError) {
        setError(messageFrom(reissueError))
        return false
      }
      const url = absolutePath(`/i/${data}`)
      setSecret(url)
      const ok = await writeClipboard(url)
      if (ok) markCopied(link.id)
      load()
    }, 'Liga nueva, ya copiada.')
  }

  function toggle(link) {
    const turningOff = link.active
    return run(link.id, async () => {
      setError('')
      const { error: toggleError } = await supabase.rpc('set_intake_active', {
        p_link_id: link.id,
        p_active: !link.active,
      })
      if (toggleError) {
        setError(messageFrom(toggleError))
        return false
      }
      load()
    }, turningOff ? 'Liga apagada.' : 'Liga prendida.')
  }

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Ligas</p>
      <h1>Alta sin cuenta.</h1>
      <p className="quiet">Quien tenga la liga puede registrar un ticket y seguir solo ese.</p>
      <Alert>{error}</Alert>
      <Done name={mark} mark={mark}>{done}</Done>
      <Secret label="Liga de alta" value={secret} copyLabel="Copiar liga" hint="Queda en la lista. Puedes copiarla cuando quieras." />
      <div className="list">
        {links.map((link) => (
          <article className="panel cluster" key={link.id} style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{link.label}</strong>
              <div className="quiet">
                {link.active ? 'Activa' : 'Apagada'} · {link.hourly_limit} por hora
                {link.token ? '' : ' · al copiar, esta dirección se reemplaza'}
              </div>
            </div>
            <div className="cluster">
              <button className="btn quiet" type="button" onClick={() => copyLink(link)} disabled={copiedId === link.id || busy === `reissue-${link.id}`}>
                {copiedId === link.id ? 'Copiado' : busy === `reissue-${link.id}` ? 'Copiando…' : 'Copiar liga'}
              </button>
              <ActionButton
                name={link.id}
                busy={busy}
                pending={link.active ? 'Apagando…' : 'Prendiendo…'}
                className="btn quiet"
                type="button"
                onClick={() => toggle(link)}
              >
                {link.active ? 'Apagar' : 'Prender'}
              </ActionButton>
            </div>
          </article>
        ))}
      </div>
      <form className="panel" onSubmit={create} style={{ marginTop: '1rem' }}>
        <label className="field">
          <span>Nombre de la liga</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <ActionButton name="create" busy={busy} pending="Creando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Crear liga
        </ActionButton>
      </form>
    </section>
  )
}
