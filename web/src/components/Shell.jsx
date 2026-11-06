import { useEffect, useLayoutEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { brandVars, isAdmin } from '../lib/format'
import { ActionButton, Alert, useFeedback } from './ui'

const links = [
  ['', 'Tablero'],
  ['calendario', 'Calendario'],
  ['versiones', 'Versiones'],
]

const adminLinks = [
  ['estados', 'Estados'],
  ['miembros', 'Miembros'],
  ['repos', 'Repos'],
  ['ligas', 'Ligas'],
  ['automatizacion', 'Automatización'],
  ['diseno', 'Diseño'],
]

export function Shell() {
  const { session } = useOutletContext()
  const { companyId } = useParams()
  const navigate = useNavigate()
  const [company, setCompany] = useState(null)
  const [role, setRole] = useState('')
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const { pathname } = useLocation()
  const { busy, run } = useFeedback()

  useEffect(() => { setMenuOpen(false) }, [pathname])

  useLayoutEffect(() => {
    const root = document.documentElement
    const style = brandVars(company)
    for (const [key, value] of Object.entries(style)) root.style.setProperty(key, value)
    return () => {
      for (const key of Object.keys(style)) root.style.removeProperty(key)
    }
  }, [company])

  useEffect(() => {
    if (!company?.logo_path) {
      setLogoUrl('')
      return undefined
    }
    let alive = true
    supabase.storage.from('company-logos').createSignedUrl(company.logo_path, 3600).then(({ data }) => {
      if (alive) setLogoUrl(data?.signedUrl || '')
    })
    return () => { alive = false }
  }, [company?.logo_path])

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
      .select('role, companies(id, name, slug, policy, ticket_prefix, brand_color, accent_color, background_color, logo_path)')
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
          {logoUrl ? <img className="mark-logo" src={logoUrl} alt="" /> : <i aria-hidden="true" />}
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
