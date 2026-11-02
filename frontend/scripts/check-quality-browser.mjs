import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { installMotionMock } from '../tests/browser/motion-mock.mjs'
import { installDataManagementMock } from '../tests/browser/data-management-mock.mjs'
import { debtIds as ids } from '../tests/debt-fixtures.mjs'

// This runner never loads local environment files or contacts a financial API.
const require = createRequire(import.meta.url)
assert.ok(
  process.env.AXE_CORE_PATH,
  'Set AXE_CORE_PATH to a local axe-core/axe.min.js file',
)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = `${root}/node_modules/.cache/quality-review`
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
let browser
const report = {
  layouts: 0,
  accessibility: [],
  targets: [],
  contrast: [],
  focus: {},
  reflow: [],
  errors: [],
}
const screens = [
  ['dashboard', '/dashboard'],
  ['new-expense', '/expenses/new'],
  ['expenses', '/expenses'],
  ['expense-detail', `/expenses/${ids.expense}`],
  ['expense-edit', `/expenses/${ids.expense}/edit`],
  ['debts', '/debts'],
  ['loans', '/loans'],
  ['new-loan', '/loans/new'],
  ['loan-detail', `/loans/${ids.other}`],
  ['loan-edit', `/loans/${ids.other}/edit`],
  ['new-repayment', `/debts/${ids.other}/pay`],
  ['repayments', '/repayments'],
  ['repayment-detail', `/repayments/${ids.payment}`],
  ['exports', '/exports'],
  ['bin', '/recycle-bin'],
  ['login', '/login'],
]
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 390, height: 950 },
    timezoneId: 'America/Bogota',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  const date = new Date()
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const state = await installMotionMock(context, month)
  await installDataManagementMock(context, state.analytics.finance)
  let rejectLogin = false,
    sessionDelay = 0,
    emptyHistory = false
  await context.route('**/api/auth/session', async (route) => {
    if (sessionDelay > Date.now())
      await new Promise((resolve) =>
        setTimeout(resolve, sessionDelay - Date.now()),
      )
    return route.fallback()
  })
  await context.route('**/api/expenses**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (!url.pathname.startsWith('/api/expenses')) return route.fallback()
    if (!state.analytics.finance.authenticated)
      return route.fulfill({ status: 401, json: {} })
    if (request.method() === 'GET' && url.pathname === '/api/expenses') {
      const deleted = url.searchParams.get('deletionState') === 'deleted'
      const data =
        !emptyHistory && deleted === !!state.expense.deletedAt
          ? [state.expense]
          : []
      return route.fulfill({
        json: { data, total: data.length, page: 1, pageSize: 20 },
      })
    }
    if (
      ['DELETE', 'POST'].includes(request.method()) &&
      [
        `/api/expenses/${state.expense.id}`,
        `/api/expenses/${state.expense.id}/restore`,
      ].includes(url.pathname)
    ) {
      if (request.headers()['x-csrf-token'] !== 'T'.repeat(43))
        return route.fulfill({ status: 403, json: {} })
      state.expense.deletedAt =
        request.method() === 'DELETE' ? new Date().toISOString() : null
      return request.method() === 'DELETE'
        ? route.fulfill({ status: 204 })
        : route.fulfill({ json: state.expense })
    }
    return route.fallback()
  })
  await context.route('**/api/auth/login', (route) =>
    rejectLogin ? route.fulfill({ status: 401, json: {} }) : route.fallback(),
  )
  let sequence = 0
  const open = async (path) => {
    state.analytics.finance.authenticated = path !== '/login'
    await page.goto(`${url}/?quality=${++sequence}#${path}`)
    await page.locator('.consumption-frame:visible').last().waitFor()
    await page
      .getByText('Comprobando el acceso…', { exact: true })
      .waitFor({ state: 'hidden' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(130)
  }
  for (const theme of ['antonella', 'shared', 'marco']) {
    await open('/dashboard')
    await page.locator(`.pov-option:has(input[value=${theme}])`).click()
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    )
    const contrast = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const token = (name) => styles.getPropertyValue(`--${name}`).trim()
      const luminance = (color) => {
        const values = color.startsWith('#')
          ? color
              .slice(1)
              .match(/.{2}/g)
              .map((c) => parseInt(c, 16))
          : color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
        const [r, g, b] = values.map((c) => {
          const s = c / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const pairs = [
        ['text', 'paper'],
        ['muted-text', 'paper'],
        ['primary', 'paper'],
        ['primary-foreground', 'primary'],
        ['selection-ink', 'selection'],
        ['selection-ink', 'selection-end'],
        ['save-ink', 'save-surface'],
        ['save-ink', 'save-end'],
        ['danger', 'surface'],
        ['success', 'success-surface'],
        ['warning', 'warning-surface'],
        ['info', 'info-surface'],
      ].map(([foreground, background]) => ({
        name: `${foreground}/${background}`,
        foreground: token(foreground),
        background: token(background),
      }))
      const logout = getComputedStyle(document.querySelector('.logout-button'))
      pairs.push({
        name: 'logout',
        foreground: logout.color,
        background: logout.backgroundColor,
      })
      if (document.documentElement.dataset.theme !== 'antonella') {
        for (const selector of ['.expense-brand', '.expense-footer']) {
          const computed = getComputedStyle(document.querySelector(selector))
          pairs.push({
            name: selector,
            foreground: computed.color,
            background: computed.backgroundColor,
          })
        }
      }
      return pairs.map((pair) => {
        const a = luminance(pair.foreground),
          b = luminance(pair.background)
        return {
          ...pair,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        }
      })
    })
    report.contrast.push({ theme, pairs: contrast })
    for (const pair of contrast)
      assert.ok(
        pair.ratio >= 4.5,
        `${theme}/${pair.name}: ${pair.ratio} contrast`,
      )
    for (const [name, path] of screens) {
      await open(path)
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      for (const width of [320, 375, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 950 })
        await page.evaluate(() =>
          document.getAnimations().forEach((a) => {
            if (a.effect.getTiming().iterations !== Infinity) a.finish()
          }),
        )
        const overflow = await page.evaluate(() => ({
          viewport: innerWidth,
          content: document.documentElement.scrollWidth,
        }))
        assert.ok(
          overflow.content <= overflow.viewport + 1,
          `${theme}/${name}/${width}: horizontal overflow ${JSON.stringify(overflow)}`,
        )
        report.layouts++
        if ([390, 1440].includes(width)) {
          if (process.env.AXE_CORE_PATH) {
            await page.addScriptTag({ path: process.env.AXE_CORE_PATH })
            const result = await page.evaluate(async () => {
              const { violations, incomplete } = await window.axe.run(
                document,
                {
                  runOnly: {
                    type: 'tag',
                    values: [
                      'wcag2a',
                      'wcag2aa',
                      'wcag21aa',
                      'wcag22aa',
                      'best-practice',
                    ],
                  },
                },
              )
              const compact = (item) => ({
                id: item.id,
                impact: item.impact,
                help: item.help,
                nodes: item.nodes.map((n) => ({
                  target: n.target,
                  summary: n.failureSummary,
                  html: n.html,
                })),
              })
              return {
                violations: violations.map(compact),
                incomplete: incomplete.map(compact),
              }
            })
            report.accessibility.push({ theme, screen: name, width, ...result })
          }
          const targets = await page
            .locator('button, a, summary, .pov-option')
            .evaluateAll((nodes) =>
              nodes.flatMap((n) => {
                const r = n.getBoundingClientRect()
                return r.width &&
                  r.height &&
                  !n.closest('[hidden]') &&
                  (r.width < 44 || r.height < 44)
                  ? [
                      {
                        text: n.textContent.trim().slice(0, 65),
                        width: Math.round(r.width),
                        height: Math.round(r.height),
                        tag: n.tagName,
                        class: n.className,
                      },
                    ]
                  : []
              }),
            )
          if (targets.length)
            report.targets.push({ theme, screen: name, width, targets })
          // Reset scroll and focus after axe before capturing fixed-position elements.
          await page.evaluate(() => document.activeElement?.blur())
          await page.evaluate(() => window.scrollTo(0, 0))
          if (['dashboard', 'new-expense', 'login', 'bin'].includes(name))
            await page.screenshot({
              path: `${output}/${theme}-${name}-${width}.png`,
              fullPage: true,
            })
        }
      }
    }
  }
  await open('/expenses/new')
  await page.setViewportSize({ width: 320, height: 950 })
  // Text enlargement exercises reflow without changing the operating system's browser zoom.
  for (const theme of ['antonella', 'shared', 'marco']) {
    await open('/dashboard')
    await page.locator(`.pov-option:has(input[value=${theme}])`).click()
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    )
    for (const path of [
      '/dashboard',
      '/expenses/new',
      '/loans/new',
      '/exports',
      '/recycle-bin',
      '/login',
    ]) {
      await open(path)
      await page.addStyleTag({
        content: 'html { font-size: 200% !important; }',
      })
      await page.evaluate(() =>
        document.getAnimations().forEach((a) => {
          if (a.effect.getTiming().iterations !== Infinity) a.finish()
        }),
      )
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
      const offenders = overflow
        ? await page.locator('body *').evaluateAll((nodes) =>
            nodes.flatMap((n) => {
              const r = n.getBoundingClientRect()
              return r.width && (r.right > innerWidth + 1 || r.left < -1)
                ? [
                    {
                      tag: n.tagName,
                      class: String(n.className),
                      text: n.textContent.slice(0, 45),
                      width: r.width,
                      left: r.left,
                      right: r.right,
                    },
                  ]
                : []
            }),
          )
        : []
      report.reflow.push({
        theme,
        path,
        overflow,
        offenders,
        dimensions: await page.evaluate(() => ({
          content: document.documentElement.scrollWidth,
          viewport: innerWidth,
        })),
      })
      assert.equal(overflow, false, `${theme}/${path}: 200% text reflow`)
    }
  }
  await open(`/expenses/${ids.expense}`)
  await page
    .getByRole('button', { name: 'Eliminar consumo', exact: true })
    .click()
  await page.locator('.delete-confirmation').waitFor()
  await page
    .getByRole('button', { name: 'Sí, eliminar consumo', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Restaurar consumo', exact: true })
    .waitFor()
  assert.ok(state.expense.deletedAt)
  await open('/expenses')
  await page
    .getByRole('radio', { name: 'Eliminados', exact: true })
    .check({ force: true })
  await page
    .getByRole('heading', { name: state.expense.merchant, exact: true })
    .waitFor()
  await open(`/expenses/${ids.expense}`)
  await page
    .getByRole('button', { name: 'Restaurar consumo', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Eliminar consumo', exact: true })
    .waitFor()
  assert.equal(state.expense.deletedAt, null)
  emptyHistory = true
  await open('/expenses')
  await page
    .getByRole('heading', { name: 'Aquí empieza su historia', exact: true })
    .waitFor()
  emptyHistory = false
  sessionDelay = Date.now() + 4500
  await page.goto(`${url}/?quality=${++sequence}#/login`)
  await page
    .getByText('El servidor está despertando…', { exact: false })
    .waitFor()
  await page.getByRole('link', { name: 'Resumen', exact: true }).waitFor()
  await open('/expenses/new')
  await page.locator('.expense-brand').focus()
  await page.keyboard.press('Shift+Tab')
  await page
    .getByRole('link', { name: 'Saltar al contenido', exact: true })
    .waitFor()
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    'skip-link',
  )
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'main-content',
  )
  assert.equal(new URL(page.url()).hash, '#/expenses/new')
  for (const [label, path] of [
    ['Resumen', '/dashboard'],
    ['Consumos', '/expenses'],
    ['Deudas', '/debts'],
    ['Préstamos', '/loans'],
    ['Pagos', '/repayments'],
    ['Exportar', '/exports'],
    ['Eliminados', '/recycle-bin'],
  ]) {
    await page.getByRole('link', { name: label, exact: true }).focus()
    const indicator = await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineWidth,
    )
    assert.notEqual(indicator, '0px', `${label}: missing focus indicator`)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.activeElement.id === 'main-content',
    )
    assert.equal(new URL(page.url()).hash, `#${path}`)
    assert.equal(
      await page
        .getByRole('link', { name: label, exact: true })
        .getAttribute('aria-current'),
      'page',
    )
  }
  // A failed login must return the keyboard user to an enabled password field.
  await open('/login')
  rejectLogin = true
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-invalid-password')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await page.locator('#auth-error').waitFor()
  await page.waitForTimeout(100)
  report.focus.failedLogin = await page.evaluate(
    () => document.activeElement.id,
  )
  rejectLogin = false
  await page
    .getByLabel('Contraseña compartida', { exact: true })
    .fill('synthetic-valid-password')
  await page
    .getByRole('button', { name: 'Entrar a nuestro espacio', exact: true })
    .click()
  await page.getByRole('link', { name: 'Resumen', exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement.id === 'main-content')
  report.focus.afterLogin = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    id: document.activeElement.id,
  }))
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await page.locator('#shared-password').waitFor({ state: 'visible' })
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'marco')
  assert.equal(await page.locator('#shared-password').inputValue(), '')
  assert.equal(state.analytics.finance.authenticated, false)
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser?.close()
  await server.close()
}
const violations = report.accessibility.flatMap((r) =>
  r.violations.map((v) => `${r.theme}/${r.screen}/${r.width}: ${v.id}`),
)
console.log(
  JSON.stringify(
    {
      layouts: report.layouts,
      axeChecks: report.accessibility.length,
      violations,
      focus: report.focus,
      textReflowChecks: report.reflow.length,
      report: `${output}/report.json`,
    },
    null,
    2,
  ),
)
assert.deepEqual(violations, [], 'Accessibility regressions; see report.json')
assert.equal(report.focus.failedLogin, 'shared-password')
