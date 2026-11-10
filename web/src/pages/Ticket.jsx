import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { autonomyLabel, canEdit, estimateLabel, formatWhen, localDateKey, memberName, messageFrom, priorityLabel, sprintSpan, ticketKey } from '../lib/format'
import { discardTicket, openTicketFile, takeFiles, uploadTicketFiles } from '../lib/files'
import { useLogoUrl } from '../lib/logo'
import { FilePicker, SavedFiles } from '../components/Files'
import { Thread } from '../components/Thread'
import { ActionButton, Alert, Done, Progress, Secret, TicketChips, useFeedback, writeClipboard } from '../components/ui'

function sprintChoices(sprints, selectedId, today) {
  const current = []
  const upcoming = []
  const previous = []
  for (const sprint of sprints) {
    const start = String(sprint.starts_on || '')
    const end = String(sprint.ends_on || '')
    if (start && end && start <= today && end >= today) current.push(sprint)
    else if (start && start > today) upcoming.push(sprint)
    else if (sprint.id === selectedId) previous.push(sprint)
  }
  return [
    current.length ? { label: 'En curso', sprints: current } : null,
    upcoming.length ? { label: 'Próximos', sprints: upcoming } : null,
    previous.length ? { label: 'Anterior', sprints: previous } : null,
  ].filter(Boolean)
}

