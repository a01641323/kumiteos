// Lazy Redis client built on ioredis. Speaks the Redis wire protocol
// over TLS (port 443) which is what Vercel's first-party Redis offers
// at *.db.redis.io. Also works with Upstash protocol URLs, Redis
// Cloud, self-hosted Redis, etc.
//
// JSON is serialized on set and parsed on get so the call-site API
// matches the @upstash/redis convention the cloud was originally
// written against.

import Redis from "ioredis";

let cached: Redis | null = null;

function makeClient(): Redis {
  const url = process.env.REDIS_URL ?? process.env.KV_URL;
  if (!url) {
    throw new Error(
      "Redis is not configured. Set REDIS_URL (Vercel's Redis " +
        "integration adds this automatically when you connect a database).",
    );
  }
  cached = new Redis(url, {
    // Serverless: cap retries so a misconfigured URL fails fast.
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    connectTimeout: 8000,
    lazyConnect: false,
  });
  return cached;
}

function client(): Redis {
  return cached ?? makeClient();
}

export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await client().get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; }
    catch { return raw as unknown as T; }
  },
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      await client().set(key, raw, "EX", ttlSeconds);
    } else {
      await client().set(key, raw);
    }
  },
  async del(key: string): Promise<number> {
    return client().del(key);
  },
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return client().sadd(key, ...members);
  },
  async smembers(key: string): Promise<string[]> {
    return client().smembers(key);
  },
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return client().srem(key, ...members);
  },
};

export const keys = {
  request: (id: string) => `req:${id}`,
  requestByCookie: (hash: string) => `req:byCookie:${hash}`,
  pendingSet: "req:pending",
  code: (hash: string) => `code:${hash}`,
  codeById: (codeId: string) => `code:byId:${codeId}`,
  jtiRevoked: (jti: string) => `jti:revoked:${jti}`,
  releaseCurrent: "release:current",
};
