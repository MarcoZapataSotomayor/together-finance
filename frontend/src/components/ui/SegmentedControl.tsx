import { Icon } from './Icon'
import type { IconName } from './Icon'

interface SegmentedControlProps<T extends string> {
  name: string
  legend: string
  value: T | ''
  options: { value: T; label: string; icon?: IconName }[]
  onChange: (value: T) => void
  error?: string
  className?: string
}

export function SegmentedControl<T extends string>({ name, legend, value, options, onChange, error, className = '' }: SegmentedControlProps<T>) {
  return <fieldset className={`segmented-field ${className}`} aria-describedby={error ? `${name}-error` : undefined} aria-invalid={!!error}>
    <legend>{legend}</legend>
    <div className="segmented-options">{options.map(option => <label key={option.value}>
      <input className="sr-only" type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span>{option.icon && <Icon name={option.icon} />}{option.label}</span>
    </label>)}</div>
    {error && <p id={`${name}-error`} className="field-error">{error}</p>}
  </fieldset>
}
