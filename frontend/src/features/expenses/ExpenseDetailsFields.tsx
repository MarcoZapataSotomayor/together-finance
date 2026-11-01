import { Fragment } from 'react'
import { usePov } from '../../theme/usePov'
import { SelectField, TextField } from '../../components/ui/FormField'
import { Icon } from '../../components/ui/Icon'
import type { CategoryRecord } from '../../api/types'
import type { ExpenseErrors, ExpenseValues } from './expenseModel'

interface ExpenseDetailsFieldsProps {
  values: ExpenseValues
  errors: ExpenseErrors
  categories: CategoryRecord[]
  idPrefix: string
  onUpdate: <K extends keyof ExpenseValues>(
    key: K,
    value: ExpenseValues[K],
  ) => void
}

export function ExpenseDetailsFields({
  values,
  errors,
  onUpdate,
  categories,
  idPrefix,
}: ExpenseDetailsFieldsProps) {
  const { pov } = usePov()
  const fields = {
    place: (
      <TextField
        id={`${idPrefix}-place`}
        label="Lugar de compra"
        icon="store"
        value={values.place}
        onChange={(event) => onUpdate('place', event.target.value)}
        placeholder="Ej. Tottus, Metro…"
        maxLength={200}
        autoComplete="off"
        required
        error={errors.place}
        fieldClassName="place-field"
      />
    ),
    date: (
      <TextField
        id={`${idPrefix}-date`}
        label="Fecha"
        icon="calendar"
        type="date"
        value={values.date}
        onChange={(event) => onUpdate('date', event.target.value)}
        required
        error={errors.date}
        fieldClassName="date-field"
      />
    ),
    amount: (
      <div className="amount-field">
        <TextField
          id={`${idPrefix}-amount`}
          label="Monto"
          aria-label="Monto en soles (PEN)"
          icon="coins"
          inputMode="decimal"
          value={values.amount}
          onChange={(event) => onUpdate('amount', event.target.value)}
          placeholder="0.00"
          maxLength={15}
          required
          error={errors.amount}
        />
        <span className="currency-prefix" aria-hidden="true">
          S/
        </span>
      </div>
    ),
    category: (
      <SelectField
        id={`${idPrefix}-category`}
        label="Categoría"
        icon="tag"
        value={values.category}
        onChange={(event) => onUpdate('category', event.target.value)}
        required
        error={errors.category}
        fieldClassName="category-field"
      >
        <option value="">Elige una</option>
        {values.category &&
          !categories.some((row) => row.id === values.category) && (
            <option value={values.category} disabled>
              Categoría inactiva
            </option>
          )}
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </SelectField>
    ),
    description: (
      <div className="form-field description-field">
        <label htmlFor={`${idPrefix}-description`}>
          <Icon name="note" />
          Descripción <span className="optional-label">(opcional)</span>
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={values.description}
          onChange={(event) => onUpdate('description', event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Ej. Compras del supermercado…"
          aria-invalid={!!errors.description}
          aria-describedby={
            errors.description ? `${idPrefix}-description-error` : undefined
          }
        />
        {errors.description && (
          <p id={`${idPrefix}-description-error`} className="field-error">
            {errors.description}
          </p>
        )}
      </div>
    ),
  }
  // Match each reference's reading order without changing any financial values.
  const order: (keyof typeof fields)[] =
    pov === 'marco'
      ? ['place', 'amount', 'date', 'description', 'category']
      : ['place', 'date', 'amount', 'category', 'description']

  return (
    <div className="details-grid">
      {order.map((name) => (
        <Fragment key={name}>{fields[name]}</Fragment>
      ))}
    </div>
  )
}
