import type { ComponentPropsWithoutRef } from 'react'

export function Card({ className = '', ...props }: ComponentPropsWithoutRef<'section'>) {
  return <section className={`card ${className}`} {...props} />
}
