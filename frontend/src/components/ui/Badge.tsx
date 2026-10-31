import type { ComponentPropsWithoutRef } from 'react'

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: 'neutral' | 'success' | 'warning' | 'info'
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return <span className={`badge ${className}`} data-tone={tone} {...props} />
}
