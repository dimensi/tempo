/** Shared resource state. Transport and persistence are adapters, never UI state. */
export interface ReadResource<T> {
  data?: T;
  source?: 'memory' | 'storage' | 'network';
  savedAt?: number;
  coverage: 'complete' | 'partial' | 'missing';
  refreshing: boolean;
  error?: 'network' | 'unavailable' | 'denied';
}
export interface PersistedRead<T> {
  data: T;
  savedAt: number;
  touchedAt: number;
  coverage?: 'complete' | 'partial';
}
export interface ReadPersistence<T> {
  read(key: string): Promise<PersistedRead<T> | undefined>;
  write(key: string, value: PersistedRead<T>): Promise<void>;
  remove?(key: string): Promise<void>;
}
export class ReadFailure extends Error {
  constructor(
    public readonly reason: 'network' | 'unavailable' | 'denied',
    public readonly status = 0,
  ) {
    super(reason);
  }
}
export class ReadResourceStore<T> {
  private entries = new Map<string, ReadResource<T>>();
  private flights = new Map<string, Promise<T>>();
  private listeners = new Map<string, Set<() => void>>();
  private epoch = 0;
  private revisions = new Map<string, number>();
  async invalidate(key: string) {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.flights.delete(key);
    this.publish(key, { coverage: 'missing', refreshing: false });
    await this.persistence.remove?.(key).catch(() => {});
  }
  constructor(
    private persistence: ReadPersistence<T>,
    private now = Date.now,
    private limits?: {
      entries: number;
      weight: number;
      size: (data: T) => number;
    },
  ) {}
  snapshot(key: string): ReadResource<T> {
    return this.entries.get(key) ?? empty;
  }
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  private publish(key: string, state: ReadResource<T>) {
    this.entries.set(key, state);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
  seed(
    key: string,
    data: T,
    savedAt = this.now(),
    source: 'storage' | 'network' = 'network',
    coverage: 'complete' | 'partial' = 'complete',
  ) {
    if (this.limits && this.limits.size(data) > this.limits.weight) {
      this.publish(key, {
        ...this.snapshot(key),
        refreshing: false,
        error: 'unavailable',
      });
      return;
    }
    const previous = this.snapshot(key);
    this.entries.delete(key);
    this.publish(key, {
      data: previous.data === data ? previous.data : data,
      savedAt,
      source,
      coverage,
      refreshing: false,
    });
    if (this.limits) {
      let weight = 0;
      for (const entry of this.entries.values())
        if (entry.data !== undefined) weight += this.limits.size(entry.data);
      for (const [id, entry] of this.entries) {
        if (
          this.entries.size <= this.limits.entries &&
          weight <= this.limits.weight
        )
          break;
        if (id === key) continue;
        if (entry.data !== undefined) weight -= this.limits.size(entry.data);
        this.entries.delete(id);
      }
    }
  }
  clear() {
    this.epoch++;
    this.entries.clear();
    this.flights.clear();
    for (const listeners of this.listeners.values())
      for (const listener of listeners) listener();
  }
  async restore(key: string) {
    if (this.snapshot(key).data !== undefined) return;
    const epoch = this.epoch;
    const revision = this.revisions.get(key);
    const valid = () =>
      epoch === this.epoch && revision === this.revisions.get(key);
    const value = await this.persistence.read(key).catch(() => undefined);
    if (value && valid() && this.snapshot(key).data === undefined)
      this.seed(key, value.data, value.savedAt, 'storage', value.coverage);
  }
  async read(key: string, loader?: () => Promise<T>): Promise<T> {
    const existing = loader ? this.flights.get(key) : undefined;
    if (existing) return existing;
    const epoch = this.epoch;
    const revision = this.revisions.get(key);
    const valid = () =>
      epoch === this.epoch && revision === this.revisions.get(key);
    const flight = (async () => {
      let state = this.snapshot(key);
      const memory = state.data !== undefined;
      if (state.data === undefined) {
        const saved = await this.persistence.read(key).catch(() => undefined);
        if (!valid()) throw new ReadFailure('denied');
        if (saved && this.snapshot(key).data === undefined) {
          this.seed(key, saved.data, saved.savedAt, 'storage', saved.coverage);
          state = this.snapshot(key);
        }
      }
      state = this.snapshot(key);
      if (!loader) {
        if (state.data !== undefined) {
          if (memory) this.publish(key, { ...state, source: 'memory' });
          await this.persistence
            .write(key, {
              data: state.data,
              savedAt: state.savedAt ?? this.now(),
              touchedAt: this.now(),
              coverage: state.coverage === 'partial' ? 'partial' : 'complete',
            })
            .catch(() => {});
          return state.data;
        }
        this.publish(key, {
          coverage: 'missing',
          refreshing: false,
          error: 'network',
        });
        throw new ReadFailure('network');
      }
      this.publish(key, { ...state, refreshing: true, error: undefined });
      try {
        const data = await loader();
        if (!valid()) throw new ReadFailure('denied');
        const savedAt = this.now();
        this.seed(key, data, savedAt);
        // Persistence is best effort; the live screen must survive quota/eviction.
        await this.persistence
          .write(key, {
            data,
            savedAt,
            touchedAt: savedAt,
            coverage: 'complete',
          })
          .catch(() => {});
        if (!valid()) throw new ReadFailure('denied');
        return data;
      } catch (error) {
        if (!valid()) throw new ReadFailure('denied');
        const reason = error instanceof ReadFailure ? error.reason : 'network';
        if (
          reason === 'denied' ||
          (error instanceof ReadFailure && error.status === 404)
        ) {
          this.publish(key, {
            coverage: 'missing',
            refreshing: false,
            error: reason,
          });
          await this.persistence.remove?.(key).catch(() => {});
          throw error;
        }
        this.publish(key, {
          ...this.snapshot(key),
          source: state.data !== undefined && memory ? 'memory' : state.source,
          refreshing: false,
          error: reason,
        });
        if (state.data !== undefined) return state.data;
        throw error;
      }
    })();
    if (loader) this.flights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    }
  }
}
const empty = Object.freeze({
  coverage: 'missing' as const,
  refreshing: false,
});
