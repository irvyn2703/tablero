import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { configured, supabase } from '../lib/supabase'
import { Alert } from '../components/ui'

export function Login() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/', { replace: true })
    })
  }, [navigate])

  async function enter() {
    setError('')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (authError) setError(authError.message)
  }

  return (
    <main className="gate">
      <section className="panel">
        <p className="kicker">Tablero</p>
        <h1>El trabajo de la empresa, en orden.</h1>
        <p className="quiet">Entra para ver tus empresas, los sprints y el avance de cada ticket.</p>
        <Alert>{error || (!configured ? 'Falta configurar Supabase.' : '')}</Alert>
        <button className="btn" type="button" onClick={enter} disabled={!configured}>
          Entrar con Google
        </button>
      </section>
    </main>
  )
}
