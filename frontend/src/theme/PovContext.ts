import { createContext } from 'react'
import type { Pov } from './themes'

export interface PovContextValue {
  pov: Pov
  setPov: (pov: Pov) => void
}

export const PovContext = createContext<PovContextValue | undefined>(undefined)
