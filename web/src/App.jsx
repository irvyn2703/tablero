import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { configured, supabase } from './lib/supabase'
import { Shell } from './components/Shell'
import { Login } from './pages/Login'
import { Companies } from './pages/Companies'
import { Board } from './pages/Board'
import { NewTicket } from './pages/NewTicket'
import { Calendar } from './pages/Calendar'
import { SprintForm } from './pages/SprintForm'
import { Versions } from './pages/Versions'
import { Ticket } from './pages/Ticket'
import { Statuses } from './pages/Statuses'
import { Members } from './pages/Members'
import { Repos } from './pages/Repos'
import { Links } from './pages/Links'
import { Automation } from './pages/Automation'
import { Brand } from './pages/Brand'
import { Intake } from './pages/Intake'
import { Track } from './pages/Track'
import { Join } from './pages/Join'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

function RequireAuth() {
  const [session, setSession] = useState(undefined)
  const location = useLocation()

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session ?? null)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  if (!configured) {
    return <main className="letter"><h1>Falta configurar Supabase.</h1></main>
  }
  if (session === undefined) return <main className="letter"><p className="quiet">Un momento.</p></main>
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <Outlet context={{ session }} />
}

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/entrar" element={<Login />} />
        <Route path="/i/:token" element={<Intake />} />
        <Route path="/t/:token" element={<Track />} />
        <Route path="/join/:token" element={<Join />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Companies />} />
          <Route path="/e/:companyId" element={<Shell />}>
            <Route index element={<Board />} />
            <Route path="nuevo" element={<NewTicket />} />
            <Route path="calendario" element={<Calendar />} />
            <Route path="calendario/nuevo" element={<SprintForm />} />
            <Route path="calendario/s/:sprintId" element={<SprintForm />} />
            <Route path="versiones" element={<Versions />} />
            <Route path="t/:ticketId" element={<Ticket />} />
            <Route path="estados" element={<Statuses />} />
            <Route path="miembros" element={<Members />} />
            <Route path="repos" element={<Repos />} />
            <Route path="ligas" element={<Links />} />
            <Route path="automatizacion" element={<Automation />} />
            <Route path="diseno" element={<Brand />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
