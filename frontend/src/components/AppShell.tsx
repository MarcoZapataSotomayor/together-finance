import type { ReactNode } from 'react'
import { PovSelector } from './PovSelector'
import { Icon } from './ui/Icon'

export function AppShell({ children, headerAction }: { children: ReactNode; headerAction?: ReactNode }) {
  return (
    <div className="expense-app">
      <svg className="comic-skyline" viewBox="0 0 1200 170" preserveAspectRatio="none" aria-hidden="true"><path d="M0 170V80h20V48h9v32h25v45h20V96h17v-45h8V25h6v26h12v45h18v50h26v-30h12V87h23v29h18v54h588v-28h26V95h30V57h10V40l35-20 35 20v17h9v38h24v47h19V78h15V62h35v16h18v49h13V92h32V68h8V44h9v24h20v24h30v78Z" /></svg>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Saltar al contenido</a>
      <header className="expense-header">
        <div className="expense-masthead"><a href="#/expenses/new" className="expense-brand"><Icon name="heart" />Together Finance</a>{headerAction ?? <span>Un espacio compartido y privado</span>}</div>
        <div className="pov-frame"><PovSelector /></div>
      </header>
      <main id="main-content" className="expense-main" tabIndex={-1}>{children}</main>
      <footer className="expense-footer"><Icon name="heart" /><span>Una perspectiva distinta. El mismo espacio para los dos.</span></footer>
    </div>
  )
}
