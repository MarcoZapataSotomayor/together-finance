// Synthetic HTTP fixtures only; no live database identifiers or financial data.
export const ids = {
  first: '00000000-0000-4000-8000-000000000002',
  second: '00000000-0000-4000-8000-000000000001',
  third: '00000000-0000-4000-8000-000000000003',
  category: '00000000-0000-4000-8000-000000000010',
  method: '00000000-0000-4000-8000-000000000020',
  expense: '00000000-0000-4000-8000-000000000030',
}
const audit = {
  createdAt: '2026-10-31T12:00:00Z',
  updatedAt: '2026-10-31T12:00:00Z',
}
export const references = {
  people: [
    { id: ids.first, name: 'Persona A' },
    { id: ids.second, name: 'Persona B' },
    { id: ids.third, name: 'Familiar' },
  ].map((person) => ({ ...person, isActive: true, notes: null, ...audit })),
  categories: [
    {
      id: ids.category,
      name: 'Alimentación',
      description: null,
      isActive: true,
      ...audit,
    },
  ],
  methods: [
    {
      id: ids.method,
      name: 'Tarjeta familiar',
      type: 'CREDIT_CARD',
      ownerPersonId: ids.first,
      description: null,
      isActive: true,
      ...audit,
    },
  ],
}
export function examplePayload(changes = {}) {
  return {
    amount: '100.00',
    purchasedOn: '2026-10-30',
    merchant: 'Comercio de prueba',
    description: null,
    categoryId: ids.category,
    paymentMethodId: ids.method,
    fundedByPersonId: ids.third,
    classification: 'SHARED',
    allocations: [
      { personId: ids.first, percentage: '50' },
      { personId: ids.second, percentage: '50' },
    ],
    ...changes,
  }
}
export function exampleRecord(changes = {}) {
  return {
    ...examplePayload(),
    id: ids.expense,
    currency: 'PEN',
    deletedAt: null,
    ...audit,
    category: references.categories[0],
    paymentMethod: references.methods[0],
    fundedBy: references.people[2],
    allocations: examplePayload().allocations.map((row, index) => ({
      ...row,
      id: `00000000-0000-4000-8000-00000000004${index}`,
      person: references.people[index],
      percentage: '50.0000',
      amount: '50.00',
      active: true,
      deletedAt: null,
      debt: null,
    })),
    ...changes,
  }
}
