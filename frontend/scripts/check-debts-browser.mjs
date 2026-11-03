import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { installDebtMock } from '../tests/browser/debt-mock.mjs'
import {
  debtIds as ids,
  debtRecord,
  debtPeople,
} from '../tests/debt-fixtures.mjs'

// Optional browser validation: supply an existing Playwright module/executable externally.
// No package is installed and no request is forwarded to the financial API.
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(
  new URL('../node_modules/.cache/debt-review/', import.meta.url),
)
await mkdir(output, { recursive: true })
const server = await createServer({
  root,
  envDir: false,
  logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const address = server.httpServer.address()
const url = `http://127.0.0.1:${address.port}`
let browser
const errors = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const state = await installDebtMock(context)
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', (error) => errors.push(error.message))
  const heading = (text) =>
    page.getByRole('heading', { name: text, exact: true })
  let navigation = 0
  const route = async (path) => {
    await page.goto(`${url}/?browser-check=${++navigation}#${path}`)
    await page.locator('.debt-frame').waitFor()
  }
  const field = (label) =>
    page.locator('.debt-frame').getByLabel(label, { exact: true })
  const button = (text) => page.getByRole('button', { name: text, exact: true })
  const countWrites = () =>
    state.requests.filter(
      (row) => row.method === 'POST' && !row.path.includes('/restore'),
    ).length

  await route('/debts')
  await page
    .locator('.debt-total-strip > strong')
    .filter({ hasText: 'S/ 130.00' })
    .waitFor()
  await page
    .locator('.pov-selector input[value=antonella]')
    .check({ force: true })
  await heading('Lo que debe Antonella').waitFor()
  await heading('Lo que le deben a Antonella').waitFor()
  assert.ok(
    state.requests.some((row) => row.query.debtorPersonId === ids.antonella),
  )
  assert.ok(
    state.requests.some((row) => row.query.creditorPersonId === ids.antonella),
  )
  await page.locator('.pov-selector input[value=marco]').check({ force: true })
  await heading('Lo que debe Marco').waitFor()

  await route('/loans/new')
  await field('Quién debe el dinero').waitFor()
  assert.equal(await field('Quién debe el dinero').inputValue(), '')
  assert.equal(await field('Quién presta el dinero').inputValue(), '')
  await button('Guardar préstamo').click()
  await page.locator('.debt-frame [aria-invalid=true]').first().waitFor()
  await page.waitForFunction(
    (id) => document.activeElement?.id === id,
    await field('Quién debe el dinero').getAttribute('id'),
  )
  assert.equal(
    await field('Quién debe el dinero').evaluate(
      (node) => document.activeElement === node,
    ),
    true,
  )
  await field('Quién debe el dinero').selectOption(ids.antonella)
  await field('Quién presta el dinero').selectOption(ids.relative)
  await field('Monto del préstamo (S/)').fill('20,01')
  await field('Fecha del préstamo').fill('2026-10-30')
  await field('Descripción (opcional)').fill('Préstamo nuevo sintético')
  await page
    .locator('.pov-selector input[value=antonella]')
    .check({ force: true })
  assert.equal(await field('Quién presta el dinero').inputValue(), ids.relative)
  state.lostNextCreation = true
  await button('Guardar préstamo').click()
  await button('Consultar envío del préstamo').waitFor()
  const sent = state.requests
    .filter((row) => row.path === 'loans' && row.method === 'POST')
    .at(-1)
  await button('Reintentar el mismo préstamo').click()
  await page
    .getByRole('link', { name: 'Ver préstamo guardado', exact: true })
    .waitFor()
  const repeated = state.requests
    .filter((row) => row.path === 'loans' && row.method === 'POST')
    .at(-1)
  assert.deepEqual(repeated.body, sent.body)
  assert.equal(state.debts.filter((row) => row.id === sent.body.id).length, 1)

  await route(`/loans/${sent.body.id}/edit`)
  await field('Descripción (opcional)').fill('Nota corregida sintética')
  await button('Guardar cambios').click()
  await heading('Cambios guardados').waitFor()
  assert.deepEqual(
    state.requests.filter((row) => row.method === 'PATCH').at(-1).body,
    { description: 'Nota corregida sintética' },
  )

  await route(`/debts/${ids.loan}/pay`)
  await field('Persona que paga').selectOption(ids.antonella)
  await field('Persona que recibe').selectOption(ids.marco)
  await field('Monto del pago (S/)').fill('100.01')
  await button('Guardar pago').click()
  await page
    .getByText(
      'El pago supera el pendiente actual. Revisa el detalle antes de guardar.',
      { exact: true },
    )
    .waitFor()
  await field('Monto del pago (S/)').fill('30')
  await field('Fecha del pago').fill('2026-10-31')
  state.lostNextCreation = true
  await button('Guardar pago').click()
  await button('Consultar envío del pago').waitFor()
  const partial = state.requests
    .filter((row) => row.path.endsWith('/repayments') && row.method === 'POST')
    .at(-1)
  const beforeInspect = countWrites()
  await button('Consultar envío del pago').click()
  await heading('Pago guardado').waitFor()
  assert.equal(countWrites(), beforeInspect)
  assert.equal(state.payments.length, 1)

  await route(`/debts/${ids.loan}/pay`)
  await field('Persona que paga').selectOption(ids.antonella)
  await field('Persona que recibe').selectOption(ids.marco)
  await button('Usar pendiente completo: S/ 70.00').click()
  assert.equal(await field('Monto del pago (S/)').inputValue(), '70.00')
  await field('Fecha del pago').fill('2026-10-31')
  state.rejectNextWrite = 409
  await button('Guardar pago').click()
  await button('Corregir datos conservando el identificador').waitFor()
  const rejectedFull = state.requests
    .filter((row) => row.path.endsWith('/repayments') && row.method === 'POST')
    .at(-1)
  await button('Corregir datos conservando el identificador').click()
  await field('Fecha del pago').fill('2026-11-01')
  await button('Enviar corrección con el mismo identificador').click()
  await heading('Pago guardado').waitFor()
  assert.equal(
    state.requests
      .filter(
        (row) => row.path.endsWith('/repayments') && row.method === 'POST',
      )
      .at(-1).body.id,
    rejectedFull.body.id,
  )

  await route(`/loans/${ids.loan}/edit`)
  assert.equal(await field('Monto del préstamo (S/)').isDisabled(), true)
  assert.equal(await field('Quién presta el dinero').isDisabled(), true)
  await field('Descripción (opcional)').fill('Descripción con pagos')
  state.rejectNextWrite = 409
  await button('Guardar cambios').click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'Hay un conflicto' })
    .waitFor()
  assert.equal(
    await field('Descripción (opcional)').inputValue(),
    'Descripción con pagos',
  )

  await route(`/repayments/${partial.body.id}`)
  await button('Eliminar pago').click()
  await button('Cancelar eliminación').click()
  await page.waitForFunction(
    () => document.activeElement?.textContent === 'Eliminar pago',
  )
  assert.equal(
    await button('Eliminar pago').evaluate(
      (node) => document.activeElement === node,
    ),
    true,
  )
  await button('Eliminar pago').click()
  await button('Sí, eliminar pago').click()
  await button('Restaurar pago').waitFor()
  await route(`/debts/${ids.loan}/pay`)
  await field('Persona que paga').selectOption(ids.antonella)
  await field('Persona que recibe').selectOption(ids.marco)
  await button('Usar pendiente completo: S/ 30.00').click()
  await button('Guardar pago').click()
  await heading('Pago guardado').waitFor()
  const replacement = state.requests
    .filter((row) => row.path.endsWith('/repayments') && row.method === 'POST')
    .at(-1)
  await route(`/repayments/${partial.body.id}`)
  await button('Restaurar pago').click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'puede superar el pendiente actual' })
    .waitFor()
  await route(`/repayments/${replacement.body.id}`)
  await button('Eliminar pago').click()
  await button('Sí, eliminar pago').click()
  await button('Restaurar pago').waitFor()
  await route(`/repayments/${partial.body.id}`)
  await button('Restaurar pago').click()
  await button('Eliminar pago').waitFor()

  await route(`/loans/${ids.loan}`)
  await button('Eliminar préstamo').click()
  await button('Sí, eliminar préstamo').click()
  await button('Restaurar préstamo').waitFor()
  await route('/loans')
  await page.locator('.debt-filter-disclosure > summary').click()
  await field('Registros').selectOption('deleted')
  await button('Aplicar filtros').click()
  await page
    .getByRole('link', { name: 'Ver y restaurar', exact: true })
    .waitFor()
  assert.ok(
    state.requests.some(
      (row) => row.path === 'loans' && row.query.deletionState === 'deleted',
    ),
  )
  await page.getByRole('link', { name: 'Ver y restaurar', exact: true }).click()
  await button('Restaurar préstamo').click()
  await button('Eliminar préstamo').waitFor()

  // Drafts and UUIDs survive authentication expiry, while private DOM disappears.
  await route('/loans/new')
  await field('Quién debe el dinero').selectOption(ids.antonella)
  await field('Quién presta el dinero').selectOption(ids.marco)
  await field('Monto del préstamo (S/)').fill('12.34')
  state.rejectNextWrite = 401
  await button('Guardar préstamo').click()
  await page.getByLabel('Contraseña compartida', { exact: true }).waitFor()
  assert.equal(await page.locator('.debt-frame').count(), 0)
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-browser-only-password')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await field('Monto del préstamo (S/)').waitFor()
  assert.equal(await field('Monto del préstamo (S/)').inputValue(), '12.34')
  state.lostNextCreation = true
  await button('Guardar préstamo').click()
  await button('Consultar envío del préstamo').waitFor()
  const beforeExpiry = countWrites()
  state.expireNextRead = true
  await button('Consultar envío del préstamo').click()
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-browser-only-password')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await button('Consultar envío del préstamo').click()
  await page
    .getByRole('link', { name: 'Ver préstamo guardado', exact: true })
    .waitFor()
  assert.equal(countWrites(), beforeExpiry)

  await route('/loans/new')
  await field('Monto del préstamo (S/)').fill('88.00')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-browser-only-password')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await field('Monto del préstamo (S/)').waitFor()
  assert.equal(await field('Monto del préstamo (S/)').inputValue(), '')

  // Ambiguous POV names require an explicit mapping and never prefill mutation parties.
  state.people.push({
    ...state.people[0],
    id: '00000000-0000-4000-8000-000000000009',
  })
  await route('/debts')
  await page
    .locator('.pov-selector input[value=antonella]')
    .check({ force: true })
  await heading('Elige una persona para continuar').waitFor()
  await field('Persona para la perspectiva Antonella').selectOption(
    ids.antonella,
  )
  await heading('Lo que debe Antonella').waitFor()
  state.people.pop()

  state.people = []
  state.debts = []
  state.payments = []
  await route('/loans/new')
  await page
    .getByText(
      'Primero agrega al menos dos personas distintas para registrar un préstamo.',
      { exact: true },
    )
    .waitFor()
  for (const name of ['Persona de prueba A', 'Persona de prueba B']) {
    await button('Agregar persona').click()
    await page.locator('#loan-reference-name').fill(name)
    await button('Guardar persona').click()
    await page.locator('#loan-reference-name').waitFor({ state: 'hidden' })
  }
  assert.equal(await field('Quién debe el dinero').inputValue(), '')
  assert.equal(await field('Quién presta el dinero').inputValue(), '')

  // Reset synthetic data for a bounded all-theme responsive inspection.
  state.debts = [debtRecord()]
  state.payments = []
  state.people = structuredClone(debtPeople)
  const surfaces = [
    ['/debts', 'overview'],
    ['/loans/new', 'loan'],
    [`/loans/${ids.loan}`, 'detail'],
    [`/loans/${ids.loan}/edit`, 'edit'],
    [`/debts/${ids.loan}/pay`, 'payment'],
    [`/debts/${ids.loan}/repayments`, 'history'],
  ]
  let layouts = 0
  for (const theme of ['antonella', 'shared', 'marco']) {
    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const [path, name] of surfaces) {
        await route(path)
        await page
          .locator(`.pov-selector input[value=${theme}]`)
          .check({ force: true })
        await page.locator('.debt-frame').waitFor()
        await page.waitForFunction(
          () => !document.querySelector('.debt-frame .auth-spinner'),
        )
        const metrics = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          duplicateIds: [...document.querySelectorAll('[id]')]
            .map((node) => node.id)
            .filter((id, index, all) => all.indexOf(id) !== index),
          small: [
            ...document.querySelectorAll(
              '.debt-frame input:not([type=radio]), .debt-frame select, .debt-frame .button',
            ),
          ].filter(
            (node) =>
              node.getClientRects().length &&
              node.getBoundingClientRect().height < 43,
          ).length,
        }))
        assert.ok(
          metrics.scroll <= metrics.width,
          `${theme} ${width} ${name}: horizontal overflow (${metrics.scroll})`,
        )
        assert.deepEqual(
          metrics.duplicateIds,
          [],
          `${theme} ${width} ${name}: duplicate field IDs`,
        )
        assert.equal(
          metrics.small,
          0,
          `${theme} ${width} ${name}: short controls`,
        )
        if ([390, 1440].includes(width))
          await page.screenshot({
            path: `${output}/${theme}-${name}-${width}.png`,
            fullPage: true,
          })
        layouts++
      }
    }
  }
  for (const request of state.requests.filter((row) => row.method !== 'GET'))
    assert.equal(request.csrf, 'T'.repeat(43))
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key !== 'together-finance:pov'),
    ),
    false,
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      responsiveLayouts: layouts,
      syntheticWritesOnly: true,
      scenarios:
        'POV filters/mapping, validation/focus, explicit roles, loan create/edit/delete/restore, partial/full repayment, overpayment, stable retry/GET inspection, repayment delete/restore, 401 draft recovery, CSRF, no financial localStorage',
    }),
  )
} finally {
  await browser?.close()
  await server.close()
}
