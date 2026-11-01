import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isAdmin } from '../lib/format'
import { ActionButton, Alert, useFeedback } from './ui'

const links = [
  ['', 'Tablero'],
  ['calendario', 'Calendario'],
]

const adminLinks = [
  ['estados', 'Estados'],
  ['miembros', 'Miembros'],
  ['repos', 'Repos'],
  ['ligas', 'Ligas'],
  ['automatizacion', 'Automatización'],
]

export function Shell() {
  const { session } = useOutletContext()
  const { companyId } = useParams()
  const navigate = useNavigate()
  const [company, setCompany] = useState(null)
  const [role, setRole] = useState('')
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const { busy, run } = useFeedback()

  useEffect(() => { setMenuOpen(false) }, [pathname])

  useEffect(() => {
    if (!menuOpen) return undefined
    function onKey(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  useEffect(() => {
    let alive = true
    supabase
      .from('company_members')
      .select('role, companies(id, name, slug, policy, ticket_prefix)')
      .eq('company_id', companyId)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!alive) return
        if (loadError || !data?.companies) {
          setError('No perteneces a esta empresa.')
          return
        }
        setRole(data.role)
        setCompany(data.companies)
      })
    return () => { alive = false }
  }, [companyId, session.user.id])

  function signOut() {
    return run('leave', async () => {
      await supabase.auth.signOut()
      navigate('/entrar')
    })
  }

  if (error) {
    return <main className="main"><Alert>{error}</Alert></main>
  }
  if (!company) {
    return <main className="main"><p className="quiet">Un momento.</p></main>
  }

  const items = isAdmin(role) ? [...links, ...adminLinks] : links

  return (
    <div className="shell">
      {menuOpen && <button className="menu-shade" type="button" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'rail is-open' : 'rail'}>
        <NavLink to="/" className="mark">
          <i aria-hidden="true" />
          <div>
            <strong>Tablero</strong>
            <span>{company.name}</span>
          </div>
        </NavLink>
        <button
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="company-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="menu-bars" aria-hidden="true" />
          <span className="menu-label">{menuOpen ? 'Cerrar menú' : 'Abrir menú'}</span>
        </button>
        <div className="drawer" id="company-nav">
          <nav className="nav">
            {items.map(([path, label]) => (
              <NavLink
                key={label}
                to={path}
                end={path === ''}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <ActionButton name="leave" busy={busy} pending="Saliendo…" className="btn quiet" type="button" onClick={signOut}>
            Salir
          </ActionButton>
        </div>
      </aside>
      <div className="main">
        <Outlet context={{ session, company, role, patchCompany: (partial) => setCompany((current) => ({ ...current, ...partial })) }} />
      </div>
    </div>
  )
}
