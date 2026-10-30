import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Alert } from './ui'

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

  useEffect(() => {
    let alive = true
    supabase
      .from('company_members')
      .select('role, companies(id, name, slug, policy)')
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

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/entrar')
  }

  if (error) {
    return <main className="main"><Alert>{error}</Alert></main>
  }
  if (!company) {
    return <main className="main"><p className="quiet">Un momento.</p></main>
  }

  const items = role === 'dev' ? links : [...links, ...adminLinks]

  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="mark">
          <i aria-hidden="true" />
          <div>
            <strong>Tablero</strong>
            <span>{company.name}</span>
          </div>
        </NavLink>
        <nav className="nav">
          {items.map(([path, label]) => (
            <NavLink
              key={label}
              to={path}
              end={path === ''}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button className="btn quiet" type="button" onClick={signOut}>Salir</button>
      </aside>
      <div className="main">
        <Outlet context={{ session, company, role }} />
      </div>
    </div>
  )
}
