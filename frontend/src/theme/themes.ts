export const themes = {
  antonella: {
    label: 'Antonella',
    name: 'Pastel y dulce',
    headline: 'Tus cuentas, con cariño.',
    description: 'Rosa suave, pequeños detalles y un poquito de dulzura.',
    signature: 'Un detalle de cariño',
  },
  shared: {
    label: 'Compartido',
    name: 'Lo bonito de compartir',
    headline: 'Un espacio para los dos.',
    description: 'La calidez del rosa y la calma del azul, en equilibrio.',
    signature: 'Mejor en compañía',
  },
  marco: {
    label: 'Marco',
    name: 'A tu propio ritmo',
    headline: 'Tus números. A tu ritmo.',
    description: 'Azul suave, trazos con carácter y un acento de rojo.',
    signature: 'Dale tu propio ritmo',
  },
} as const

export type Pov = keyof typeof themes

export const povOptions: Pov[] = ['antonella', 'shared', 'marco']
export const defaultPov: Pov = 'shared'
export const povStorageKey = 'together-finance:pov'

export function isPov(value: unknown): value is Pov {
  return typeof value === 'string' && Object.hasOwn(themes, value)
}
