import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { absolutePath, configured, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert, Secret } from '../components/ui'

export function Intake() {
  const { token } = useParams()
  const [heading, setHeading] = useState(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.rpc('read_intake', { p_token: token }).then(({ data, error: readError }) => {
      if (readError) setError(messageFrom(readError))
      else setHeading(data)
    })
  }, [token])

  async function submit(event) {
    event.preventDefault()
    setError('')
    const { data, error: createError } = await supabase.rpc('create_ticket_from_intake', {
      p_token: token,
      p_title: title,
      p_body: body,
      p_email: email || null,
    })
    if (createError) setError(messageFrom(createError))
    else setLink(absolutePath(`/t/${data.viewToken}`))
  }

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">{heading?.companyName || 'Tablero'}</p>
      <h1>{heading?.label || 'Nuevo ticket'}</h1>
      <p className="quiet">Cuéntanos qué necesitas. Al enviarlo recibes una liga para ver el avance, sin crear cuenta.</p>
      <Alert>{error}</Alert>
      <Secret label="Tu liga de seguimiento" value={link} />
      {!link && (
        <form onSubmit={submit}>
          <label className="field">
            <span>Título</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="field" style={{ marginTop: '0.8rem' }}>
            <span>Qué hay que hacer</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <label className="field" style={{ marginTop: '0.8rem' }}>
            <span>Correo, si quieres aviso</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button className="btn" type="submit" style={{ marginTop: '1rem' }}>Enviar</button>
        </form>
      )}
    </main>
  )
}
