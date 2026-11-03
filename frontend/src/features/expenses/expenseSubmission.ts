import { ApiError } from '../../api/client.ts'
import type { ExpensePayload, ExpenseRecord } from '../../api/types.ts'
import { percentageUnits } from './expenseModel.ts'

function signature(payload: ExpensePayload): string {
  return JSON.stringify({
    ...payload,
    allocations: [...payload.allocations].sort((a, b) =>
      a.personId.localeCompare(b.personId),
    ),
  })
}
export class ExpenseSubmission {
  private id: string | null = null
  private payload: ExpensePayload | null = null
  private busy = false
  uncertain = false
  confirmed = false
  get pendingId(): string | null {
    return this.id
  }
  async submit(
    payload: ExpensePayload,
    send: (id: string, payload: ExpensePayload) => Promise<ExpenseRecord>,
    makeId = () => crypto.randomUUID(),
  ): Promise<ExpenseRecord | null> {
    if (this.busy || this.confirmed) return null
    if (
      this.uncertain &&
      this.payload &&
      signature(payload) !== signature(this.payload)
    )
      throw new Error('Resolve the pending expense before changing its fields')
    this.busy = true
    let dispatched = false
    try {
      this.id ??= makeId()
      this.payload = structuredClone(payload)
      dispatched = true
      const result = await send(this.id, this.payload)
      this.confirmed = true
      this.uncertain = false
      return result
    } catch (error) {
      this.uncertain =
        dispatched &&
        (!(error instanceof ApiError) ||
          error.status === 0 ||
          error.status >= 500 ||
          error.status === 409)
      throw error
    } finally {
      this.busy = false
    }
  }
  async inspect(
    get: (id: string) => Promise<ExpenseRecord>,
  ): Promise<ExpenseRecord | null> {
    if (this.busy || !this.id) return null
    this.busy = true
    try {
      const result = await get(this.id)
      const active = result.allocations.filter((row) => row.active)
      const payload = this.payload
      const keys = [
        'amount',
        'purchasedOn',
        'merchant',
        'description',
        'categoryId',
        'paymentMethodId',
        'fundedByPersonId',
        'classification',
      ] as const
      if (
        !payload ||
        result.id !== this.id ||
        result.deletedAt ||
        !keys.every((key) => result[key] === payload[key]) ||
        active.length !== payload.allocations.length ||
        !payload.allocations.every((share) =>
          active.some(
            (row) =>
              row.personId === share.personId &&
              percentageUnits(row.percentage) ===
                percentageUnits(share.percentage),
          ),
        )
      )
        throw new ApiError(409)
      this.confirmed = true
      this.uncertain = false
      return result
    } finally {
      this.busy = false
    }
  }
}
