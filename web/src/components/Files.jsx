import { fileSize } from '../lib/files'

const accept = '.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.doc,.docx,image/jpeg,image/png,image/gif,image/webp'

export function FilePicker({ files, onPick, onRemove, disabled }) {
  return (
    <div className="field" style={{ marginTop: '0.8rem' }}>
      <span>Archivos</span>
      <label className={`btn quiet file-pick${disabled ? ' is-disabled' : ''}`}>
        Adjuntar
        <input
          type="file"
          accept={accept}
          multiple
          disabled={disabled}
          onChange={(event) => {
            onPick(event.target.files)
            event.target.value = ''
          }}
        />
      </label>
      <p className="quiet">Imágenes, Excel o Word. Hasta 8 archivos, de 10 MB.</p>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <strong>{file.name}</strong>
              <span className="quiet">{fileSize(file.size)}</span>
              <button className="btn quiet" type="button" onClick={() => onRemove(index)} disabled={disabled}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SavedFiles({ files, editable, busy, onOpen, onRemove }) {
  if (files.length === 0) return null
  return (
    <section className="panel" style={{ marginTop: '0.8rem' }}>
      <h2>Archivos</h2>
      {files.length === 0
        ? <p className="quiet">Todavía no hay archivos.</p>
        : (
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.id}>
                <strong>{file.name}</strong>
                <span className="quiet">{fileSize(file.byte_size)}</span>
                <button className="btn quiet" type="button" onClick={() => onOpen(file)} disabled={Boolean(busy)}>
                  Abrir
                </button>
                {editable && (
                  <button className="btn quiet" type="button" onClick={() => onRemove(file)} disabled={Boolean(busy)}>
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
