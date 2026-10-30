import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert, Secret } from '../components/ui'

export function Automation() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const [policy, setPolicy] = useState(company.policy)
  const [tokens, setTokens] = useState([])
  const [name, setName] = useState('Cursor')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')

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

  async function savePolicy(event) {
    event.preventDefault()
    setError('')
    const { error: updateError } = await supabase.from('companies').update({ policy }).eq('id', companyId)
    if (updateError) setError(messageFrom(updateError))
  }

  async function createToken(event) {
    event.preventDefault()
    setError('')
    const { data, error: tokenError } = await supabase.rpc('create_agent_token', {
      p_company_id: companyId,
      p_name: name,
    })
    if (tokenError) setError(messageFrom(tokenError))
    else {
      setSecret(data)
      load()
    }
  }

  async function revoke(id) {
    const { error: revokeError } = await supabase.rpc('revoke_agent_token', { p_token_id: id })
    if (revokeError) setError(messageFrom(revokeError))
    else load()
  }

  const auto = policy.autoExecute

  if (role === 'dev') return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Automatización</p>
      <h1>Lo que el agente puede tomar.</h1>
      <Alert>{error}</Alert>
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
      <form className="panel" onSubmit={savePolicy}>
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
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Guardar política</button>
      </form>
      <form className="panel" onSubmit={createToken} style={{ marginTop: '0.8rem' }}>
        <label className="field">
          <span>Nombre del token</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <button className="btn quiet" type="submit" style={{ marginTop: '0.8rem' }}>Crear token</button>
      </form>
      <ul className="timeline">
        {tokens.map((token) => (
          <li key={token.id} className="cluster" style={{ justifyContent: 'space-between' }}>
            <span>{token.name}{token.revoked_at ? ' · revocado' : ''}</span>
            {!token.revoked_at && <button className="btn quiet" type="button" onClick={() => revoke(token.id)}>Revocar</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}
