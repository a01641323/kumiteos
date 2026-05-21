import type { Request, Response, NextFunction } from "express";

/**
 * In-memory token-bucket rate limiter. The window is fixed (not sliding) to
 * keep the implementation small; we accept the burst at the boundary because
 * the protected endpoints are also bounded by claim-code single-use and JWT
 * lineage revocation. For a multi-instance deployment this should move to
 * Redis.
 */

interface Counter {
  count: number;
  windowStart: number;
  failureStreak: number;
  nextAllowedAt: number;
}

export interface RateLimitOptions {
  /** Window in milliseconds. */
  windowMs: number;
  /** Max requests per window. */
  max: number;
  /** Key extractor — IP, sub, jti, etc. */
  key: (req: Request) => string;
  /** When true, only `failure` calls count against the bucket. Used for
   *  /api/activate so legitimate users aren't rate-limited by their own
   *  successful redemption. */
  countOnlyFailures?: boolean;
  /** Apply exponential backoff to consecutive failures from the same key. */
  exponentialBackoff?: boolean;
}

export class RateLimiter {
  private counters = new Map<string, Counter>();

  constructor(private opts: RateLimitOptions) {}

  /** Express middleware that increments the counter on every request when
   *  `countOnlyFailures` is false. When true, the middleware just enforces
   *  the lockout; callers must invoke `recordFailure` themselves. */
  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = this.opts.key(req);
    const now = Date.now();
    const c = this.touch(key, now);

    if (c.nextAllowedAt > now) {
      res
        .status(429)
        .set("Retry-After", String(Math.ceil((c.nextAllowedAt - now) / 1000)))
        .json({ error: "RATE_LIMITED", retryAfterMs: c.nextAllowedAt - now });
      return;
    }
    if (!this.opts.countOnlyFailures) {
      c.count += 1;
      if (c.count > this.opts.max) {
        const retry = c.windowStart + this.opts.windowMs - now;
        res
          .status(429)
          .set("Retry-After", String(Math.ceil(retry / 1000)))
          .json({ error: "RATE_LIMITED", retryAfterMs: retry });
        return;
      }
    }
    next();
  };

  recordSuccess(req: Request): void {
    const key = this.opts.key(req);
    const c = this.counters.get(key);
    if (c) {
      c.failureStreak = 0;
      c.nextAllowedAt = 0;
    }
  }

  recordFailure(req: Request): boolean {
    const key = this.opts.key(req);
    const now = Date.now();
    const c = this.touch(key, now);
    c.count += 1;
    c.failureStreak += 1;
    if (this.opts.exponentialBackoff && c.failureStreak >= 3) {
      // 3rd failure → 30 s; 4th → 60 s; 5th → 120 s; capped at 15 min.
      const backoffMs = Math.min(
        30_000 * 2 ** (c.failureStreak - 3),
        15 * 60_000,
      );
      c.nextAllowedAt = now + backoffMs;
    }
    return c.count > this.opts.max;
  }

  private touch(key: string, now: number): Counter {
    let c = this.counters.get(key);
    if (!c) {
      c = { count: 0, windowStart: now, failureStreak: 0, nextAllowedAt: 0 };
      this.counters.set(key, c);
      return c;
    }
    if (now - c.windowStart >= this.opts.windowMs) {
      c.count = 0;
      c.windowStart = now;
    }
    return c;
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}
