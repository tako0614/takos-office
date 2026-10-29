/** Serialize one entity's writes against acknowledged server revisions only. */
export class RevisionWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private sequence = 0;
  private failure: unknown;

  constructor(
    public revision: string | undefined,
    failure?: unknown,
  ) {
    this.failure = failure;
  }

  get protected(): boolean {
    return this.pending > 0 || this.failure !== undefined;
  }
  get busy(): boolean {
    return this.pending > 0;
  }

  async settled(): Promise<void> {
    while (this.pending > 0) await this.tail;
  }

  invalidate(error: unknown): void {
    this.failure = error;
  }

  enqueue<T extends { updatedAt: string }>(
    write: (revision: string | undefined) => Promise<T>,
    acknowledged: (value: T, latest: boolean) => void,
    failed: (error: unknown) => void,
  ): Promise<T> {
    const sequence = ++this.sequence;
    this.pending++;
    const task = this.tail.then(async () => {
      try {
        if (this.failure !== undefined) throw this.failure;
        const value = await write(this.revision);
        this.revision = value.updatedAt;
        acknowledged(value, sequence === this.sequence);
        return value;
      } catch (error) {
        // A conflict or unknown outcome must be reconciled explicitly. Never
        // turn the next queued draft into an automatic retry of that effect.
        this.failure =
          error === undefined ? new Error("Write outcome is unknown") : error;
        failed(error);
        throw error;
      } finally {
        this.pending--;
      }
    });
    this.tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
}

export class ScopedRevisionWriteQueues {
  private scopes = new Map<string, Map<string, RevisionWriteQueue>>();

  find(scope: string, id: string): RevisionWriteQueue | undefined {
    return this.scopes.get(scope)?.get(id);
  }

  get(
    scope: string,
    id: string,
    revision?: string,
    failure?: unknown,
  ): RevisionWriteQueue {
    let entries = this.scopes.get(scope);
    if (!entries) this.scopes.set(scope, (entries = new Map()));
    let queue = entries.get(id);
    if (!queue)
      entries.set(id, (queue = new RevisionWriteQueue(revision, failure)));
    return queue;
  }

  release(scope: string, id: string, queue: RevisionWriteQueue): void {
    if (queue.protected || this.find(scope, id) !== queue) return;
    const entries = this.scopes.get(scope)!;
    entries.delete(id);
    if (entries.size === 0) this.scopes.delete(scope);
  }

  clear(scope: string): void {
    for (const queue of this.scopes.get(scope)?.values() ?? []) {
      queue.invalidate(new Error("Document cache was cleared"));
    }
    this.scopes.delete(scope);
  }

  discard(scope: string, id: string): void {
    const entries = this.scopes.get(scope);
    if (entries?.get(id)?.busy) throw new Error("A save is still in flight");
    entries?.delete(id);
    if (entries?.size === 0) this.scopes.delete(scope);
  }
}
