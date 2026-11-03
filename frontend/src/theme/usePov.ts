import { useContext } from 'react'
import { PovContext } from './PovContext'

export function usePov() {
  const context = useContext(PovContext)
  if (!context) throw new Error('usePov must be used within a PovProvider')
  return context
}
