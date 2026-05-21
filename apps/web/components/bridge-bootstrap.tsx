"use client";

import { installKarateBridge } from "@/lib/karate-bridge";

// Install during render (idempotent) so the bridge is available before
// any descendant provider's effect runs. SSR is a no-op — the function
// short-circuits when `window` isn't defined.
if (typeof window !== "undefined") installKarateBridge();

export function BridgeBootstrap() {
  return null;
}
