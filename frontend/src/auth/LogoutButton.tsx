import { Button } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'
import { useAuth } from './useAuth'

export function LogoutButton() {
  const { phase, operation, logout } = useAuth()
  if (phase !== 'authenticated') return <span>Acceso compartido y privado</span>
  return <Button variant="ghost" className="logout-button" onClick={() => void logout()} disabled={operation !== null}><Icon name="lock" />{operation === 'logout' ? 'Cerrando…' : 'Cerrar sesión'}</Button>
}
