import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { absolutePath, configured, supabase } from '../lib/supabase'
import { kindName, messageFrom } from '../lib/format'
import { takeFiles, uploadTicketFiles } from '../lib/files'
import { FilePicker } from '../components/Files'
import { ActionButton, Alert, KindChoice, Secret, useFeedback } from '../components/ui'

const forms = {
  ticket: {
    intro: 'Cuéntanos qué pasó. Al enviarlo recibes una liga para ver el avance, sin crear cuenta.',
    questions: [
      ['intent', 'Qué intentabas hacer', false],
      ['happened', 'Qué pasó', true],
      ['expected', 'Qué esperabas', false],
      ['where', 'Dónde', false],
      ['steps', 'Pasos para verlo otra vez', false],
      ['since', 'Desde cuándo, y a quién le pasa', false],
    ],
  },
  request: {
    intro: 'Cuéntanos la mejora o la idea. Al enviarlo recibes una liga para ver el avance, sin crear cuenta.',
    questions: [
      ['want', 'Qué quieres que se pueda hacer', true],
      ['why', 'Por qué hace falta', false],
      ['how', 'Cómo lo imaginas', false],
      ['who', 'A quién le serviría', false],
    ],
  },
}

const tall = new Set(['happened', 'steps', 'want', 'how'])

function reportBody(kind, answers) {
  const lines = [['Tipo', kindName(kind)]]
  forms[kind].questions.forEach(([key, label]) => {
    const value = answers[key].trim()
    if (value) lines.push([label, value])
  })
  return lines.map(([label, value]) => `${label}\n${value}`).join('\n\n')
}

export function Intake() {
  const { token } = useParams()
  const [heading, setHeading] = useState(null)
  const [kind, setKind] = useState('ticket')
  const [title, setTitle] = useState('')
  const [answers, setAnswers] = useState({
    intent: '',
    happened: '',
    expected: '',
    where: '',
    steps: '',
    since: '',
    want: '',
    why: '',
    how: '',
    who: '',
  })
  const [email, setEmail] = useState('')
  const [files, setFiles] = useState([])
  const [viewToken, setViewToken] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const { busy, run } = useFeedback()

  useEffect(() => {
    if (!supabase) return
    supabase.rpc('read_intake', { p_token: token }).then(({ data, error: readError }) => {
      if (readError) setError(messageFrom(readError))
      else setHeading(data)
    })
  }, [token])

  function setAnswer(key, value) {
    setAnswers((current) => ({ ...current, [key]: value }))
  }

  function pickFiles(list) {
    const picked = takeFiles(files, list)
    setFiles(picked.files)
    setError(picked.error)
  }

  async function sendFiles(ticketToken, chosen) {
    const failed = await uploadTicketFiles({ viewToken: ticketToken, files: chosen })
    setFiles(failed.map((item) => item.file))
    if (failed.length === 0) return true
    setError(failed.map((item) => `${item.file.name}: ${item.error}`).join(' '))
    return false
  }

  async function submit(event) {
    event.preventDefault()
    await run('send', async () => {
      setError('')
      if (viewToken) return sendFiles(viewToken, files)
      const body = reportBody(kind, answers)
      if (body.length > 8000) {
        setError('El reporte es demasiado largo. Recórtalo un poco.')
        return false
      }
      const { data, error: createError } = await supabase.rpc('create_ticket_from_intake', {
        p_token: token,
        p_title: title,
        p_body: body,
        p_email: email || null,
      })
      if (createError) {
        setError(messageFrom(createError))
        return false
      }
      setViewToken(data.viewToken)
      setLink(absolutePath(`/t/${data.viewToken}`))
      if (files.length === 0) return
      return sendFiles(data.viewToken, files)
    })
  }

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">{heading?.companyName || 'Tablero'}</p>
      <h1>{heading?.label || 'Nuevo ticket'}</h1>
      <p className="quiet">{forms[kind].intro}</p>
      <Alert>{error}</Alert>
      <Secret label="Tu liga de seguimiento" value={link} copyLabel="Copiar liga" />
      {!link && (
        <form onSubmit={submit}>
          <KindChoice value={kind} onChange={setKind} />
          <label className="field">
            <span>Título</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
          </label>
          {forms[kind].questions.map(([key, label, required]) => (
            <label className="field" key={key} style={{ marginTop: '0.8rem' }}>
              <span>{label}{required ? '' : ', si lo sabes'}</span>
              <textarea
                className={tall.has(key) ? undefined : 'short'}
                value={answers[key]}
                onChange={(event) => setAnswer(key, event.target.value)}
                required={required}
              />
            </label>
          ))}
          <FilePicker
            files={files}
            disabled={Boolean(busy)}
            onPick={pickFiles}
            onRemove={(index) => setFiles((current) => current.filter((_, item) => item !== index))}
          />
          <label className="field" style={{ marginTop: '0.8rem' }}>
            <span>Correo, si quieres aviso</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <ActionButton name="send" busy={busy} pending="Enviando…" className="btn" type="submit" style={{ marginTop: '1rem' }}>
            Enviar
          </ActionButton>
        </form>
      )}
      {link && files.length > 0 && (
        <div>
          <FilePicker
            files={files}
            disabled={Boolean(busy)}
            onPick={pickFiles}
            onRemove={(index) => setFiles((current) => current.filter((_, item) => item !== index))}
          />
          <ActionButton name="send" busy={busy} pending="Subiendo…" className="btn" type="button" onClick={submit} style={{ marginTop: '1rem' }}>
            Reintentar archivos
          </ActionButton>
        </div>
      )}
    </main>
  )
}
