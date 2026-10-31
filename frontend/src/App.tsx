import { AppShell } from './components/AppShell'
import { NewExpenseScreen } from './features/expenses/NewExpenseScreen'

function App() {
  return (
    <AppShell>
      <NewExpenseScreen />
    </AppShell>
  )
}

export default App
