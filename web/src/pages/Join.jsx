import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { configured, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert } from '../components/ui'

export function Join() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
  }, [])

  async function enter() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
  }

  async function accept() {
    setError('')
    const { data, error: acceptError } = await supabase.rpc('accept_invite', { p_token: token })
    if (acceptError) setError(messageFrom(acceptError))
    else navigate(`/e/${data}`)
  }

  if (!configured) return <main className="letter"><h1>Falta configurar Supabase.</h1></main>

  return (
    <main className="letter page">
      <p className="kicker">Invitación</p>
      <h1>Únete a la empresa.</h1>
      <Alert>{error}</Alert>
      {session === undefined && <p className="quiet">Un momento.</p>}
      {session === null && <button className="btn" type="button" onClick={enter}>Entrar con Google</button>}
      {session && <button className="btn" type="button" onClick={accept}>Aceptar invitación</button>}
    </main>
  )
}
