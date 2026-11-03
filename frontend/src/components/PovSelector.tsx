import { povOptions, themes } from '../theme/themes'
import type { Pov } from '../theme/themes'
import { usePov } from '../theme/usePov'
import { Icon } from './ui/Icon'
import { useState } from 'react'
import type { IconName } from './ui/Icon'

const povIcons: Record<Pov, IconName> = {
  antonella: 'person',
  shared: 'people',
  marco: 'person',
}

export function PovSelector() {
  const { pov, setPov } = usePov()
  const [interacted, setInteracted] = useState(false)

  return (
    <fieldset className="pov-selector" aria-describedby="pov-help" data-motion-ready={interacted || undefined}>
      <legend className="sr-only">Elige tu perspectiva</legend>
      <div className="pov-options">
        {povOptions.map((option) => (
          <label className="pov-option" key={option}>
            <input className="sr-only" type="radio" name="pov" value={option} checked={pov === option} onChange={() => { setInteracted(true); setPov(option) }} />
            <span><Icon name={povIcons[option]} />{themes[option].label}</span>
          </label>
        ))}
      </div>
      <p id="pov-help" className="sr-only">La perspectiva cambia el estilo visual. No identifica a una persona ni asigna quién paga o a quién pertenece el consumo.</p>
    </fieldset>
  )
}
