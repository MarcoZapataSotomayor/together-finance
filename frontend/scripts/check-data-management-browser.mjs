import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { installDataManagementMock } from '../tests/browser/data-management-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = `${root}/node_modules/.cache/data-management-review`
await mkdir(output, { recursive: true })
const server = await createServer({
  root,
  envDir: false,
  logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}`
let browser, page
const errors = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    timezoneId: 'America/Bogota',
    acceptDownloads: true,
  })
  const state = await installDataManagementMock(context)
  page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', (e) => errors.push(e.message))
  let sequence = 0
  const open = async (path) => {
    await page.goto(`${url}/?check=${++sequence}#/${path}`)
    await page.locator('.data-management').waitFor()
  }
  const area = () => page.locator('.data-management')
  await open('exports')
  await area()
    .getByLabel('Persona involucrada')
    .selectOption(state.finance.people[0].id)
  await area().getByLabel('Desde', { exact: true }).fill('2026-10-01')
  await area().getByLabel('Hasta', { exact: true }).fill('2026-10-31')
  const downloadEvent = page.waitForEvent('download')
  await area()
    .getByRole('button', { name: 'Descargar CSV', exact: true })
    .click()
  const download = await downloadEvent
  await download.saveAs(`${output}/example.csv`)
  assert.deepEqual(
    [...(await readFile(`${output}/example.csv`)).subarray(0, 3)],
    [239, 187, 191],
  )
  assert.equal(
    download.suggestedFilename(),
    'together-finance-consumos-ejemplo.csv',
  )
  assert.equal(
    state.requests.find((r) => r.path === 'exports/expenses.csv').query
      .personId,
    state.finance.people[0].id,
  )
  state.failExport = 413
  await area()
    .getByRole('button', { name: 'Descargar CSV', exact: true })
    .click()
  await area()
    .getByText(
      'El archivo supera el límite. Reduce las fechas o filtra por persona.',
      { exact: true },
    )
    .waitFor()
  state.delayExport = 1500
  const downloads = []
  page.on('download', (d) => downloads.push(d))
  await area()
    .getByRole('button', { name: 'Descargar CSV', exact: true })
    .click()
  await area()
    .getByRole('button', { name: 'Cancelar descarga', exact: true })
    .click()
  await area().getByText('Descarga cancelada.', { exact: true }).waitFor()
  await page.waitForTimeout(1600)
  assert.equal(downloads.length, 0)
  state.failExport = -1
  await area()
    .getByRole('button', { name: 'Descargar CSV', exact: true })
    .click()
  await area()
    .getByRole('alert')
    .filter({ hasText: 'No pudimos confirmar' })
    .waitFor()
  assert.equal(
    await area().getByLabel('Desde', { exact: true }).inputValue(),
    '2026-10-01',
  )

  await open('recycle-bin')
  await area().getByText('3 registros eliminados', { exact: true }).waitFor()
  const payment = () =>
    area().locator('.data-bin-entry').filter({ hasText: 'Pago sintético' })
  assert.equal(
    await payment()
      .getByRole('button', { name: /Restaurar pago:/ })
      .isDisabled(),
    true,
  )
  await area().getByLabel('Tipo de registro').selectOption('loan')
  await area()
    .getByRole('button', { name: 'Aplicar filtros', exact: true })
    .click()
  await area().getByText('1 registro eliminado', { exact: true }).waitFor()
  await area().getByLabel('Eliminado desde (UTC)').fill('2026-11-02')
  await area()
    .getByRole('button', { name: 'Aplicar filtros', exact: true })
    .click()
  await area()
    .getByRole('heading', { name: 'No hay registros eliminados' })
    .waitFor()
  await area().getByRole('button', { name: 'Limpiar', exact: true }).click()
  await area().getByText('3 registros eliminados', { exact: true }).waitFor()
  const expense = () =>
    area()
      .locator('.data-bin-entry')
      .filter({ hasText: 'Consumo sintético, con "detalle"' })
  state.finance.rejectNextWrite = 409
  await expense()
    .getByRole('button', { name: /Restaurar consumo:/ })
    .click()
  await area()
    .getByRole('alert')
    .filter({ hasText: 'No pudimos confirmar el pago o la restauración' })
    .waitFor()
  assert.equal(state.expenseDeleted, true)
  await expense()
    .getByRole('button', { name: /Restaurar consumo:/ })
    .click()
  await area().getByText('2 registros eliminados', { exact: true }).waitFor()
  assert.equal(state.expenseDeleted, false)
  assert.equal(
    state.requests.filter((r) => r.path.endsWith('/restore')).length,
    2,
  )
  assert.equal(
    state.requests.find((r) => r.path.endsWith('/restore')).csrf,
    'T'.repeat(43),
  )
  const loan = () =>
    area().locator('.data-bin-entry').filter({ hasText: 'Préstamo sintético' })
  await loan()
    .getByRole('button', { name: /Restaurar préstamo:/ })
    .click()
  await area().getByText('1 registro eliminado', { exact: true }).waitFor()
  assert.equal(
    await payment()
      .getByRole('button', { name: /Restaurar pago:/ })
      .isDisabled(),
    false,
  )
  await payment()
    .getByRole('button', { name: /Restaurar pago:/ })
    .click()
  await area()
    .getByRole('heading', { name: 'No hay registros eliminados' })
    .waitFor()
  assert.equal(
    state.finance.requests
      .filter((r) => r.path.endsWith('/restore'))
      .every((r) => r.csrf === 'T'.repeat(43)),
    true,
  )

  state.failBin = 401
  await open('exports')
  await page.getByRole('link', { name: 'Eliminados', exact: true }).click()
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('Synthetic browser test only')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await area()
    .getByRole('heading', { name: 'No hay registros eliminados' })
    .waitFor()
  state.expenseDeleted = true
  state.finance.debts[0].deletedAt = '2026-11-01T12:00:00.000Z'
  state.finance.payments[0].deletedAt = '2026-11-01T13:00:00.000Z'
  let layouts = 0
  for (const path of ['exports', 'recycle-bin']) {
    await open(path)
    if (path === 'recycle-bin')
      await area()
        .getByText('3 registros eliminados', { exact: true })
        .waitFor()
    for (const theme of ['antonella', 'shared', 'marco']) {
      await page
        .locator(`.pov-selector input[value=${theme}]`)
        .check({ force: true })
      for (const width of [320, 375, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => document.fonts.ready)
        const metrics = await page.evaluate(() => {
          const visible = (n) => !!n.getClientRects().length
          const controls = [
            ...document.querySelectorAll(
              '.data-management button,.data-management input,.data-management select',
            ),
          ].filter(visible)
          return {
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            ids: [...document.querySelectorAll('[id]')]
              .map((n) => n.id)
              .filter((id, i, all) => all.indexOf(id) !== i),
            short: controls
              .filter((n) => n.getBoundingClientRect().height < 43)
              .map((n) => n.id || n.textContent),
            unlabeled: controls.filter(
              (n) => n.matches('input,select') && !n.labels?.length,
            ).length,
          }
        })
        assert.ok(
          metrics.scroll <= metrics.width,
          `${path} ${theme} ${width}: overflow ${metrics.scroll}`,
        )
        assert.deepEqual(metrics.ids, [])
        assert.deepEqual(metrics.short, [])
        assert.equal(metrics.unlabeled, 0)
        if ([390, 1440].includes(width))
          await page.screenshot({
            path: `${output}/${path}-${theme}-${width}.png`,
            fullPage: true,
          })
        layouts++
      }
    }
  }
  await page.getByLabel('Tipo de registro').focus()
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'bin-from',
  )
  assert.notEqual(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle,
    ),
    'none',
  )
  assert.deepEqual(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        /auth|token|expense|repayment|loan|csv/i.test(k),
      ),
    ),
    [],
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      layouts,
      checks:
        'CSV bytes/download/cancel/network, filters/empty, restore/conflict/CSRF/parent, expiry/login, themes, overflow/tap targets/labels/focus',
      liveFinancialWrites: 0,
    }),
  )
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true })
  throw error
} finally {
  await browser?.close()
  await server.close()
}
