import { AppShell } from './components/AppShell'
import { ExpenseWorkspace } from './features/expenses/ExpenseWorkspace'
import { AuthGate } from './auth/AuthGate'
import { LogoutButton } from './auth/LogoutButton'
import { useAuth } from './auth/useAuth'
import { ExpenseDraftProvider } from './features/expenses/ExpenseDraftProvider'
import { DebtDraftProvider } from './features/debts/DebtDraftProvider'

function App() {
  const { logoutVersion } = useAuth()
  return (
    <AppShell headerAction={<LogoutButton />}>
      <ExpenseDraftProvider key={logoutVersion}><DebtDraftProvider><AuthGate><ExpenseWorkspace /></AuthGate></DebtDraftProvider></ExpenseDraftProvider>
    </AppShell>
  )
}

export default App
