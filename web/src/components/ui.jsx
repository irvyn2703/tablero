import { formatProgress } from '../lib/format'

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

export function Alert({ children }) {
  if (!children) return null
  return <p className="alert" role="alert">{children}</p>
}

export function Secret({ label, value }) {
  if (!value) return null
  return (
    <div className="note">
      <p className="kicker">{label}</p>
      <p className="secret">{value}</p>
      <p className="quiet">Se muestra una sola vez. Cópiala ahora.</p>
      <button
        className="btn quiet"
        type="button"
        onClick={() => navigator.clipboard.writeText(value)}
      >
        Copiar
      </button>
    </div>
  )
}
