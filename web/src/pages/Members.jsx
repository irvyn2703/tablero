import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { messageFrom } from '../lib/format'
import { Alert, Secret } from '../components/ui'

const roleLabel = { owner: 'Dueño', admin: 'Admin', dev: 'Dev' }

export function Members() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('dev')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const [memberRes, inviteRes] = await Promise.all([
      supabase.from('company_members').select('user_id, email, role').eq('company_id', companyId),
      supabase.from('company_invites').select('id, email, role, expires_at, accepted_at').eq('company_id', companyId).order('created_at', { ascending: false }),
    ])
    if (memberRes.error || inviteRes.error) setError(messageFrom(memberRes.error || inviteRes.error))
    else {
      setMembers(memberRes.data ?? [])
      setInvites(inviteRes.data ?? [])
    }
  }

  useEffect(() => { load() }, [companyId])

  async function invite(event) {
    event.preventDefault()
    setError('')
    const { data, error: inviteError } = await supabase.rpc('create_invite', {
      p_company_id: companyId,
      p_email: email,
      p_role: inviteRole,
    })
    if (inviteError) setError(messageFrom(inviteError))
    else {
      setLink(absolutePath(`/join/${data}`))
      setEmail('')
      load()
    }
  }

  async function remove(userId) {
    setError('')
    const { error: deleteError } = await supabase.from('company_members').delete().eq('company_id', companyId).eq('user_id', userId)
    if (deleteError) setError(messageFrom(deleteError))
    else load()
  }

  if (role === 'dev') return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Miembros</p>
      <h1>Quién trabaja aquí.</h1>
      <Alert>{error}</Alert>
      <Secret label="Liga de invitación" value={link} />
      <div className="list" style={{ marginTop: '1rem' }}>
        {members.map((member) => (
          <article key={member.user_id} className="panel cluster" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{member.email}</strong>
              <div className="quiet">{roleLabel[member.role]}</div>
            </div>
            {member.role !== 'owner' && (
              <button className="btn quiet" type="button" onClick={() => remove(member.user_id)}>Quitar</button>
            )}
          </article>
        ))}
      </div>
      <form className="panel" onSubmit={invite} style={{ marginTop: '1rem' }}>
        <h2>Invitar</h2>
        <div className="grid-2" style={{ marginTop: '0.8rem' }}>
          <label className="field">
            <span>Correo</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Rol</span>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              <option value="dev">Dev</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <button className="btn" type="submit" style={{ marginTop: '0.8rem' }}>Crear invitación</button>
      </form>
      {invites.length > 0 && (
        <ul className="timeline">
          {invites.map((invite) => (
            <li key={invite.id}>{invite.email} · {roleLabel[invite.role]} · {invite.accepted_at ? 'Aceptada' : 'Pendiente'}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
