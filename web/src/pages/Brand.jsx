import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { brandVars, builtInBrass, builtInPaper, builtInPine, isAdmin, messageFrom } from '../lib/format'
import { ActionButton, Alert, Done, useFeedback } from '../components/ui'

const logoTypes = /^image\/(jpeg|png|webp|gif)$/
const logoExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export function Brand() {
  const { companyId } = useParams()
  const { company, role, patchCompany } = useOutletContext()
  const [pine, setPine] = useState(company.brand_color || builtInPine)
  const [brass, setBrass] = useState(company.accent_color || builtInBrass)
  const [paper, setPaper] = useState(company.background_color || builtInPaper)
  const [logoUrl, setLogoUrl] = useState('')
  const [picked, setPicked] = useState(null)
  const [error, setError] = useState('')
  const { busy, done, mark, run } = useFeedback()

  useEffect(() => {
    if (!company.logo_path) {
      setLogoUrl('')
      return undefined
    }
    let alive = true
    supabase.storage.from('company-logos').createSignedUrl(company.logo_path, 3600).then(({ data, error: signError }) => {
      if (!alive) return
      if (signError) setError(messageFrom(signError))
      else setLogoUrl(data?.signedUrl || '')
    })
    return () => { alive = false }
  }, [company.logo_path])

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url)
  }, [picked])

  async function saveColors(event) {
    event.preventDefault()
    await run('colors', async () => {
      setError('')
      const brand_color = pine.toLowerCase() === builtInPine ? '' : pine.toLowerCase()
      const accent_color = brass.toLowerCase() === builtInBrass ? '' : brass.toLowerCase()
      const background_color = paper.toLowerCase() === builtInPaper ? '' : paper.toLowerCase()
      const { error: updateError } = await supabase
        .from('companies')
        .update({ brand_color, accent_color, background_color })
        .eq('id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      patchCompany({ brand_color, accent_color, background_color })
    }, 'Colores guardados.')
  }

  function chooseLogo(list) {
    const file = list?.[0]
    if (!file) return
    if (!logoTypes.test(file.type)) {
      setError('El logo es una imagen: JPG, PNG, WebP o GIF.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo pasa de 2 MB.')
      return
    }
    setError('')
    if (picked) URL.revokeObjectURL(picked.url)
    setPicked({ file, url: URL.createObjectURL(file) })
  }

  function uploadLogo() {
    return run('logo', async () => {
      setError('')
      if (!picked) return false
      const ext = logoExt[picked.file.type]
      const path = `${companyId}/logo.${ext}`
      const previous = company.logo_path
      const uploaded = await supabase.storage.from('company-logos').upload(path, picked.file, {
        upsert: true,
        contentType: picked.file.type,
      })
      if (uploaded.error) {
        setError(messageFrom(uploaded.error))
        return false
      }
      const { error: updateError } = await supabase.from('companies').update({ logo_path: path }).eq('id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      if (previous && previous !== path) {
        await supabase.storage.from('company-logos').remove([previous])
      }
      patchCompany({ logo_path: path })
      URL.revokeObjectURL(picked.url)
      setPicked(null)
    }, 'Logo guardado.')
  }

  function removeLogo() {
    if (!company.logo_path) return undefined
    if (!window.confirm('Se quita el logo.')) return undefined
    return run('remove-logo', async () => {
      setError('')
      const removed = await supabase.storage.from('company-logos').remove([company.logo_path])
      if (removed.error) {
        setError(messageFrom(removed.error))
        return false
      }
      const { error: updateError } = await supabase.from('companies').update({ logo_path: '' }).eq('id', companyId)
      if (updateError) {
        setError(messageFrom(updateError))
        return false
      }
      patchCompany({ logo_path: '' })
      setLogoUrl('')
    }, 'Logo quitado.')
  }

  if (!isAdmin(role)) return <p className="quiet">Esta sección es de administración.</p>

  const preview = brandVars({
    brand_color: pine.toLowerCase() === builtInPine ? '' : pine,
    accent_color: brass.toLowerCase() === builtInBrass ? '' : brass,
    background_color: paper.toLowerCase() === builtInPaper ? '' : paper,
  })

  return (
    <section className="page">
      <p className="kicker">Diseño</p>
      <h1>La cara de la empresa.</h1>
      <Alert>{error}</Alert>
      <form className="panel" onSubmit={saveColors} style={{ maxWidth: '32rem' }}>
        <h2>Colores</h2>
        <div className="grid-3" style={{ marginTop: '0.8rem' }}>
          <label className="field">
            <span>Principal</span>
            <input className="color-input" type="color" value={pine} onChange={(event) => setPine(event.target.value)} />
          </label>
          <label className="field">
            <span>Acento</span>
            <input className="color-input" type="color" value={brass} onChange={(event) => setBrass(event.target.value)} />
          </label>
          <label className="field">
            <span>Fondo</span>
            <input className="color-input" type="color" value={paper} onChange={(event) => setPaper(event.target.value)} />
          </label>
        </div>
        <p className="quiet">El principal pinta los botones. El acento pinta las marcas. El fondo pinta la página y el formulario para reportar.</p>
        <div className="brand-preview cluster" style={preview}>
          <span className="btn">Así se ve</span>
          <span className="brand-swatch">Acento</span>
        </div>
        <ActionButton name="colors" busy={busy} pending="Guardando…" className="btn" type="submit">
          Guardar colores
        </ActionButton>
        <Done name="colors" mark={mark}>{done}</Done>
      </form>
      <form
        className="panel"
        style={{ marginTop: '0.8rem', maxWidth: '32rem' }}
        onSubmit={(event) => {
          event.preventDefault()
          uploadLogo()
        }}
      >
        <h2>Logo</h2>
        <div className="brand-logo-row">
          {picked?.url || logoUrl
            ? <img className="brand-logo" src={picked?.url || logoUrl} alt="" />
            : <i className="brand-mark" aria-hidden="true" />}
          <label className="btn quiet file-pick">
            Elegir imagen
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
              onChange={(event) => {
                chooseLogo(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="quiet">JPG, PNG, WebP o GIF. Hasta 2 MB.</p>
        <div className="cluster">
          {picked && (
            <ActionButton name="logo" busy={busy} pending="Subiendo…" className="btn" type="submit">
              Subir logo
            </ActionButton>
          )}
          {company.logo_path && (
            <ActionButton name="remove-logo" busy={busy} pending="Quitando…" className="btn quiet" type="button" onClick={removeLogo}>
              Quitar logo
            </ActionButton>
          )}
        </div>
        <Done name="logo" mark={mark}>{done}</Done>
        <Done name="remove-logo" mark={mark}>{done}</Done>
      </form>
    </section>
  )
}
