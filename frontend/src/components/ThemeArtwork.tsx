import type { Pov } from '../theme/themes'
import { themes } from '../theme/themes'
import { usePov } from '../theme/usePov'
import { Icon } from './ui/Icon'
import type { IconName } from './ui/Icon'

const motifs: Record<Pov, IconName[]> = {
  antonella: ['strawberry', 'ribbon', 'flower'],
  shared: ['flower', 'heart', 'sparkle'],
  marco: ['bolt', 'sparkle', 'bolt'],
}

export function ThemeArtwork() {
  const { pov } = usePov()

  return (
    <div className="theme-artwork" aria-hidden="true">
      <div className="motif-cluster">
        {motifs[pov].map((name, index) => (
          <span className={`motif motif-${index + 1}`} key={`${name}-${index}`}><Icon name={name} /></span>
        ))}
      </div>
      <span className="artwork-signature">{themes[pov].signature}</span>
    </div>
  )
}
