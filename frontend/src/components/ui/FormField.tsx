import type { ComponentPropsWithoutRef } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface FieldProps {
  label: string
  icon?: IconName
  error?: string
  hint?: string
  fieldClassName?: string
}

export function TextField({ label, icon, error, hint, fieldClassName = '', id, ...props }: FieldProps & ComponentPropsWithoutRef<'input'>) {
  return <div className={`form-field ${fieldClassName}`}>
    <label htmlFor={id}>{icon && <Icon name={icon} />}{label}</label>
    <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
    {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}
  </div>
}

export function SelectField({ label, icon, error, hint, fieldClassName = '', id, children, ...props }: FieldProps & ComponentPropsWithoutRef<'select'>) {
  return <div className={`form-field ${fieldClassName}`}>
    <label htmlFor={id}>{icon && <Icon name={icon} />}{label}</label>
    <div className="select-control"><select id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props}>{children}</select><Icon name="chevron" /></div>
    {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}
  </div>
}
