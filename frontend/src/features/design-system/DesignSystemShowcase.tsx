import { useState } from 'react'
import { themes } from '../../theme/themes'
import { usePov } from '../../theme/usePov'
import { ThemeArtwork } from '../../components/ThemeArtwork'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Icon } from '../../components/ui/Icon'
import { FinancialSummary } from './FinancialSummary'

export function DesignSystemShowcase() {
  const { pov } = usePov()
  const theme = themes[pov]
  const [confirmed, setConfirmed] = useState(false)

  return (
    <>
      <div className="page-intro">
        <div>
          <h1>{theme.headline}</h1>
          <p>Un mismo lugar para organizar lo cotidiano, a nuestra manera.</p>
        </div>
        <ThemeArtwork />
      </div>

      <div className="example-notice"><span className="notice-mark"><Icon name="sparkle" /></span><p><strong>Estamos construyendo algo nuestro.</strong> Esta es una muestra visual con datos de ejemplo.</p></div>

      <div className="overview-grid">
        <FinancialSummary />
        <Card className="theme-card" aria-labelledby="theme-title">
          <div className="card-heading"><h2 id="theme-title">A tu manera</h2><Icon name="heart" /></div>
          <p className="theme-name">{theme.name}</p>
          <p className="supporting-text">{theme.description}</p>
          <div className="palette" aria-label="Colores de esta perspectiva">
            <span className="swatch swatch-primary" title="Principal" />
            <span className="swatch swatch-secondary" title="Secundario" />
            <span className="swatch swatch-mint" title="Menta" />
            <span className="swatch swatch-yellow" title="Amarillo" />
            <span className="swatch swatch-ink" title="Texto" />
          </div>
          <div className="theme-card-note"><Icon name="check" /><p>Cambia la perspectiva arriba.<br />El estilo cambia; los ejemplos se mantienen.</p></div>
        </Card>
      </div>

      <section className="component-section" aria-labelledby="components-title">
        <div className="section-heading"><h2 id="components-title">Pequeños detalles, una misma idea.</h2><span>Así se siente nuestro espacio</span></div>
        <Card className="component-gallery" aria-label="Muestra de componentes">
          <div className="actions-demo">
            <h3>Acciones claras</h3>
            <p className="supporting-text">Cada botón tiene su lugar, sin complicarnos.</p>
            <div className="button-examples">
              <Button onClick={() => setConfirmed(true)}><Icon name="check" />Probar confirmación</Button>
              <Button variant="secondary" onClick={() => setConfirmed(false)}>Restablecer</Button>
              <Button disabled>Guardar gasto</Button>
            </div>
            <p className="demo-feedback" role="status">{confirmed ? 'Listo. Así se verá una confirmación.' : 'Prueba visual: todavía no se guardan gastos.'}</p>
          </div>
          <div className="statuses-demo">
            <h3>Todo, un poco más claro</h3>
            <p className="supporting-text">Estados con texto y color para reconocerlos fácilmente.</p>
            <div className="status-examples"><Badge tone="success"><Icon name="check" />Al día</Badge><Badge tone="warning">Pendiente</Badge><Badge tone="info">Por revisar</Badge></div>
            <p className="supporting-text status-caption">Etiquetas ilustrativas, sin movimientos reales.</p>
          </div>
        </Card>
      </section>
      <p className="perspective-note">La perspectiva es una preferencia visual, no una identidad ni una asignación de gastos.</p>
    </>
  )
}
