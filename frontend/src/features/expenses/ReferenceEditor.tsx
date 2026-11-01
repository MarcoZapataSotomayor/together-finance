import { useEffect, useRef, useState } from 'react'
import type { FinanceApi } from '../../api/finance'
import { methodLabels } from '../../api/types'
import type {
  CategoryRecord,
  PaymentMethodRecord,
  PaymentMethodType,
  PersonRecord,
  References,
} from '../../api/types'
import { Button } from '../../components/ui/Button'
import { SelectField } from '../../components/ui/FormField'
import { ApiFeedback, LoadingNotice } from './ApiFeedback'
export type ReferenceKind = 'people' | 'categories' | 'methods'
export type CreatedReference =
  PersonRecord | CategoryRecord | PaymentMethodRecord
const labels = {
  people: 'Agregar persona',
  categories: 'Agregar categoría',
  methods: 'Agregar medio de pago',
}
export function ReferenceEditor({
  kind,
  api,
  references,
  onCreated,
  onCancel,
}: {
  kind: ReferenceKind
  api: FinanceApi
  references: References
  onCreated: (kind: ReferenceKind, record: CreatedReference) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<PaymentMethodType | ''>('')
  const [owner, setOwner] = useState('')
  const [validation, setValidation] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  async function save() {
    if (lock.current) return
    const normalized = name.trim().normalize('NFKC')
    if (!normalized || normalized.length > 120) {
      setValidation('Escribe un nombre de hasta 120 caracteres.')
      return
    }
    if (kind === 'methods' && !type) {
      setValidation('Elige el tipo de medio de pago.')
      return
    }
    lock.current = true
    setBusy(true)
    setError(null)
    setValidation('')
    try {
      const result =
        kind === 'people'
          ? await api.createPerson(normalized)
          : kind === 'categories'
            ? await api.createCategory(normalized)
            : await api.createMethod(
                normalized,
                type as PaymentMethodType,
                owner || null,
              )
      onCreated(kind, result)
    } catch (failure) {
      setError(failure)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className="add-payment-panel reference-editor"
      aria-labelledby="reference-title"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          void save()
        }
      }}
    >
      <h2 id="reference-title">{labels[kind]}</h2>
      <p className="field-hint">
        Se guardará para los dos. Crear una persona no le asigna un consumo ni
        la convierte en una cuenta de acceso.
      </p>
      <fieldset disabled={busy} className="plain-fieldset">
        <div className="form-field">
          <label htmlFor="reference-name">Nombre</label>
          <input
            ref={input}
            id="reference-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </div>
        {kind === 'methods' && (
          <>
            <SelectField
              id="reference-type"
              label="Tipo de medio de pago"
              value={type}
              onChange={(event) =>
                setType(event.target.value as PaymentMethodType)
              }
            >
              <option value="">Selecciona un tipo</option>
              {Object.entries(methodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="reference-owner"
              label="Titular registrado (opcional)"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              hint="Es un dato del medio. Quién aporta el dinero se elige aparte."
            >
              <option value="">Sin titular registrado</option>
              {references.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </SelectField>
          </>
        )}
      </fieldset>
      {validation && (
        <p className="field-error" role="alert">
          {validation}
        </p>
      )}
      {error != null && <ApiFeedback error={error} context="reference" />}
      {busy && <LoadingNotice text="Guardando la opción…" />}
      <div className="add-method-actions">
        <Button onClick={() => void save()} disabled={busy}>
          {busy
            ? 'Guardando…'
            : kind === 'people'
              ? 'Guardar persona'
              : 'Añadir y usar'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}
