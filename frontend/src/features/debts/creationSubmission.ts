import { ApiError } from '../../api/client.ts'

// Input and UUID remain in memory until the intent is confirmed or explicitly cleared.
export class CreationSubmission<P> {
  private id: string | null = null
  private payload: P | null = null
  private busy = false
  uncertain = false
  confirmed = false
  correcting = false
  get pendingId() {
    return this.id
  }
  get pendingPayload() {
    return this.payload
  }
  allowCorrection() {
    // Keep the reserved UUID even if an earlier request may still commit.
    if (this.uncertain) this.correcting = true
  }
  async submit<R>(
    payload: P,
    send: (id: string, payload: P) => Promise<R>,
    makeId = () => crypto.randomUUID(),
  ): Promise<R | null> {
    if (this.busy || this.confirmed) return null
    if (
      this.uncertain &&
      !this.correcting &&
      JSON.stringify(payload) !== JSON.stringify(this.payload)
    )
      throw new Error('Resolve the pending creation before changing its fields')
    this.busy = true
    let dispatched = false
    try {
      this.id ??= makeId()
      this.payload = structuredClone(payload)
      this.correcting = false
      dispatched = true
      const result = await send(this.id, this.payload)
      this.confirmed = true
      this.uncertain = false
      return result
    } catch (error) {
      this.uncertain =
        this.uncertain ||
        (dispatched &&
          (!(error instanceof ApiError) ||
            error.status === 0 ||
            error.status >= 500 ||
            error.status === 409))
      throw error
    } finally {
      this.busy = false
    }
  }
  async inspect<R extends { id: string }>(
    get: (id: string) => Promise<R>,
    matches: (record: R, payload: P) => boolean,
  ): Promise<R | null> {
    if (this.busy || !this.id || !this.payload) return null
    this.busy = true
    try {
      const result = await get(this.id)
      if (result.id !== this.id || !matches(result, this.payload))
        throw new ApiError(409)
      this.confirmed = true
      this.uncertain = false
      return result
    } finally {
      this.busy = false
    }
  }
}
