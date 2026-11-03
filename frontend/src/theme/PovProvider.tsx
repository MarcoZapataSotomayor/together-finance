import { useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PovContext } from './PovContext'
import { readStoredPov, storePov } from './storage'
import { isPov } from './themes'
import type { Pov } from './themes'

export function PovProvider({ children }: { children: ReactNode }) {
  const [pov, updatePov] = useState<Pov>(readStoredPov)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = pov
  }, [pov])

  useEffect(() => {
    storePov(pov)
  }, [pov])

  function setPov(value: Pov) {
    if (isPov(value)) updatePov(value)
  }

  return <PovContext.Provider value={{ pov, setPov }}>{children}</PovContext.Provider>
}
