import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { installMotionMock } from '../tests/browser/motion-mock.mjs'
import { debtIds as ids } from '../tests/debt-fixtures.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = `${root}/node_modules/.cache/motion-review`
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
let layouts = 0
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
  page.setDefaultTimeout(8000)
  page.on('pageerror', (e) => errors.push(e.message))
  const month = await page.evaluate(() => {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const state = await installMotionMock(context, month)
  let sequence = 0
  const open = async (path) => {
    await page.goto(`${url}/?motion-check=${++sequence}#${path}`)
    await page.locator('.consumption-frame:visible').waitFor()
  }
  const frame = () => page.locator('.consumption-frame:visible').last()
  const field = (label) => frame().getByLabel(label, { exact: true })
  const button = (label) =>
    frame().getByRole('button', { name: label, exact: true })
  const visibleMarks = () =>
    page.locator('.motion-confirmation-mark:visible').count()
  const waitRequest = (method) =>
    page.waitForRequest(
      (r) =>
        r.method() === method &&
        /\/api\/(expenses|debts\/[^/]+\/repayments)/.test(r.url()),
    )
  const checkMark = async (reduced) => {
    const mark = page.locator('.motion-confirmation-mark:visible path').first()
    await mark.waitFor()
    const data = await mark.evaluate((node, reduced) => {
      const animation = node.getAnimations()[0]
      if (animation && !reduced) {
        animation.pause()
        animation.currentTime =
          Number(animation.effect.getTiming().duration) / 2
      }
      return {
        name: getComputedStyle(node).animationName,
        offset: getComputedStyle(node).strokeDashoffset,
        hidden: node.closest('svg').getAttribute('aria-hidden'),
      }
    }, reduced)
    assert.equal(data.hidden, 'true')
    if (reduced) {
      assert.equal(data.name, 'none')
      assert.equal(parseFloat(data.offset), 0)
    } else {
      assert.equal(data.name, 'motion-check')
      assert.ok(parseFloat(data.offset) >= 0 && parseFloat(data.offset) < 1)
      await mark.evaluate((n) => n.getAnimations().forEach((a) => a.finish()))
    }
  }

  for (const reduced of [false, true]) {
    await page.emulateMedia({
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    })
    await open('/expenses/new')
    await field('Categoría').selectOption(
      ids.category || '00000000-0000-4000-8000-000000000010',
    )
    const add = button('Agregar medio de pago')
    await add.click()
    await page.locator('.reference-editor input').first().waitFor()
    assert.equal(
      await page
        .locator('.reference-editor input')
        .first()
        .evaluate((n) => n === document.activeElement),
      true,
    )
    await page.keyboard.press('Escape')
    await page.locator('.reference-editor').waitFor({ state: 'detached' })
    await add
      .evaluate(
        (n) =>
          new Promise((resolve) =>
            requestAnimationFrame(() => resolve(n === document.activeElement)),
          ),
      )
      .then((focused) => assert.equal(focused, true))
    await field('Lugar de compra').fill('Compra de prueba de movimiento')
    await field('Monto en soles (PEN)').fill('12,34')
    await field('Fecha').fill('2026-10-30')
    await field('Medio de pago').selectOption(
      '00000000-0000-4000-8000-000000000020',
    )
    await field('¿Quién aporta el dinero?').selectOption(ids.marco)
    await frame()
      .getByRole('radio', { name: 'Personal', exact: true })
      .check({ force: true })
    await field('¿De quién es el consumo?').selectOption(ids.marco)
    state.rejectExpense = 400
    await button('Guardar consumo').click()
    await frame().getByRole('alert').filter({ hasText: 'Revisa' }).waitFor()
    assert.equal(await visibleMarks(), 0)
    state.expenseDelay = 1000
    let request = waitRequest('POST')
    await button('Guardar consumo').click()
    await request
    await button('Guardando…').waitFor()
    assert.equal(await visibleMarks(), 0)
    await frame().getByText('Consumo guardado:', { exact: false }).waitFor()
    assert.equal(state.expense.amount, '12.34')
    await checkMark(reduced)
    assert.equal(
      await frame()
        .locator('.confirmation-message')
        .evaluate((n) => n === document.activeElement),
      true,
    )
    await frame()
      .getByRole('link', { name: 'Ver el consumo guardado', exact: true })
      .click()
    await frame()
      .getByRole('link', { name: 'Editar consumo', exact: true })
      .click()
    await field('Lugar de compra').fill('Compra corregida de prueba')
    state.expenseDelay = 1000
    request = waitRequest('PATCH')
    await button('Guardar cambios').click()
    await request
    await button('Guardando…').waitFor()
    assert.equal(await visibleMarks(), 0)
    await page
      .getByText('Cambios guardados y confirmados.', { exact: true })
      .waitFor()
    assert.equal(state.expense.amount, '12.34')
    assert.equal(state.expense.merchant, 'Compra corregida de prueba')
    await checkMark(reduced)
    await button('Eliminar consumo').click()
    await page.locator('.delete-confirmation').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.delete-confirmation').waitFor({ state: 'detached' })
    assert.equal(
      await button('Eliminar consumo').evaluate(
        (n) => n === document.activeElement,
      ),
      true,
    )

    await open(`/debts/${ids.loan}/pay`)
    await field('Persona que paga').selectOption(ids.antonella)
    await field('Persona que recibe').selectOption(ids.marco)
    await field('Monto del pago (S/)').fill('10.01')
    await field('Fecha del pago').fill('2026-10-31')
    state.analytics.finance.rejectNextWrite = 400
    await button('Guardar pago').click()
    await frame().getByRole('alert').waitFor()
    assert.equal(await visibleMarks(), 0)
    state.repaymentDelay = 1000
    request = waitRequest('POST')
    await button('Guardar pago').click()
    await request
    await button('Guardando…').waitFor()
    assert.equal(await visibleMarks(), 0)
    await frame()
      .getByRole('heading', { name: 'Pago guardado', exact: true })
      .waitFor()
    await checkMark(reduced)
    assert.equal(
      await frame()
        .locator('.workspace-empty')
        .evaluate((n) => n === document.activeElement),
      true,
    )
    assert.equal(state.analytics.finance.payments.at(-1).amount, '10.01')
    await open(`/loans/${ids.loan}`)
    await button('Eliminar préstamo').click()
    await page.locator('.delete-confirmation').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.delete-confirmation').waitFor({ state: 'detached' })
    assert.equal(
      await button('Eliminar préstamo').evaluate(
        (n) => n === document.activeElement,
      ),
      true,
    )
  }

  const surfaces = [
    '/dashboard',
    '/expenses/new',
    `/expenses/${state.expense.id}/edit`,
    `/debts/${ids.loan}/pay`,
    `/loans/${ids.loan}`,
  ]
  for (const reduced of [false, true]) {
    await page.emulateMedia({
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    })
    for (const path of surfaces) {
      await open(path)
      if (path === '/dashboard')
        await page.locator('.dashboard-spending-amount').waitFor()
      if (path.includes('/pay')) await field('Persona que paga').waitFor()
      for (const theme of ['antonella', 'shared', 'marco']) {
        await page
          .locator(`.pov-selector input[value=${theme}]`)
          .check({ force: true })
        if (path === '/dashboard')
          await page.locator('.dashboard-spending-amount').waitFor()
        for (const width of [320, 375, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate(() => document.fonts.ready)
          const metrics = await page.evaluate(() => {
            const visible = (n) => n.getClientRects().length > 0
            const nodes = [
              ...document.querySelectorAll(
                'input:not([type=radio]),select,textarea,.button,.add-method-button,.finance-navigation a,.pov-option,.segmented-options > label',
              ),
            ].filter(visible)
            const spatial = (animation) =>
              animation.effect
                .getKeyframes()
                .some((keyframe) =>
                  [
                    'transform',
                    'translate',
                    'rotate',
                    'scale',
                    'strokeDashoffset',
                  ].some((key) => key in keyframe),
                )
            return {
              width: innerWidth,
              scroll: document.documentElement.scrollWidth,
              short: nodes
                .filter((n) => n.getBoundingClientRect().height < 43)
                .map((n) => n.id || n.textContent),
              ids: [...document.querySelectorAll('[id]')]
                .map((n) => n.id)
                .filter((id, i, all) => all.indexOf(id) !== i),
              unlabeled: nodes.filter(
                (n) =>
                  n.matches('input:not([type=radio]),select,textarea') &&
                  !n.labels?.length &&
                  !n.getAttribute('aria-label'),
              ).length,
              animations: document
                .getAnimations()
                .filter((a) => a.playState === 'running' && spatial(a))
                .map((a) => a.animationName || a.transitionProperty),
              token: getComputedStyle(document.documentElement)
                .getPropertyValue('--motion-enter')
                .trim(),
            }
          })
          assert.ok(
            metrics.scroll <= metrics.width,
            `${path} ${theme} ${width}: overflow ${metrics.scroll}`,
          )
          assert.deepEqual(metrics.ids, [])
          assert.deepEqual(metrics.short, [])
          assert.equal(metrics.unlabeled, 0)
          assert.equal(
            metrics.token,
            theme === 'antonella'
              ? '280ms'
              : theme === 'marco'
                ? '180ms'
                : '240ms',
          )
          if (reduced) assert.deepEqual(metrics.animations, [])
          if (
            !reduced &&
            [390, 1440].includes(width) &&
            ['/dashboard', '/expenses/new'].includes(path)
          )
            await page.screenshot({
              path: `${output}/${path === '/dashboard' ? 'dashboard' : 'expense'}-${theme}-${width}.png`,
              fullPage: true,
            })
          layouts++
        }
      }
    }
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await open('/dashboard')
  await page.locator('.dashboard-spending-amount').waitFor()
  // Pause actual chart animations at their midpoint: final amounts and geometry must already exist.
  const chart = await page.locator('.monthly-bars').evaluate((node) => {
    node.getAnimations().forEach((a) => {
      a.pause()
      a.currentTime = 100
    })
    return [...node.querySelectorAll('.monthly-bar')]
      .filter((bar) => bar.style.visibility !== 'hidden')
      .map((bar) => ({
        inline: bar.style.height,
        rendered: getComputedStyle(bar).height,
      }))
  })
  for (const bar of chart) assert.equal(bar.rendered, bar.inline)
  await page.locator('.pov-selector input[value=antonella]').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'marco',
  )
  assert.equal(
    await page
      .locator('.pov-selector input[value=marco]')
      .evaluate((n) => n === document.activeElement),
    true,
  )
  assert.notEqual(
    await page
      .locator('.pov-selector input[value=marco] + span')
      .evaluate((n) => getComputedStyle(n).outlineStyle),
    'none',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await page
      .locator('.pov-selector input:checked + span')
      .evaluate((n) => getComputedStyle(n).animationName),
    'none',
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const session = await context.newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.setViewportSize({ width: 375, height: 900 })
  const frames = await page.evaluate(async () => {
    const samples = []
    let previous = performance.now()
    document.querySelector('.pov-selector input[value=antonella]').click()
    for (let i = 0; i < 30; i++)
      await new Promise((resolve) =>
        requestAnimationFrame((time) => {
          samples.push(time - previous)
          previous = time
          resolve()
        }),
      )
    return samples
  })
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const ordered = frames.slice(2).sort((a, b) => a - b),
    p95 = ordered[Math.floor((ordered.length - 1) * 0.95)]
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      layouts,
      liveFinancialWrites: 0,
      checks:
        'server-only create/edit/repayment success, rejected/pending states, Escape/focus, radio keyboard, reduced-motion/live preference, exact chart geometry, themes/labels/tap targets/overflow',
      cpuThrottle: 4,
      frameGapP95Ms: Number(p95.toFixed(1)),
      frameGapMaxMs: Number(Math.max(...frames).toFixed(1)),
    }),
  )
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true })
  throw error
} finally {
  await browser?.close()
  await server.close()
}
