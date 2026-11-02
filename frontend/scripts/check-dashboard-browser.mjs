import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { installAnalyticsMock } from '../tests/browser/analytics-mock.mjs'
import { analyticsIds as ids } from '../tests/analytics-fixtures.mjs'
import { monthRange } from '../src/features/dashboard/dashboardModel.ts'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = `${root}/node_modules/.cache/dashboard-review`
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
  })
  page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', (error) => errors.push(error.message))
  const month = await page.evaluate(() => {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }),
    state = await installAnalyticsMock(context, month)
  let sequence = 0
  const open = async () => {
    await page.goto(`${url}/?dashboard-check=${++sequence}#/dashboard`)
    await page.locator('.dashboard').waitFor()
  }
  const amount = () => page.locator('.dashboard-spending-amount')
  const button = (name) => page.getByRole('button', { name, exact: true })
  await open()
  await amount().filter({ hasText: 'S/ 160.01' }).waitFor()
  assert.equal(await page.locator('.dashboard-recent li').count(), 3)
  await page
    .locator('.pov-selector input[value=antonella]')
    .check({ force: true })
  await amount().filter({ hasText: 'S/ 70.01' }).waitFor()
  assert.ok(state.reads.some((row) => row.personId === ids.antonella))
  await page.locator('.dashboard-scope-options > summary').click()
  await page
    .getByLabel('Persona del resumen', { exact: true })
    .selectOption(ids.marco)
  await amount().filter({ hasText: 'S/ 90.00' }).waitFor()
  await page.locator('.dashboard-period > summary').click()
  await page
    .getByLabel('Cómo elegir el período', { exact: true })
    .selectOption('range')
  const dates = monthRange(month)
  await page
    .locator('.dashboard')
    .getByLabel('Desde', { exact: true })
    .fill(dates.to)
  await page
    .locator('.dashboard')
    .getByLabel('Hasta', { exact: true })
    .fill(dates.from)
  await button('Aplicar período').click()
  await page
    .getByText('Usa fechas válidas y un inicio anterior o igual al fin.', {
      exact: true,
    })
    .waitFor()
  await page
    .locator('.dashboard')
    .getByLabel('Desde', { exact: true })
    .fill(dates.from)
  await page
    .locator('.dashboard')
    .getByLabel('Hasta', { exact: true })
    .fill(dates.to)
  await button('Aplicar período').click()
  await amount().filter({ hasText: 'S/ 90.00' }).waitFor()
  assert.equal(
    await page.getByLabel('Persona del resumen', { exact: true }).inputValue(),
    ids.marco,
  )
  await page.locator('.pov-selector input[value=marco]').check({ force: true })
  await amount().filter({ hasText: 'S/ 90.00' }).waitFor()
  await page.locator('.pov-selector input[value=shared]').check({ force: true })
  await amount().filter({ hasText: 'S/ 160.01' }).waitFor()
  await page
    .getByRole('heading', { name: 'Compromisos pendientes', exact: true })
    .waitFor()
  assert.equal(
    await page.getByText('Saldo disponible', { exact: true }).count(),
    0,
  )
  assert.equal(await page.getByText('Ingresos', { exact: true }).count(), 0)

  // Errors never become fabricated zero financial data, and access recovery is bounded.
  state.fail = 503
  await button('Actualizar resumen').click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'No pudimos cargar el resumen' })
    .waitFor()
  assert.equal(await amount().count(), 0)
  state.fail = 0
  await button('Volver a cargar').click()
  await amount().waitFor()
  await page.waitForLoadState('networkidle')
  state.expireNext = true
  await button('Actualizar resumen').click()
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-browser-only-password')
  assert.equal(await page.locator('.dashboard').count(), 0)
  await button('Entrar a nuestro espacio').click()
  await amount().waitFor()

  state.delayUntil = Date.now() + 3500
  await button('Actualizar resumen').click()
  await page
    .getByText(
      'El servidor está despertando… El intento es limitado; no vuelvas a enviar el formulario.',
      { exact: true },
    )
    .waitFor()
  await amount().waitFor()
  // Missing/ambiguous name resolution is explicit and shared with the debt module.
  state.finance.people.push({
    ...state.finance.people[0],
    id: '00000000-0000-4000-8000-000000000009',
  })
  await open()
  await page
    .locator('.pov-selector input[value=antonella]')
    .check({ force: true })
  await page
    .getByRole('heading', {
      name: 'Elige una persona para continuar',
      exact: true,
    })
    .waitFor()
  await page
    .getByLabel('Persona para la perspectiva Antonella', { exact: true })
    .selectOption(ids.antonella)
  await amount().filter({ hasText: 'S/ 70.01' }).waitFor()
  state.finance.people.pop()

  let layouts = 0
  for (const theme of ['antonella', 'shared', 'marco'])
    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await open()
      await page
        .locator(`.pov-selector input[value=${theme}]`)
        .check({ force: true })
      await amount().waitFor()
      await page.waitForFunction(
        () => !document.querySelector('.dashboard .auth-spinner'),
      )
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        duplicateIds: [...document.querySelectorAll('[id]')]
          .map((node) => node.id)
          .filter((id, index, all) => all.indexOf(id) !== index),
        unlabeled: [
          ...document.querySelectorAll('.dashboard input,.dashboard select'),
        ].filter((node) => !node.labels?.length).length,
        short: [
          ...document.querySelectorAll(
            '.dashboard .button,.dashboard input,.dashboard select',
          ),
        ].filter(
          (node) =>
            node.getClientRects().length &&
            node.getBoundingClientRect().height < 43,
        ).length,
      }))
      assert.ok(
        metrics.scroll <= metrics.width,
        `${theme} ${width}: page overflow (${metrics.scroll})`,
      )
      assert.deepEqual(metrics.duplicateIds, [])
      assert.equal(metrics.unlabeled, 0)
      assert.equal(metrics.short, 0)
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `${output}/${theme}-${width}.png`,
          fullPage: true,
        })
      layouts++
    }
  state.rows = []
  await open()
  await amount().filter({ hasText: 'S/ 0.00' }).waitFor()
  await page
    .getByText(
      'Todavía no hay gasto atribuido por categoría en este período.',
      { exact: true },
    )
    .waitFor()
  assert.equal(await page.locator('.dashboard-recent li').count(), 0)
  assert.equal(
    state.finance.requests.filter((row) => row.method !== 'GET').length,
    0,
  )
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      layouts,
      analyticsImplementation:
        'built production service with read-only synthetic adapter',
      liveFinancialWrites: 0,
      checks:
        'POV/mapping, exact allocation/funding, dates, empty states, API errors, expiry, cold start, labels, touch targets, overflow',
    }),
  )
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true })
  throw error
} finally {
  await browser?.close()
  await server.close()
}