export function Ticket() {
  const navigate = useNavigate()
  const { companyId, ticketId } = useParams()
  const { company, role } = useOutletContext()
  const logoUrl = useLogoUrl(company?.logo_path)
  const editable = canEdit(role)
  const [ticket, setTicket] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [members, setMembers] = useState([])
  const [sprints, setSprints] = useState([])
  const [savedSprintId, setSavedSprintId] = useState(null)
  const [versions, setVersions] = useState([])
  const [repos, setRepos] = useState([])
  const [chosenRepos, setChosenRepos] = useState([])
  const [categories, setCategories] = useState([])
  const [chosenCategories, setChosenCategories] = useState([])
  const [events, setEvents] = useState([])
  const [messages, setMessages] = useState([])
  const [pulls, setPulls] = useState([])
  const [savedFiles, setSavedFiles] = useState([])
  const [picked, setPicked] = useState([])
  const [error, setError] = useState('')
  const [tracking, setTracking] = useState(null)
  const { busy, done, mark, run } = useFeedback()

  async function load() {
    const [ticketRes, statusRes, memberRes, sprintRes, versionRes, repoRes, linkRes, categoryRes, categoryLinkRes, eventRes, messageRes, pullRes, fileRes] = await Promise.all([
      supabase.from('ticket_rows').select('*').eq('id', ticketId).maybeSingle(),
      supabase.from('statuses').select('id, name, allows_delete').eq('company_id', companyId).order('position'),
      supabase.from('company_members').select('user_id, alias').eq('company_id', companyId),
      supabase.from('sprints').select('id, name, starts_on, ends_on').eq('company_id', companyId).order('starts_on'),
      supabase.from('versions').select('id, name').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('repos').select('id, github_full_name, source_branch, default_branch').eq('company_id', companyId),
      supabase.from('ticket_repos').select('repo_id').eq('ticket_id', ticketId),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('ticket_categories').select('category_id').eq('ticket_id', ticketId),
      supabase.from('ticket_events').select('id, body, visibility, created_at').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('ticket_messages').select('id, side, author_label, body, created_at').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('pull_requests').select('id, url, created_at').eq('ticket_id', ticketId).order('created_at'),
      supabase.from('ticket_files').select('id, name, mime, byte_size, object_path, created_at').eq('ticket_id', ticketId).order('created_at'),
    ])
    const failed = [ticketRes, statusRes, memberRes, sprintRes, versionRes, repoRes, linkRes, categoryRes, categoryLinkRes, eventRes, messageRes, pullRes, fileRes].find((item) => item.error)
    if (failed) {
      setError(messageFrom(failed.error))
      return
    }
    setTicket(ticketRes.data)
    setSavedSprintId(ticketRes.data?.sprint_id || null)
    setStatuses(statusRes.data ?? [])
    setMembers(memberRes.data ?? [])
    setSprints(sprintRes.data ?? [])
    setVersions(versionRes.data ?? [])
    setRepos(repoRes.data ?? [])
    setChosenRepos((linkRes.data ?? []).map((link) => link.repo_id))
    setCategories(categoryRes.data ?? [])
    setChosenCategories((categoryLinkRes.data ?? []).map((link) => link.category_id))
    setEvents(eventRes.data ?? [])
    setMessages((messageRes.data ?? []).map((message) => ({
      id: message.id,
      side: message.side,
      name: message.author_label,
      body: message.body,
      at: message.created_at,
    })))
    setPulls(pullRes.data ?? [])
    setSavedFiles(fileRes.data ?? [])
  }

  useEffect(() => { load() }, [ticketId, companyId])

  useEffect(() => { setTracking(null) }, [ticketId])

  function discard() {
    const key = ticketKey(company.ticket_prefix, ticket.public_number)
    return run('delete', async () => {
      setError('')
      const result = await discardTicket(ticketId, key)
      if (result.cancelled) return false
      if (result.error) {
        setError(messageFrom(result.error))
        return false
      }
      navigate(`/e/${companyId}`)
    }, 'Ticket eliminado.')
  }

  function copyTracking() {
    return run('tracking', async () => {
      setError('')
      let next = tracking
      if (!next?.url) {
        const { data, error: linkError } = await supabase.rpc('tracking_link', { p_ticket_id: ticketId })
        if (linkError || !data?.token) {
          setError(messageFrom(linkError))
          return false
        }
        next = { url: absolutePath(`/t/${data.token}`), renewed: Boolean(data.renewed) }
        setTracking(next)
      }
      await writeClipboard(next.url)
    }, 'Liga copiada.')
  }

  function sendMessage(body) {
    return run('message', async () => {
      setError('')
      const { error: sendError } = await supabase.rpc('post_ticket_message', {
        p_ticket_id: ticketId,
        p_body: body,
      })
      if (sendError) {
        setError(messageFrom(sendError))
        return false
      }
      load()
    }, 'Mensaje enviado.')
  }

  function patch(partial) {
    setTicket((current) => ({ ...current, ...partial }))
  }

  async function saveFields(event) {
    event.preventDefault()
    if (!editable) return
    await run('fields', async () => {
      setError('')
      const { error: updateError } = await supabase.from('tickets').update({
        title: ticket.title,
        body: ticket.body,
        priority: Number(ticket.priority),
        estimate: ticket.estimate,
        autonomy: ticket.autonomy,
        assignee_id: ticket.assignee_id || null,
        sprint_id: ticket.sprint_id || null,
        version_id: ticket.version_id || null,
      }).eq('id', ticketId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      const { error: clearError } = await supabase.from('ticket_repos').delete().eq('ticket_id', ticketId).eq('company_id', companyId)
      if (clearError) {
        setError(messageFrom(clearError))
        return false
      }
      if (chosenRepos.length > 0) {
        const { error: linkError } = await supabase.from('ticket_repos').insert(
          chosenRepos.map((repoId) => ({ company_id: companyId, ticket_id: ticketId, repo_id: repoId })),
        )
        if (linkError) {
          setError(messageFrom(linkError))
          return false
        }
      }
      const { error: clearCategories } = await supabase.from('ticket_categories').delete().eq('ticket_id', ticketId).eq('company_id', companyId)
      if (clearCategories) {
        setError(messageFrom(clearCategories))
        return false
      }
      if (chosenCategories.length === 0) {
        setSavedSprintId(ticket.sprint_id || null)
        return
      }
      const { error: categoryError } = await supabase.from('ticket_categories').insert(
        chosenCategories.map((categoryId) => ({ company_id: companyId, ticket_id: ticketId, category_id: categoryId })),
      )
      if (categoryError) {
        setError(messageFrom(categoryError))
        return false
      }
      setSavedSprintId(ticket.sprint_id || null)
    }, 'Ficha guardada.')
  }

  async function saveProgress(event) {
    event.preventDefault()
    if (!editable) return
    await run('progress', async () => {
      setError('')
      const { error: progressError } = await supabase.rpc('set_ticket_progress', {
        p_ticket_id: ticketId,
        p_status_id: ticket.status_id,
        p_local: Number(ticket.local_percent),
      })
      if (progressError) {
        setError(messageFrom(progressError))
        return false
      }
      load()
    }, 'Avance guardado.')
  }

  if (!ticket) {
    return (
      <section className="page">
        <Alert>{error}</Alert>
        {!error && <p className="quiet">Un momento.</p>}
      </section>
    )
  }

  return (
    <section className="page">
      <p className="brand-name">
        {logoUrl && <img className="report-logo" src={logoUrl} alt="" />}
        <Link className="kicker" to={`/e/${companyId}`}>{company.name}</Link>
      </p>
      <div className="row">
        <h1>{ticketKey(company.ticket_prefix, ticket.public_number)} {ticket.title}</h1>
        <div className="cluster">
          {editable && (
            <ActionButton name="tracking" busy={busy} pending="Copiando…" className="btn quiet" type="button" onClick={copyTracking}>
              Copiar liga de seguimiento
            </ActionButton>
          )}
          {editable && statuses.some((status) => status.id === ticket.status_id && status.allows_delete) && (
            <button className="btn danger" type="button" disabled={Boolean(busy)} onClick={discard}>
              Eliminar
            </button>
          )}
        </div>
      </div>
      <Secret
        label="Liga de seguimiento"
        value={tracking?.url || ''}
        copyLabel="Copiar liga"
        hint={tracking?.renewed
          ? 'La liga anterior ya no abre. Comparte esta.'
          : 'Es la misma liga de cuando se reportó.'}
      />
      <Done name="tracking" mark={mark}>{done}</Done>
      <TicketChips priority={ticket.priority} estimate={ticket.estimate} />
      <Progress value={ticket.progress} />
      <Alert>{error}</Alert>
      <form onSubmit={saveFields} className="panel" style={{ marginTop: '1rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>Título</span>
            <input value={ticket.title} onChange={(event) => patch({ title: event.target.value })} required disabled={!editable} />
          </label>
          <label className="field">
            <span>Prioridad</span>
            <select value={ticket.priority} onChange={(event) => patch({ priority: event.target.value })} disabled={!editable}>
              {Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Tamaño</span>
            <select value={ticket.estimate} onChange={(event) => patch({ estimate: event.target.value })} disabled={!editable}>
              {Object.entries(estimateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Autonomía</span>
            <select value={ticket.autonomy} onChange={(event) => patch({ autonomy: event.target.value })} disabled={!editable}>
              {Object.entries(autonomyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Asignado</span>
            <select value={ticket.assignee_id || ''} onChange={(event) => patch({ assignee_id: event.target.value })} disabled={!editable}>
              <option value="">Sin asignar</option>
              {members.map((member) => <option key={member.user_id} value={member.user_id}>{memberName(member)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Sprint</span>
            <select value={ticket.sprint_id || ''} onChange={(event) => patch({ sprint_id: event.target.value })} disabled={!editable}>
              <option value="">Backlog</option>
              {sprintChoices(sprints, savedSprintId, localDateKey()).map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.sprints.map((sprint) => {
                    const span = sprintSpan(sprint)
                    return (
                      <option key={sprint.id} value={sprint.id}>
                        {span ? `${sprint.name} · ${span}` : sprint.name}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Versión</span>
            <select value={ticket.version_id || ''} onChange={(event) => patch({ version_id: event.target.value })} disabled={!editable}>
              <option value="">Sin versión</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
            </select>
          </label>
        </div>
        <div className="field" style={{ marginTop: '0.8rem' }}>
          <span>Repos</span>
          {repos.length === 0
            ? <p className="quiet">Agrega repos en la sección Repos.</p>
            : repos.map((repo) => (
              <label className="check-row" key={repo.id}>
                <input
                  type="checkbox"
                  checked={chosenRepos.includes(repo.id)}
                  disabled={!editable}
                  onChange={(event) => setChosenRepos((current) => (
                    event.target.checked
                      ? [...current, repo.id]
                      : current.filter((id) => id !== repo.id)
                  ))}
                />
                <span>{repo.github_full_name}</span>
                <span className="quiet">{repo.source_branch} → {repo.default_branch}</span>
              </label>
            ))}
        </div>
        <div className="field" style={{ marginTop: '0.8rem' }}>
          <span>Categorías</span>
          {categories.length === 0
            ? <p className="quiet">Agrégalas en el tablero. Un ticket puede llevar varias.</p>
            : categories.map((category) => (
              <label className="check-row" key={category.id}>
                <input
                  type="checkbox"
                  checked={chosenCategories.includes(category.id)}
                  disabled={!editable}
                  onChange={(event) => setChosenCategories((current) => (
                    event.target.checked
                      ? [...current, category.id]
                      : current.filter((id) => id !== category.id)
                  ))}
                />
                <span>{category.name}</span>
              </label>
            ))}
        </div>
        <label className="field" style={{ marginTop: '0.8rem' }}>
          <span>Descripción</span>
          <textarea value={ticket.body || ''} onChange={(event) => patch({ body: event.target.value })} disabled={!editable} />
        </label>
        {editable && (
          <ActionButton name="fields" busy={busy} pending="Guardando…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
            Guardar ficha
          </ActionButton>
        )}
        <Done name="fields" mark={mark}>{done}</Done>
      </form>
      <SavedFiles
        files={savedFiles}
        editable={editable}
        busy={busy}
        onOpen={async (file) => {
          try {
            await openTicketFile(file)
          } catch (openError) {
            setError(messageFrom(openError))
          }
        }}
        onRemove={(file) => run(file.id, async () => {
          setError('')
          const removed = await supabase.storage.from('ticket-files').remove([file.object_path])
          if (removed.error) {
            setError(messageFrom(removed.error))
            return false
          }
          const { error: removeError } = await supabase.rpc('remove_ticket_file', { p_file_id: file.id })
          if (removeError) {
            setError(messageFrom(removeError))
            return false
          }
          load()
        }, 'Archivo quitado.')}
      />
      {editable && (
        <form className="panel" style={{ marginTop: '0.8rem' }} onSubmit={(event) => {
          event.preventDefault()
          run('upload', async () => {
            setError('')
            const failed = await uploadTicketFiles({ ticketId, files: picked })
            setPicked(failed.map((item) => item.file))
            if (failed.length) {
              setError(failed.map((item) => `${item.file.name}: ${item.error}`).join(' '))
              return false
            }
            load()
          }, 'Archivos subidos.')
        }}
        >
          <FilePicker
            files={picked}
            disabled={Boolean(busy)}
            onPick={(list) => {
              const next = takeFiles(picked, list)
              setPicked(next.files)
              setError(next.error)
            }}
            onRemove={(index) => setPicked((current) => current.filter((_, item) => item !== index))}
          />
          {picked.length > 0 && (
            <ActionButton name="upload" busy={busy} pending="Subiendo…" className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
              Subir archivos
            </ActionButton>
          )}
          <Done name="upload" mark={mark}>{done}</Done>
        </form>
      )}
      <form onSubmit={saveProgress} className="panel" style={{ marginTop: '0.8rem' }}>
        <div className="grid-2">
          <label className="field">
            <span>Estado</span>
            <select value={ticket.status_id} onChange={(event) => patch({ status_id: event.target.value })} disabled={!editable}>
              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Porcentaje del estado</span>
            <input
              type="number"
              min="0"
              max="100"
              value={ticket.local_percent}
              disabled={!editable}
              onChange={(event) => patch({ local_percent: event.target.value })}
            />
          </label>
        </div>
        {editable && (
          <ActionButton name="progress" busy={busy} pending="Guardando…" className="btn quiet" type="submit" style={{ marginTop: '0.8rem' }}>
            Guardar avance
          </ActionButton>
        )}
        <Done name="progress" mark={mark}>{done}</Done>
      </form>
      <Thread
        messages={messages}
        canWrite={editable}
        reporterLabel="Reporte"
        statusName={statuses.find((status) => status.id === ticket.status_id)?.name}
        busy={busy}
        mark={mark}
        done={done}
        onSend={sendMessage}
      />
      {pulls.length > 0 && (
        <section style={{ marginTop: '1.4rem' }}>
          <h2>Pulls</h2>
          <ul className="timeline">
            {pulls.map((pull) => (
              <li key={pull.id}><a href={pull.url}>{pull.url}</a></li>
            ))}
          </ul>
        </section>
      )}
      <section style={{ marginTop: '1.4rem' }}>
        <h2>Proceso</h2>
        <ul className="timeline">
          {events.map((item) => (
            <li key={item.id}>
              <span className="quiet">{formatWhen(item.created_at)} · {item.visibility === 'public' ? 'Público' : 'Interno'}</span>
              <div>{item.body}</div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
