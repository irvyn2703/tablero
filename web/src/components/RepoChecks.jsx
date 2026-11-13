export function RepoChecks({ repos, chosen, disabled, onChange }) {
  return (
    <div className="field" style={{ marginTop: '0.8rem' }}>
      <span>Repos</span>
      {repos.length === 0
        ? <p className="quiet">Agrega repos en la sección Repos.</p>
        : repos.map((repo) => (
          <label className="check-row" key={repo.id}>
            <input
              type="checkbox"
              checked={chosen.includes(repo.id)}
              disabled={disabled}
              onChange={(event) => onChange(repo.id, event.target.checked)}
            />
            <span>{repo.github_full_name}</span>
            <span className="quiet">{repo.source_branch} → {repo.default_branch}</span>
          </label>
        ))}
    </div>
  )
}
