import test from 'node:test'
import assert from 'node:assert/strict'
import { allocationInCents, amountInCents, createInitialValues, initialPaymentMethods, validateExpense } from '../src/features/expenses/expenseModel.ts'

function validExpense(overrides = {}) {
  return { ...createInitialValues(), place: 'Tottus', amount: '50.01', date: '2026-10-31', category: 'Supermercado', paymentMethodId: 'cash', payer: 'marco', expenseType: 'personal', owner: 'antonella', ...overrides }
}

test('initial financial roles are empty and must be explicitly selected', () => {
  const values = createInitialValues()
  assert.equal(values.payer, '')
  assert.equal(values.owner, '')
  assert.equal(values.expenseType, '')
  assert.equal(values.splitMode, '')
  const errors = validateExpense(values, initialPaymentMethods)
  for (const field of ['place', 'amount', 'category', 'paymentMethodId', 'payer', 'expenseType']) assert.ok(errors[field])
})

test('PEN amounts accept decimal dots/commas and reject ambiguous or unsafe values', () => {
  assert.equal(amountInCents('50,01'), 5001)
  assert.equal(amountInCents('0.01'), 1)
  assert.equal(amountInCents('50'), 5000)
  for (const value of ['0', '-5', '1e4', 'NaN', '10.001', '1,000.00', '100000000', '']) assert.equal(amountInCents(value), null)
})

test('payer and personal owner can be different people', () => {
  const values = validExpense()
  assert.deepEqual(validateExpense(values, initialPaymentMethods), {})
  assert.deepEqual(allocationInCents(values), { antonella: 5001, marco: 0 })
  assert.ok(validateExpense(validExpense({ owner: '' }), initialPaymentMethods).owner)
  assert.ok(validateExpense(validExpense({ payer: 'constructor' }), initialPaymentMethods).payer)
})

test('only card payments require a card type', () => {
  assert.ok(validateExpense(validExpense({ paymentMethodId: 'card' }), initialPaymentMethods).cardType)
  assert.deepEqual(validateExpense(validExpense({ paymentMethodId: 'card', cardType: 'debit' }), initialPaymentMethods), {})
  assert.deepEqual(validateExpense(validExpense({ cardType: '' }), initialPaymentMethods), {})
})

test('shared allocations require an explicit mode and keep odd-cent totals exact', () => {
  const shared = validExpense({ expenseType: 'shared', owner: '' })
  assert.ok(validateExpense(shared, initialPaymentMethods).splitMode)
  const equal = { ...shared, splitMode: 'equal' }
  assert.deepEqual(validateExpense(equal, initialPaymentMethods), {})
  const result = allocationInCents(equal)
  assert.equal(result.antonella + result.marco, 5001)
  assert.deepEqual(result, { antonella: 2501, marco: 2500 })
})

test('custom percentages must be in range and sum to 100', () => {
  const custom = validExpense({ expenseType: 'shared', splitMode: 'custom', antonellaPercentage: '60', marcoPercentage: '40' })
  assert.deepEqual(validateExpense(custom, initialPaymentMethods), {})
  assert.deepEqual(allocationInCents(custom), { antonella: 3001, marco: 2000 })
  for (const values of [{ ...custom, marcoPercentage: '30' }, { ...custom, antonellaPercentage: '-1' }, { ...custom, antonellaPercentage: '101' }, { ...custom, marcoPercentage: '' }]) {
    assert.ok(Object.keys(validateExpense(values, initialPaymentMethods)).length)
    assert.equal(allocationInCents(values), null)
  }
})

test('calendar dates, categories, and session payment methods are validated', () => {
  assert.ok(validateExpense(validExpense({ date: '2026-02-30' }), initialPaymentMethods).date)
  assert.ok(validateExpense(validExpense({ category: 'Unknown' }), initialPaymentMethods).category)
  assert.ok(validateExpense(validExpense({ paymentMethodId: 'missing' }), initialPaymentMethods).paymentMethodId)
  const methods = [...initialPaymentMethods, { id: 'custom-5', label: 'Tarjeta de prueba', kind: 'card' }]
  assert.deepEqual(validateExpense(validExpense({ paymentMethodId: 'custom-5', cardType: 'credit' }), methods), {})
})
