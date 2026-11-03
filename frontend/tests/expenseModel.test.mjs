import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocationInCents,
  amountInCents,
  createInitialValues,
  expensePayload,
  validateExpense,
  valuesFromExpense,
} from '../src/features/expenses/expenseModel.ts'
import { exampleRecord, ids, references } from './finance-fixtures.mjs'

function validExpense(changes = {}) {
  return {
    ...createInitialValues(),
    place: 'Comercio',
    amount: '50,01',
    date: '2026-10-31',
    category: ids.category,
    paymentMethodId: ids.method,
    payer: ids.third,
    expenseType: 'personal',
    owner: ids.first,
    ...changes,
  }
}
test('initial financial roles and shared participants require explicit selections', () => {
  const values = createInitialValues()
  assert.equal(values.payer, '')
  assert.equal(values.owner, '')
  assert.ok(values.shares.every((row) => row.personId === ''))
  const errors = validateExpense(values, references)
  for (const field of [
    'place',
    'amount',
    'category',
    'paymentMethodId',
    'payer',
    'expenseType',
  ])
    assert.ok(errors[field])
})
test('PEN accepts decimal commas/dots and the full backend range without floating arithmetic', () => {
  assert.equal(amountInCents('50,01'), 5001)
  assert.equal(amountInCents('999999999999.99'), 99999999999999)
  for (const value of [
    '0',
    '-1',
    '1e2',
    'NaN',
    '10.001',
    '1,000.00',
    '1000000000000',
    '',
  ])
    assert.equal(amountInCents(value), null)
  assert.equal(expensePayload(validExpense()).amount, '50.01')
})
test('personal beneficiary, explicit third-party funder and method owner stay independent', () => {
  const values = validExpense()
  assert.deepEqual(validateExpense(values, references), {})
  const payload = expensePayload(values)
  assert.equal(payload.fundedByPersonId, ids.third)
  assert.equal(payload.paymentMethodId, ids.method)
  assert.deepEqual(payload.allocations, [
    { personId: ids.first, percentage: '100' },
  ])
  assert.ok(validateExpense(validExpense({ payer: '' }), references).payer)
})
test('shared allocations use exact largest remainders with UUID-based ties, never first person or POV', () => {
  const values = validExpense({
    expenseType: 'shared',
    owner: '',
    splitMode: 'equal',
    shares: [
      { personId: ids.first, percentage: '' },
      { personId: ids.second, percentage: '' },
    ],
  })
  assert.deepEqual(validateExpense(values, references), {})
  assert.deepEqual(allocationInCents(values), [
    { personId: ids.first, cents: 2500 },
    { personId: ids.second, cents: 2501 },
  ])
  assert.equal(Object.hasOwn(expensePayload(values), 'pov'), false)
})
test('custom percentages support four decimals and exact maximum-value apportionment', () => {
  const values = validExpense({
    amount: '999999999999.99',
    expenseType: 'shared',
    splitMode: 'custom',
    shares: [
      { personId: ids.first, percentage: '33,3333' },
      { personId: ids.second, percentage: '66.6667' },
    ],
  })
  assert.deepEqual(validateExpense(values, references), {})
  assert.equal(
    allocationInCents(values).reduce((sum, row) => sum + row.cents, 0),
    99999999999999,
  )
  for (const percentage of ['0', '-1', '101', '33.33333', ''])
    assert.ok(
      validateExpense(
        {
          ...values,
          shares: [{ personId: ids.first, percentage }, values.shares[1]],
        },
        references,
      ).allocation,
    )
})
test('invalid/duplicate/inactive participants, categories and methods are rejected', () => {
  const shared = validExpense({
    expenseType: 'shared',
    splitMode: 'equal',
    shares: [
      { personId: ids.first, percentage: '' },
      { personId: ids.first, percentage: '' },
    ],
  })
  assert.ok(validateExpense(shared, references).allocation)
  assert.ok(
    validateExpense(validExpense({ category: 'unknown' }), references).category,
  )
  assert.ok(
    validateExpense(validExpense({ paymentMethodId: 'unknown' }), references)
      .paymentMethodId,
  )
  assert.ok(
    validateExpense(validExpense({ date: '2026-02-30' }), references).date,
  )
  assert.ok(
    validateExpense(validExpense({ payer: ids.third }), {
      ...references,
      people: references.people.filter((row) => row.id !== ids.third),
    }).payer,
  )
})
test('editing maps active server allocations, IDs and percentages without losing historical shares', () => {
  const record = exampleRecord()
  const values = valuesFromExpense(record)
  assert.equal(values.payer, ids.third)
  assert.equal(values.splitMode, 'equal')
  assert.equal(values.shares.length, 2)
  assert.equal(expensePayload(values).allocations.length, 2)
  const original = structuredClone(record)
  values.shares[0].percentage = '60'
  assert.deepEqual(record, original)
  const archived = {
    ...record.allocations[0],
    id: 'archived-share',
    active: false,
  }
  assert.equal(
    valuesFromExpense({
      ...record,
      allocations: [...record.allocations, archived],
    }).shares.length,
    2,
  )
})

test('normalizes locale percentages and leading zeroes into backend-compatible decimal strings', () => {
  const values = validExpense({
    expenseType: 'shared',
    splitMode: 'custom',
    shares: [
      { personId: ids.first, percentage: '070,0000' },
      { personId: ids.second, percentage: '030' },
    ],
  })
  assert.deepEqual(validateExpense(values, references), {})
  assert.deepEqual(
    expensePayload(values).allocations.map((row) => row.percentage),
    ['70', '30'],
  )
})
