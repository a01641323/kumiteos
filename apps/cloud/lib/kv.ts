// Lazy Upstash Redis client. Accepts either env-var convention
// Vercel might expose:
//   - REST shape:   KV_REST_API_URL + KV_REST_API_TOKEN  (Vercel KV legacy)
//                   or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   - Protocol URL: REDIS_URL / KV_URL                   (Vercel Redis Marketplace)
//
// The protocol URL is parsed into the REST equivalent so a single
// `@upstash/redis` client works regardless of which form is present.

import { Redis } from "@upstash/redis";

let cached: Redis | null = null;

function deriveRestFromRedisUrl(redisUrl: string): { url: string; token: string } | null {
  try {
    const parsed = new URL(redisUrl);
    if (!parsed.hostname || !parsed.password) return null;
    return {
      url: `https://${parsed.hostname}`,
      token: parsed.password,
    };
  } catch {
    return null;
  }
}

function makeClient(): Redis {
  const restUrl =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const restToken =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (restUrl && restToken) {
    cached = new Redis({ url: restUrl, token: restToken });
    return cached;
  }

  const protocolUrl = process.env.REDIS_URL ?? process.env.KV_URL;
  if (protocolUrl) {
    const derived = deriveRestFromRedisUrl(protocolUrl);
    if (derived) {
      cached = new Redis(derived);
      return cached;
    }
  }

  throw new Error(
    "Redis is not configured. Provide either REDIS_URL, or " +
      "KV_REST_API_URL + KV_REST_API_TOKEN, or " +
      "UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.",
  );
}

export const kv: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const client = cached ?? makeClient();
    return Reflect.get(client, prop, client);
  },
});

export const keys = {
  request: (id: string) => `req:${id}`,
  requestByCookie: (hash: string) => `req:byCookie:${hash}`,
  pendingSet: "req:pending",
  code: (hash: string) => `code:${hash}`,
  codeById: (codeId: string) => `code:byId:${codeId}`,
  jtiRevoked: (jti: string) => `jti:revoked:${jti}`,
  releaseCurrent: "release:current",
};
