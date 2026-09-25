export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

/**
 * In-process token bucket per key: `limitPerMinute` capacity, refilled continuously.
 * Per-instance only — a shared store (Redis) is needed once the gateway scales horizontally.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, { tokens: number; updated: number }>();
  readonly #refillPerMs: number;

  constructor(
    readonly limitPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#refillPerMs = limitPerMinute / 60_000;
  }

  take(key: string): RateDecision {
    const now = this.now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.limitPerMinute, updated: now };
    bucket.tokens = Math.min(this.limitPerMinute, bucket.tokens + (now - bucket.updated) * this.#refillPerMs);
    bucket.updated = now;
    this.#buckets.set(key, bucket);
    if (this.#buckets.size > 10_000) this.#prune(now);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true, remaining: Math.floor(bucket.tokens) };
    }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.#refillPerMs / 1000)) };
  }

  #prune(now: number): void {
    for (const [key, b] of this.#buckets) {
      if (b.tokens + (now - b.updated) * this.#refillPerMs >= this.limitPerMinute) this.#buckets.delete(key);
    }
  }
}

/** Caps in-flight agent runs per key. */
export class ConcurrencyLimiter {
  readonly #active = new Map<string, number>();

  constructor(readonly max: number) {}

  /** Returns a release function, or undefined when the key is at its limit. */
  acquire(key: string): (() => void) | undefined {
    const current = this.#active.get(key) ?? 0;
    if (current >= this.max) return undefined;
    this.#active.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.#active.get(key) ?? 1) - 1;
      if (n <= 0) this.#active.delete(key);
      else this.#active.set(key, n);
    };
  }

  active(key: string): number {
    return this.#active.get(key) ?? 0;
  }
}
