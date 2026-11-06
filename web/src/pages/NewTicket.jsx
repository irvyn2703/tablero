import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { canEdit, kindName, messageFrom } from '../lib/format'
import { takeFiles, uploadTicketFiles } from '../lib/files'
import { useLogoUrl } from '../lib/logo'
import { FilePicker } from '../components/Files'
import { ActionButton, Alert, Done, KindChoice, Secret, useFeedback } from '../components/ui'

export function NewTicket() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const logoUrl = useLogoUrl(company?.logo_path)
  const [kind, setKind] = useState('ticket')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [madeId, setMadeId] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  function pickFiles(list) {
    const picked = takeFiles(files, list)
    setFiles(picked.files)
    setError(picked.error)
  }

  async function sendFiles(ticketId, chosen) {
    const failed = await uploadTicketFiles({ ticketId, files: chosen })
    setFiles(failed.map((item) => item.file))
    if (failed.length === 0) {
      setMadeId('')
      return true
    }
    setError(failed.map((item) => `${item.file.name}: ${item.error}`).join(' '))
    return false
  }

  async function createTicket(event) {
    event.preventDefault()
    const retrying = Boolean(madeId)
    await run('create', async () => {
      setError('')
      if (retrying) return sendFiles(madeId, files)
      const { data, error: createError } = await supabase.rpc('create_ticket', {
        p_company_id: companyId,
        p_title: title,
        p_body: [`Tipo\n${kindName(kind)}`, body.trim()].filter(Boolean).join('\n\n'),
      })
      if (createError) {
        setError(messageFrom(createError))
        return false
      }
      setKind('ticket')
      setTitle('')
      setBody('')
      setSecret(absolutePath(`/t/${data.viewToken}`))
      if (files.length === 0) return
      setMadeId(data.id)
      return sendFiles(data.id, files)
    }, retrying ? 'Archivos subidos.' : 'Ticket registrado.')
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
      <p className="brand-name">
        {logoUrl && <img className="report-logo" src={logoUrl} alt="" />}
        <Link className="kicker" to={`/e/${companyId}`}>{company.name}</Link>
      </p>
      <h1>Nuevo ticket</h1>
      <Alert>{error}</Alert>
      <Secret label="Liga de seguimiento" value={secret} copyLabel="Copiar liga" />
      <form className="panel" onSubmit={createTicket} style={{ marginTop: '1rem', maxWidth: '36rem' }}>
        <KindChoice value={kind} onChange={setKind} />
        <label className="field">
          <span>Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required={!madeId} disabled={Boolean(madeId)} />
        </label>
        <label className="field" style={{ marginTop: '0.8rem' }}>
          <span>Detalle</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={Boolean(madeId)} />
        </label>
        <FilePicker
          files={files}
          disabled={Boolean(busy)}
          onPick={pickFiles}
          onRemove={(index) => setFiles((current) => current.filter((_, item) => item !== index))}
        />
        <ActionButton name="create" busy={busy} pending={madeId ? 'Subiendo…' : 'Registrando…'} className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          {madeId ? 'Reintentar archivos' : 'Registrar'}
        </ActionButton>
        <Done name="create" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
