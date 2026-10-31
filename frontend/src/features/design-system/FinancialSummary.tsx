import { useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Icon } from '../../components/ui/Icon'

const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

// These examples are independent of POV and never imply financial ownership.
const exampleSummary = { income: 3200000, expenses: 1360000 }
const exampleCategories = [
  { label: 'Hogar', amount: 780000 },
  { label: 'Alimentación', amount: 420000 },
  { label: 'Transporte', amount: 160000 },
]

export function FinancialSummary() {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <Card className="summary-card" aria-labelledby="summary-title">
      <div className="card-heading">
        <h2 id="summary-title">Un vistazo al mes</h2>
        <Badge>Ejemplo</Badge>
      </div>
      <p className="supporting-text">Un resumen sencillo para ver todo con claridad.</p>
      <dl className="summary-values">
        <div className="balance-value">
          <dt>Saldo disponible</dt>
          <dd>{currency.format(exampleSummary.income - exampleSummary.expenses)}<span>COP</span></dd>
        </div>
        <div className="summary-split">
          <div><dt><span className="legend-dot income-dot" />Ingresos</dt><dd>{currency.format(exampleSummary.income)}</dd></div>
          <div><dt><span className="legend-dot expense-dot" />Gastos</dt><dd>{currency.format(exampleSummary.expenses)}</dd></div>
        </div>
      </dl>
      <div className="summary-bottom">
        <span className="supporting-text">Valores ficticios en pesos colombianos</span>
        <Button variant="ghost" aria-expanded={showDetails} aria-controls="example-breakdown" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? 'Ocultar desglose' : 'Ver desglose'}<Icon name="chevron" className={showDetails ? 'rotate-180' : ''} />
        </Button>
      </div>
      <div id="example-breakdown" hidden={!showDetails} className="example-breakdown">
        <h3>Gastos de ejemplo</h3>
        <dl>{exampleCategories.map(({ label, amount }) => <div key={label}><dt>{label}</dt><dd>{currency.format(amount)}</dd></div>)}</dl>
      </div>
    </Card>
  )
}
