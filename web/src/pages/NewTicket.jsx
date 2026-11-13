import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { absolutePath, supabase } from '../lib/supabase'
import { autonomyLabel, canEdit, estimateLabel, kindName, memberName, messageFrom, priorityLabel } from '../lib/format'
import { takeFiles, uploadTicketFiles } from '../lib/files'
import { useLogoUrl } from '../lib/logo'
import { FilePicker } from '../components/Files'
import { RepoChecks } from '../components/RepoChecks'
import { SprintField, VersionField } from '../components/PlanFields'
import { ActionButton, Alert, Done, KindChoice, Secret, useFeedback } from '../components/ui'

export function NewTicket() {
  const { companyId } = useParams()
  const { company, role } = useOutletContext()
  const logoUrl = useLogoUrl(company?.logo_path)
  const [kind, setKind] = useState('ticket')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState('3')
  const [estimate, setEstimate] = useState('m')
  const [autonomy, setAutonomy] = useState('suggest')
  const [assigneeId, setAssigneeId] = useState('')
  const [statusId, setStatusId] = useState('')
  const [sprintId, setSprintId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [chosenCategories, setChosenCategories] = useState([])
  const [chosenRepos, setChosenRepos] = useState([])
  const [statuses, setStatuses] = useState([])
  const [members, setMembers] = useState([])
  const [categories, setCategories] = useState([])
  const [repos, setRepos] = useState([])
  const [sprints, setSprints] = useState([])
  const [versions, setVersions] = useState([])
  const [versionCategories, setVersionCategories] = useState([])
  const [files, setFiles] = useState([])
  const [madeId, setMadeId] = useState('')
  const [detailsSaved, setDetailsSaved] = useState(false)
  const detailStep = useRef({ id: '', next: 0 })
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('statuses').select('id, name, kind, position').eq('company_id', companyId).order('position'),
      supabase.from('company_members').select('user_id, alias').eq('company_id', companyId),
      supabase.from('categories').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('repos').select('id, github_full_name, source_branch, default_branch').eq('company_id', companyId).order('github_full_name'),
      supabase.from('sprints').select('id, name, starts_on, ends_on').eq('company_id', companyId).order('starts_on'),
      supabase.from('versions').select('id, name, category_id').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('version_categories').select('id, name').eq('company_id', companyId).order('name'),
    ]).then(([statusRes, memberRes, categoryRes, repoRes, sprintRes, versionRes, versionCategoryRes]) => {
      if (!alive) return
      const failed = [statusRes, memberRes, categoryRes, repoRes, sprintRes, versionRes, versionCategoryRes].find((item) => item.error)
      if (failed) {
        setError(messageFrom(failed.error))
        return
      }
      const rows = statusRes.data ?? []
      setStatuses(rows)
      setStatusId((current) => current || rows.find((item) => item.kind === 'work')?.id || rows[0]?.id || '')
      setMembers(memberRes.data ?? [])
      setCategories(categoryRes.data ?? [])
      setRepos(repoRes.data ?? [])
      setSprints(sprintRes.data ?? [])
      setVersions(versionRes.data ?? [])
      setVersionCategories(versionCategoryRes.data ?? [])
    })
    return () => { alive = false }
  }, [companyId])

  function pickFiles(list) {
    const picked = takeFiles(files, list)
    setFiles(picked.files)
    setError(picked.error)
  }

  function ticketBody() {
    return [`Tipo\n${kindName(kind)}`, body.trim()].filter(Boolean).join('\n\n')
  }

  async function replaceLinks(id, table, column, ids) {
    const { error: clearError } = await supabase.from(table).delete().eq('ticket_id', id).eq('company_id', companyId)
    if (clearError) return clearError
    if (ids.length === 0) return null
    const { error } = await supabase.from(table).insert(
      ids.map((value) => ({ company_id: companyId, ticket_id: id, [column]: value })),
    )
    return error
  }

  async function saveDetails(id) {
    const step = detailStep.current.id === id ? detailStep.current : { id, next: 0 }
    detailStep.current = step
    if (step.next < 1) {
      const { error: updateError } = await supabase.from('tickets').update({
        title,
        body: ticketBody(),
        priority: Number(priority),
        estimate,
        autonomy,
        assignee_id: assigneeId || null,
        sprint_id: sprintId || null,
        version_id: versionId || null,
      }).eq('id', id)
      if (updateError) return updateError
      step.next = 1
    }
    if (step.next < 2) {
      const openedIn = statuses.find((item) => item.kind === 'work')?.id || statuses[0]?.id || ''
      if (statusId && statusId !== openedIn) {
        const { error: statusError } = await supabase.rpc('set_ticket_progress', {
          p_ticket_id: id,
          p_status_id: statusId,
          p_local: null,
        })
        if (statusError) return statusError
      }
      step.next = 2
    }
    if (step.next < 3) {
      const categoryError = await replaceLinks(id, 'ticket_categories', 'category_id', chosenCategories)
      if (categoryError) return categoryError
      step.next = 3
    }
    if (step.next < 4) {
      const repoError = await replaceLinks(id, 'ticket_repos', 'repo_id', chosenRepos)
      if (repoError) return repoError
      step.next = 4
    }
    return null
  }

  async function sendFiles(ticketId, chosen) {
    const failed = await uploadTicketFiles({ ticketId, files: chosen })
    setFiles(failed.map((item) => item.file))
    if (failed.length === 0) return null
    return failed.map((item) => `${item.file.name}: ${item.error}`).join(' ')
  }

  function resetForm() {
    const first = statuses.find((item) => item.kind === 'work')?.id || statuses[0]?.id || ''
    setKind('ticket')
    setTitle('')
    setBody('')
    setPriority('3')
    setEstimate('m')
    setAutonomy('suggest')
    setAssigneeId('')
    setStatusId(first)
    setSprintId('')
    setVersionId('')
    setChosenCategories([])
    setChosenRepos([])
    setMadeId('')
    setDetailsSaved(false)
    detailStep.current = { id: '', next: 0 }
    setFiles([])
  }

  async function createTicket(event) {
    event.preventDefault()
    const retrying = Boolean(madeId)
    await run('create', async () => {
      setError('')
      let id = madeId
      if (!id) {
        const { data, error: createError } = await supabase.rpc('create_ticket', {
          p_company_id: companyId,
          p_title: title,
          p_body: ticketBody(),
        })
        if (createError) {
          setError(messageFrom(createError))
          return false
        }
        id = data.id
        setMadeId(id)
        setSecret(absolutePath(`/t/${data.viewToken}`))
      }
      if (!detailsSaved) {
        const detailError = await saveDetails(id)
        if (detailError) {
          setError(messageFrom(detailError))
          return false
        }
        setDetailsSaved(true)
      }
      if (files.length > 0) {
        const fileError = await sendFiles(id, files)
        if (fileError) {
          setError(fileError)
          return false
        }
      }
      resetForm()
    }, retrying ? 'Ticket actualizado.' : 'Ticket registrado.')
  }

  if (!canEdit(role)) {
    return (
      <section className="page">
        <p className="kicker"><Link to={`/e/${companyId}`}>Tablero</Link></p>
        <p className="quiet">Solo puedes ver el tablero.</p>
      </section>
    )
  }

  return (
    <section className="page">
      <p className="brand-name">
        {logoUrl && <img className="report-logo" src={logoUrl} alt="" />}
        <Link className="kicker" to={`/e/${companyId}`}>{company.name}</Link>
      </p>
      <h1>Nuevo ticket</h1>
      <Alert>{error}</Alert>
      <Secret label="Liga de seguimiento" value={secret} copyLabel="Copiar liga" />
      <form className="panel" onSubmit={createTicket} style={{ marginTop: '1rem', maxWidth: '36rem' }}>
        <KindChoice value={kind} onChange={setKind} />
        <label className="field">
          <span>Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required disabled={Boolean(busy)} />
        </label>
        <div className="grid-2" style={{ marginTop: '0.8rem' }}>
          <label className="field">
            <span>Prioridad</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)} disabled={Boolean(busy)}>
              {Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Tamaño</span>
            <select value={estimate} onChange={(event) => setEstimate(event.target.value)} disabled={Boolean(busy)}>
              {Object.entries(estimateLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Autonomía</span>
            <select value={autonomy} onChange={(event) => setAutonomy(event.target.value)} disabled={Boolean(busy)}>
              {Object.entries(autonomyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Asignado</span>
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={Boolean(busy)}>
              <option value="">Sin asignar</option>
              {members.map((member) => <option key={member.user_id} value={member.user_id}>{memberName(member)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Estado</span>
            <select value={statusId} onChange={(event) => setStatusId(event.target.value)} disabled={Boolean(busy) || statuses.length === 0}>
              {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>
          <SprintField
            sprints={sprints}
            value={sprintId}
            disabled={Boolean(busy)}
            onChange={setSprintId}
          />
          <VersionField
            versions={versions}
            categories={versionCategories}
            value={versionId}
            disabled={Boolean(busy)}
            onChange={setVersionId}
          />
        </div>
        <RepoChecks
          repos={repos}
          chosen={chosenRepos}
          disabled={Boolean(busy)}
          onChange={(repoId, checked) => setChosenRepos((current) => (
            checked ? [...current, repoId] : current.filter((item) => item !== repoId)
          ))}
        />
        {categories.length > 0 && (
          <div className="field" style={{ marginTop: '0.8rem' }}>
            <span>Categorías</span>
            {categories.map((category) => (
              <label className="check-row" key={category.id}>
                <input
                  type="checkbox"
                  checked={chosenCategories.includes(category.id)}
                  disabled={Boolean(busy)}
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
        )}
        <label className="field" style={{ marginTop: '0.8rem' }}>
          <span>Detalle</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={Boolean(busy)} />
        </label>
        <FilePicker
          files={files}
          disabled={Boolean(busy)}
          onPick={pickFiles}
          onRemove={(index) => setFiles((current) => current.filter((_, item) => item !== index))}
        />
        <ActionButton name="create" busy={busy} pending={madeId ? 'Reintentando…' : 'Registrando…'} className="btn" type="submit" style={{ marginTop: '0.8rem' }}>
          {madeId ? 'Reintentar' : 'Registrar'}
        </ActionButton>
        <Done name="create" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
