import type { ComponentPropsWithoutRef } from 'react'

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`button ${className}`} data-variant={variant} {...props} />
}
