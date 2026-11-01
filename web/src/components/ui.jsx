import { useEffect, useRef, useState } from 'react'
import { formatProgress, ticketKinds } from '../lib/format'

export function Progress({ value }) {
  const n = Math.max(0, Math.min(100, Number(value) || 0))
  const label = formatProgress(n)
  return (
    <div className="meter" role="progressbar" aria-valuenow={n} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance ${label}%`}>
      <b><i style={{ width: `${n}%` }} /></b>
      <span>{label}%</span>
    </div>
  )
}

export function KindChoice({ value, onChange }) {
  return (
    <fieldset className="kinds">
      <legend>Qué es</legend>
      {ticketKinds.map((kind) => (
        <label className="kind" key={kind.id}>
          <input
            type="radio"
            name="kind"
            value={kind.id}
            checked={value === kind.id}
            onChange={() => onChange(kind.id)}
          />
          <strong>{kind.name}</strong>
          <span>{kind.hint}</span>
        </label>
      ))}
    </fieldset>
  )
}

export function Alert({ children }) {
  if (!children) return null
  return <p className="alert" role="alert">{children}</p>
}

export async function writeClipboard(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function Secret({ label, value, copyLabel = 'Copiar', hint = 'Se muestra una sola vez. Cópiala ahora.' }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!value) return null

  async function copy() {
    const ok = await writeClipboard(value)
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2400)
  }

  return (
    <div className="note">
      <p className="kicker">{label}</p>
      <div className="secret-row">
        <p className="secret">{value}</p>
        <button className="btn" type="button" onClick={copy} disabled={copied} aria-busy={copied || undefined}>
          {copied ? 'Copiado' : copyLabel}
        </button>
      </div>
      {hint ? <p className="quiet">{hint}</p> : null}
    </div>
  )
}

export function useFeedback() {
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [mark, setMark] = useState('')
  const lock = useRef(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function run(name, work, message) {
    if (lock.current) return
    lock.current = true
    setBusy(name)
    setDone('')
    setMark('')
    let ok = false
    try {
      ok = (await work()) !== false
    } finally {
      lock.current = false
      setBusy('')
    }
    if (ok && message) {
      setDone(message)
      setMark(name)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setDone('')
        setMark('')
      }, 3200)
    }
  }

  return { busy, done, mark, run }
}

export function ActionButton({ name, busy, pending, children, disabled, ...rest }) {
  const on = Boolean(name) && busy === name
  return (
    <button {...rest} disabled={Boolean(busy) || disabled} aria-busy={on || undefined}>
      {on ? pending : children}
    </button>
  )
}

export function Done({ name, mark, children }) {
  if (!children || (name && name !== mark)) return null
  return <p className="done" role="status">{children}</p>
}
