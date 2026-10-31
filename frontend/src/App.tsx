import { AppShell } from './components/AppShell'
import { NewExpenseScreen } from './features/expenses/NewExpenseScreen'
import { AuthGate } from './auth/AuthGate'
import { LogoutButton } from './auth/LogoutButton'

function App() {
  return (
    <AppShell headerAction={<LogoutButton />}>
      <AuthGate><NewExpenseScreen /></AuthGate>
    </AppShell>
  )
}

export default App
