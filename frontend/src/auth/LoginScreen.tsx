import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FrameOrnaments, OrnamentalDivider, StrawberrySprig } from '../components/decorations/Ornaments'
import { Button } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'
import { useAuth } from './useAuth'

export function LoginScreen() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const checking = auth.phase === 'checking'
  const busy = checking || auth.operation !== null
  const unavailable = auth.phase === 'error' || !auth.session

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || busy || unavailable) return
    const submitted = password
    setPassword(''); setVisible(false)
    await auth.login(submitted)
    input.current?.focus()
  }

  return <section className="consumption-frame login-frame" aria-labelledby="login-title">
    <FrameOrnaments />
    <StrawberrySprig className="login-crest" />
    <div className="login-lock"><Icon name="lock" /></div>
    <h1 id="login-title">Nuestro espacio</h1>
    <p className="login-intro">Una contraseña compartida.<br />Todo lo nuestro, en un mismo lugar.</p>
    <OrnamentalDivider />
    {auth.notice && <p className="auth-notice" role="status">{auth.notice}</p>}
    <div className="auth-progress" role="status" aria-live="polite">
      {auth.waking ? <><span className="auth-spinner" aria-hidden="true" /><p>El servidor está despertando…<small>Puede tardar cerca de un minuto. El intento es limitado.</small></p></> : checking ? <><span className="auth-spinner" aria-hidden="true" /><p>Comprobando el acceso…</p></> : auth.operation === 'login' ? <><span className="auth-spinner" aria-hidden="true" /><p>Abriendo nuestro espacio…</p></> : null}
    </div>
    {auth.error && <p id="auth-error" className="auth-error" role="alert">{auth.error}</p>}
    <form onSubmit={submit} className="login-form" aria-busy={busy}>
      <div className="form-field"><label htmlFor="shared-password"><Icon name="key" />Contraseña compartida</label>
        <div className="password-control"><input ref={input} id="shared-password" name="password" type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={256} required disabled={busy || unavailable} aria-describedby={auth.error ? 'auth-error' : 'login-help'} /><button type="button" className="password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} disabled={busy || unavailable}><Icon name="eye" /></button></div>
      </div>
      {unavailable && !checking ? <Button className="auth-submit" onClick={auth.reconnect}><Icon name="arrows" />Volver a conectar</Button> : <Button type="submit" className="auth-submit" disabled={busy || !password}><Icon name="lock" />{auth.operation === 'login' ? 'Entrando…' : 'Entrar a nuestro espacio'}</Button>}
    </form>
    <p id="login-help" className="login-help">El acceso es para los dos.<br />Tu perspectiva solo cambia el estilo.</p>
  </section>
}
