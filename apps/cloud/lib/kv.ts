// Lazy KV client. The `kv` proxy defers creation until the first
// real call, so importing this file in environments without
// KV_REST_API_URL / KV_REST_API_TOKEN (e.g. a fresh Vercel deploy
// before the KV integration is connected) doesn't throw at module
// load time — only when a route actually tries to read or write.

import { createClient, type VercelKV } from "@vercel/kv";

let cached: VercelKV | null = null;

function makeClient(): VercelKV {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Vercel KV is not configured. Connect a KV database in the Vercel " +
      "dashboard, or set KV_REST_API_URL + KV_REST_API_TOKEN.",
    );
  }
  cached = createClient({ url, token });
  return cached;
}

export const kv: VercelKV = new Proxy({} as VercelKV, {
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
