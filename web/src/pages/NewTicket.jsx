import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { canEdit, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, Secret, useFeedback } from '../components/ui'

export function NewTicket() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function createTicket(event) {
    event.preventDefault()
    await run('create', async () => {
      setError('')
      const { data, error: createError } = await supabase.rpc('create_ticket', {
        p_company_id: companyId,
        p_title: title,
        p_body: body,
      })
      if (createError) {
        setError(messageFrom(createError))
        return false
      }
      setTitle('')
      setBody('')
      setSecret(absolutePath(`/t/${data.viewToken}`))
    }, 'Ticket registrado.')
  }

  if (!canEdit(role)) {
    return (
      <section className="page">
        <p className="kicker"><Link to={`/e/${companyId}`}>Tablero</Link></p>
        <p className="quiet">Solo puedes ver el tablero.</p>
      </section>
    )
  }

  return (
    <section className="page">
      <p className="kicker"><Link to={`/e/${companyId}`}>Tablero</Link></p>
      <h1>Nuevo ticket</h1>
      <Alert>{error}</Alert>
      <Secret label="Liga de seguimiento" value={secret} copyLabel="Copiar liga" />
      <form className="panel" onSubmit={createTicket} style={{ marginTop: '1rem', maxWidth: '36rem' }}>
        <label className="field">
          <span>Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="field" style={{ marginTop: '0.8rem' }}>
          <span>Detalle</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <ActionButton name="create" busy={busy} pending="Registrando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Registrar
        </ActionButton>
        <Done name="create" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
