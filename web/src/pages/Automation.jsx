import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isAdmin, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, Secret, useFeedback } from '../components/ui'

export function Automation() {
  const { companyId } = useParams()
  const { company, role, patchCompany } = useOutletContext()
  const [policy, setPolicy] = useState(company.policy)
  const [prefix, setPrefix] = useState(company.ticket_prefix || '')
  const [tokens, setTokens] = useState([])
  const [name, setName] = useState('Cursor')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const { data, error: loadError } = await supabase
      .from('agent_tokens')
      .select('id, name, revoked_at, last_used_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
    if (loadError) setError(messageFrom(loadError))
    else setTokens(data ?? [])
  }

  useEffect(() => { load() }, [companyId])

  async function savePrefix(event) {
    event.preventDefault()
    await run('prefix', async () => {
      setError('')
      const clean = prefix.trim().toUpperCase()
      if (clean && !/^[A-Z][A-Z0-9]{0,9}$/.test(clean)) {
        setError('La clave usa de 1 a 10 letras o números, y empieza con letra.')
        return false
      }
      const { error: updateError } = await supabase.from('companies').update({ ticket_prefix: clean }).eq('id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      setPrefix(clean)
      patchCompany({ ticket_prefix: clean })
    }, 'Clave guardada.')
  }

  async function savePolicy(event) {
    event.preventDefault()
    await run('policy', async () => {
      setError('')
      const { error: updateError } = await supabase.from('companies').update({ policy }).eq('id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
    }, 'Política guardada.')
  }

  async function createToken(event) {
    event.preventDefault()
    await run('token', async () => {
      setError('')
      const { data, error: tokenError } = await supabase.rpc('create_agent_token', {
        p_company_id: companyId,
        p_name: name,
      })
      if (tokenError) {
        setError(messageFrom(tokenError))
        return false
      }
      setSecret(data)
      load()
    }, 'Token creado.')
  }

  function revoke(id) {
    return run(id, async () => {
      setError('')
      const { error: revokeError } = await supabase.rpc('revoke_agent_token', { p_token_id: id })
      if (revokeError) {
        setError(messageFrom(revokeError))
        return false
      }
      load()
    }, 'Token revocado.')
  }

  const auto = policy.autoExecute

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Automatización</p>
      <h1>Lo que el agente puede tomar.</h1>
      <Alert>{error}</Alert>
      <Done name={mark} mark={mark}>{done}</Done>
      <Secret label="Token del agente" value={secret} />
      {secret && (
        <pre className="note secret">{`{
  "tablero": {
    "command": "node",
    "args": ["ruta/a/tablero/mcp/src/index.js"],
    "env": {
      "SUPABASE_URL": "…",
      "SUPABASE_ANON_KEY": "…",
      "TABLERO_TOKEN": "${secret}"
    }
  }
}`}</pre>
      )}
      <form className="panel" onSubmit={savePrefix} style={{ maxWidth: '24rem' }}>
        <label className="field">
          <span>Clave</span>
          <input
            value={prefix}
            maxLength={10}
            placeholder="FTCK"
            onChange={(event) => setPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
          />
        </label>
        <p className="quiet" style={{ marginTop: '0.6rem' }}>
          {prefix ? `Los tickets se ven como ${prefix}-1. Esa es la rama.` : 'Sin clave, los tickets se ven como #1.'}
        </p>
        <ActionButton name="prefix" busy={busy} pending="Guardando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Guardar clave
        </ActionButton>
      </form>
      <form className="panel" onSubmit={savePolicy} style={{ marginTop: '0.8rem' }}>
        <label className="cluster">
          <input
            type="checkbox"
            checked={auto.enabled}
            onChange={(event) => setPolicy({ autoExecute: { ...auto, enabled: event.target.checked } })}
          />
          Permitir que el primero de la cola se ejecute solo
        </label>
        <div className="grid-2" style={{ marginTop: '0.8rem' }}>
          <label className="field">
            <span>Tamaño máximo</span>
            <select
              value={auto.maxEstimate}
              onChange={(event) => setPolicy({ autoExecute: { ...auto, maxEstimate: event.target.value } })}
            >
              <option value="xs">Muy simple</option>
              <option value="s">Simple</option>
              <option value="m">Mediano</option>
              <option value="l">Grande</option>
            </select>
          </label>
          <label className="field">
            <span>Autonomía</span>
            <select
              value={auto.autonomy}
              onChange={(event) => setPolicy({ autoExecute: { ...auto, autonomy: event.target.value } })}
            >
              <option value="pull">Abrir pull</option>
              <option value="suggest">Sugerir</option>
              <option value="human">Solo humano</option>
            </select>
          </label>
        </div>
        <ActionButton name="policy" busy={busy} pending="Guardando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Guardar política
        </ActionButton>
      </form>
      <form className="panel" onSubmit={createToken} style={{ marginTop: '0.8rem' }}>
        <label className="field">
          <span>Nombre del token</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <ActionButton name="token" busy={busy} pending="Creando…" className="btn quiet" type="submit" style={{ marginTop: '0.8rem' }}>
          Crear token
        </ActionButton>
      </form>
      <ul className="timeline">
        {tokens.map((token) => (
          <li key={token.id} className="cluster" style={{ justifyContent: 'space-between' }}>
            <span>{token.name}{token.revoked_at ? ' · revocado' : ''}</span>
            {!token.revoked_at && (
              <ActionButton name={token.id} busy={busy} pending="Revocando…" className="btn quiet" type="button" onClick={() => revoke(token.id)}>
                Revocar
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
