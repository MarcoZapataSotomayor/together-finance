import { defaultPov, isPov, povStorageKey } from './themes'
import type { Pov } from './themes'

export function readStoredPov(): Pov {
  try {
    const value = window.localStorage.getItem(povStorageKey)
    return isPov(value) ? value : defaultPov
  } catch {
    return defaultPov
  }
}

export function storePov(pov: Pov): void {
  try {
    window.localStorage.setItem(povStorageKey, pov)
  } catch {
    // The current session remains usable when browser storage is unavailable.
  }
}
