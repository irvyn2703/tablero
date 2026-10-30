import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { isAdmin, memberName, messageFrom, roleLabel } from '../lib/format'
import { ActionButton, Alert, Done, Secret, useFeedback } from '../components/ui'

export function Members() {
  const { companyId } = useParams()
  const { role } = useOutletContext()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('dev')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [memberRes, inviteRes] = await Promise.all([
      supabase.from('company_members').select('user_id, alias, role').eq('company_id', companyId),
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
    await run('invite', async () => {
      setError('')
      const { data, error: inviteError } = await supabase.rpc('create_invite', {
        p_company_id: companyId,
        p_email: email,
        p_role: inviteRole,
      })
      if (inviteError) {
        setError(messageFrom(inviteError))
        return false
      }
      setLink(absolutePath(`/join/${data}`))
      setEmail('')
      load()
    }, 'Invitación creada.')
  }

  function changeAlias(userId, alias) {
    setMembers((rows) => rows.map((row) => (row.user_id === userId ? { ...row, alias } : row)))
  }

  function saveAlias(member) {
    return run(`alias:${member.user_id}`, async () => {
      setError('')
      const alias = member.alias.trim()
      if (!alias || alias.length > 40) {
        setError('El alias necesita entre 1 y 40 caracteres.')
        return false
      }
      const { error: saveError } = await supabase.rpc('set_member_alias', {
        p_company_id: companyId,
        p_user_id: member.user_id,
        p_alias: alias,
      })
      if (saveError) {
        setError(messageFrom(saveError))
        return false
      }
      changeAlias(member.user_id, alias)
    }, 'Alias guardado.')
  }

  function remove(userId) {
    return run(userId, async () => {
      setError('')
      const { error: deleteError } = await supabase.from('company_members').delete().eq('company_id', companyId).eq('user_id', userId)
      if (deleteError) {
        setError(messageFrom(deleteError))
        return false
      }
      load()
    }, 'Miembro quitado.')
  }

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  return (
    <section className="page">
      <p className="kicker">Miembros</p>
      <h1>Quién trabaja aquí.</h1>
      <Alert>{error}</Alert>
      <Done name={mark} mark={mark}>{done}</Done>
      <Secret label="Liga de invitación" value={link} copyLabel="Copiar liga" />
      <div className="list" style={{ marginTop: '1rem' }}>
        {members.map((member) => (
          <article key={member.user_id} className="panel member-row">
            <label className="field">
              <span>Alias</span>
              <input
                value={member.alias}
                maxLength={40}
                required
                aria-label={`Alias de ${memberName(member)}`}
                onChange={(event) => changeAlias(member.user_id, event.target.value)}
              />
            </label>
            <div className="member-side">
              <span className="role-mark">{roleLabel[member.role]}</span>
              <ActionButton name={`alias:${member.user_id}`} busy={busy} pending="Guardando…" className="btn" type="button" onClick={() => saveAlias(member)}>
                Guardar
              </ActionButton>
              {member.role !== 'owner' && (
                <ActionButton name={member.user_id} busy={busy} pending="Quitando…" className="btn quiet" type="button" onClick={() => remove(member.user_id)}>
                  Quitar
                </ActionButton>
              )}
            </div>
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
              <option value="observer">Observador</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <ActionButton name="invite" busy={busy} pending="Creando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          Crear invitación
        </ActionButton>
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
