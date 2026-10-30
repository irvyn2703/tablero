import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { configured, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { ActionButton, Alert, useFeedback } from '../components/ui'

export function Join() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(undefined)
  const [error, setError] = useState('')
  const { busy, run } = useFeedback()

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
  }, [])

  function enter() {
    return run('enter', async () => {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      })
      if (authError) {
        setError(messageFrom(authError))
        return false
      }
    })
  }

  function accept() {
    return run('accept', async () => {
      setError('')
      const { data, error: acceptError } = await supabase.rpc('accept_invite', { p_token: token })
      if (acceptError) {
        setError(messageFrom(acceptError))
        return false
      }
      navigate(`/e/${data}`)
    })
  }

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">Invitación</p>
      <h1>Únete a la empresa.</h1>
      <Alert>{error}</Alert>
      {session === undefined && <p className="quiet">Un momento.</p>}
      {session === null && (
        <ActionButton name="enter" busy={busy} pending="Entrando…" className="btn" type="button" onClick={enter}>
          Entrar con Google
        </ActionButton>
      )}
      {session && (
        <ActionButton name="accept" busy={busy} pending="Aceptando…" className="btn" type="button" onClick={accept}>
          Aceptar invitación
        </ActionButton>
      )}
    </main>
  )
}
