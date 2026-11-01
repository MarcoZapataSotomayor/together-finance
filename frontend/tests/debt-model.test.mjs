import test from 'node:test'
import assert from 'node:assert/strict'
import {
  moneyUnits,
  canonicalMoney,
  formatPen,
  validateLoan,
  loanPayload,
  loanValues,
  loanChanges,
  validatePayment,
  repaymentPayload,
  resolvePovPerson,
  directionalFilters,
  matchesLoan,
  matchesPayment,
} from '../src/features/debts/debtModel.ts'
import {
  debtIds as ids,
  debtPeople,
  debtRecord,
  paymentRecord,
  loanInput,
} from './debt-fixtures.mjs'

const validLoan = () => ({ ...loanInput(), dueOn: '', description: ' Nota ' })
const validPayment = () => ({
  payer: ids.antonella,
  recipient: ids.marco,
  amount: '30',
  paidOn: '2026-10-31',
  description: '',
})

test('keeps exact cents, accepts localized input and rejects excessive scale/range', () => {
  assert.equal(moneyUnits('999999999999.99'), 99999999999999n)
  assert.equal(moneyUnits('0,10'), 10n)
  assert.equal(canonicalMoney('00030,10'), '30.10')
  for (const amount of ['0', '-1', '0.001', '1e2', 'NaN', '1000000000000'])
    assert.equal(moneyUnits(amount), null)
})
test('formats exact server outstanding balances and aggregates without floating point', () => {
  assert.equal(formatPen('9007199254740993.01'), 'S/ 9,007,199,254,740,993.01')
  assert.equal(formatPen('0.10'), 'S/ 0.10')
  assert.throws(() => formatPen('NaN'))
})
test('requires explicit distinct financial parties and positive valid loan data', () => {
  assert.deepEqual(validateLoan(validLoan(), debtPeople), {})
  const errors = validateLoan(
    { ...validLoan(), debtorPersonId: '', creditorPersonId: '', amount: '0' },
    debtPeople,
  )
  assert.ok(errors.debtorPersonId && errors.creditorPersonId && errors.amount)
  assert.ok(
    validateLoan(
      { ...validLoan(), creditorPersonId: ids.antonella },
      debtPeople,
    ).creditorPersonId,
  )
  assert.ok(
    validateLoan({ ...validLoan(), incurredOn: '2026-02-30' }, debtPeople)
      .incurredOn,
  )
  assert.ok(
    validateLoan({ ...validLoan(), dueOn: '2026-10-29' }, debtPeople).dueOn,
  )
})
test('maps only actual loan DTO fields and sends only changed permitted edit fields', () => {
  assert.deepEqual(loanPayload(validLoan()), {
    ...loanInput(),
    description: 'Nota',
  })
  const record = debtRecord({ repayments: [paymentRecord()] })
  const values = loanValues(record)
  assert.deepEqual(
    loanChanges({ ...values, description: 'Corregido' }, record),
    { description: 'Corregido' },
  )
  assert.deepEqual(loanChanges(values, record), {})
  assert.equal(Object.hasOwn(loanPayload(validLoan()), 'pov'), false)
})
test('validates partial/full payments, confirms both parties and rejects one-cent overpayment', () => {
  const debt = debtRecord({
    outstandingAmount: '70.01',
    repaidAmount: '29.99',
    status: 'PARTIALLY_REPAID',
  })
  assert.deepEqual(validatePayment(validPayment(), debt), {})
  assert.deepEqual(
    validatePayment(
      { ...validPayment(), amount: debt.outstandingAmount },
      debt,
    ),
    {},
  )
  assert.ok(
    validatePayment({ ...validPayment(), amount: '70.02' }, debt).amount,
  )
  const missing = validatePayment(
    { ...validPayment(), payer: '', recipient: '' },
    debt,
  )
  assert.ok(missing.payer && missing.recipient)
  assert.ok(
    validatePayment({ ...validPayment(), paidOn: '2026-10-29' }, debt).paidOn,
  )
  assert.deepEqual(repaymentPayload(validPayment()), {
    amount: '30.00',
    paidOn: '2026-10-31',
    description: null,
  })
})
test('resolves unique exact POV names without hardcoded IDs or approximate guesses', () => {
  assert.equal(resolvePovPerson('antonella', debtPeople)?.id, ids.antonella)
  assert.equal(resolvePovPerson('marco', debtPeople)?.id, ids.marco)
  assert.equal(resolvePovPerson('shared', debtPeople), undefined)
  assert.equal(
    resolvePovPerson('antonella', [
      { id: ids.relative, name: 'Antonella familiar' },
    ]),
    undefined,
  )
  const ambiguous = [...debtPeople, { id: 'other', name: ' Antonella ' }]
  assert.equal(resolvePovPerson('antonella', ambiguous), undefined)
  assert.equal(
    resolvePovPerson('antonella', ambiguous, ids.antonella)?.id,
    ids.antonella,
  )
  assert.equal(
    resolvePovPerson('antonella', debtPeople, 'removed-id'),
    undefined,
  )
})
test('builds two visible directional filters and never invents an OR/person endpoint filter', () => {
  const filters = { origin: 'LOAN', status: 'pending' }
  assert.deepEqual(directionalFilters(ids.antonella, 'both', filters), [
    { key: 'owed', filters: { ...filters, debtorPersonId: ids.antonella } },
    {
      key: 'receivable',
      filters: { ...filters, creditorPersonId: ids.antonella },
    },
  ])
  assert.equal(directionalFilters(ids.marco, 'owed', {}).length, 1)
  assert.deepEqual(directionalFilters('', 'both', {}), [
    { key: 'all', filters: {} },
  ])
  const values = validLoan(),
    before = structuredClone(values)
  for (const pov of ['antonella', 'shared', 'marco'])
    resolvePovPerson(pov, debtPeople)
  assert.deepEqual(values, before)
})
test('only confirms an inspected creation matching its active financial intent', () => {
  assert.equal(matchesLoan(debtRecord(), loanInput()), true)
  assert.equal(matchesLoan(debtRecord({ active: false }), loanInput()), false)
  assert.equal(
    matchesLoan(debtRecord({ originalAmount: '101.00' }), loanInput()),
    false,
  )
  const payment = paymentRecord()
  assert.equal(matchesPayment(payment, payment, ids.loan), true)
  assert.equal(
    matchesPayment({ ...payment, active: false }, payment, ids.loan),
    false,
  )
  assert.equal(matchesPayment(payment, payment, ids.other), false)
})
