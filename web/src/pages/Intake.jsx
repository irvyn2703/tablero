import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { absolutePath, configured, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { ActionButton, Alert, Secret, useFeedback } from '../components/ui'

const questions = [
  ['intent', 'Qué intentabas hacer', false],
  ['happened', 'Qué pasó', true],
  ['expected', 'Qué esperabas', false],
  ['where', 'Dónde', false],
  ['steps', 'Pasos para verlo otra vez', false],
  ['since', 'Desde cuándo, y a quién le pasa', false],
]

function reportBody(answers) {
  return questions
    .map(([key, label]) => [label, answers[key].trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}\n${value}`)
    .join('\n\n')
}

export function Intake() {
  const { token } = useParams()
  const [heading, setHeading] = useState(null)
  const [title, setTitle] = useState('')
  const [answers, setAnswers] = useState({
    intent: '',
    happened: '',
    expected: '',
    where: '',
    steps: '',
    since: '',
  })
  const [email, setEmail] = useState('')
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

  async function submit(event) {
    event.preventDefault()
    await run('send', async () => {
      setError('')
      const body = reportBody(answers)
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
      setLink(absolutePath(`/t/${data.viewToken}`))
    })
  }

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">{heading?.companyName || 'Tablero'}</p>
      <h1>{heading?.label || 'Nuevo ticket'}</h1>
      <p className="quiet">Cuéntanos qué pasó. Al enviarlo recibes una liga para ver el avance, sin crear cuenta.</p>
      <Alert>{error}</Alert>
      <Secret label="Tu liga de seguimiento" value={link} copyLabel="Copiar liga" />
      {!link && (
        <form onSubmit={submit}>
          <label className="field">
            <span>Título</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
          </label>
          {questions.map(([key, label, required]) => (
            <label className="field" key={key} style={{ marginTop: '0.8rem' }}>
              <span>{label}{required ? '' : ', si lo sabes'}</span>
              <textarea
                className={key === 'steps' || key === 'happened' ? undefined : 'short'}
                value={answers[key]}
                onChange={(event) => setAnswer(key, event.target.value)}
                required={required}
              />
            </label>
          ))}
          <label className="field" style={{ marginTop: '0.8rem' }}>
            <span>Correo, si quieres aviso</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <ActionButton name="send" busy={busy} pending="Enviando…" className="btn" type="submit" style={{ marginTop: '1rem' }}>
            Enviar
          </ActionButton>
        </form>
      )}
    </main>
  )
}
