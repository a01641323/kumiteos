// Redirects /api/downloads/<target> → the matching asset on the latest
// GitHub Release. Cached in KV for 60 s so a burst of installers doesn't
// blow our unauthenticated GitHub API budget (60 req/hour).
//
// Targets map 1:1 to the assets the release.yml matrix uploads:
//   darwin-arm64 → kumiteos-darwin-arm64.tar.gz
//   darwin-x64   → kumiteos-darwin-x64.tar.gz
//   linux-x64    → kumiteos-linux-x64.tar.gz
//   win-x64      → kumiteos-win-x64.zip

import { NextResponse } from "next/server";
import { kv } from "@/lib/kv";

export const runtime = "nodejs";

const VALID = new Set(["darwin-arm64", "darwin-x64", "win-x64", "linux-x64"]);
const REPO = process.env.RELEASE_REPO ?? "a01641323/karate";
const CACHE_KEY = "release:latest";
const CACHE_TTL_S = 60;

interface ReleaseAsset { name: string; browser_download_url: string }
interface CachedRelease { tag: string; assets: ReleaseAsset[]; fetchedAt: number }

interface RouteContext { params: Promise<{ os: string }> }

async function fetchLatestRelease(): Promise<CachedRelease | null> {
  const cached = await kv.get<CachedRelease>(CACHE_KEY).catch(() => null);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_S * 1000) return cached;

  const headers: Record<string, string> = { "User-Agent": "kumiteos-cloud" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers,
    next: { revalidate: 0 },
  });
  if (!r.ok) {
    // Serve stale on fetch failure if we have it.
    return cached ?? null;
  }
  const json = await r.json() as { tag_name: string; assets: ReleaseAsset[] };
  const next: CachedRelease = {
    tag: json.tag_name,
    assets: (json.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url })),
    fetchedAt: Date.now(),
  };
  await kv.set(CACHE_KEY, next, CACHE_TTL_S).catch(() => undefined);
  return next;
}

function matchAsset(assets: ReleaseAsset[], target: string): ReleaseAsset | null {
  const ext = target === "win-x64" ? "zip" : "tar.gz";
  const wanted = `kumiteos-${target}.${ext}`;
  return assets.find((a) => a.name === wanted) ?? null;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { os } = await ctx.params;
  if (!VALID.has(os)) return NextResponse.json({ error: "unknown_os" }, { status: 404 });

  let rel: CachedRelease | null = null;
  try { rel = await fetchLatestRelease(); }
  catch (err) {
    return NextResponse.json(
      { error: "release_lookup_failed", message: (err as Error).message },
      { status: 503 },
    );
  }
  if (!rel) {
    return NextResponse.json({ error: "no_release" }, { status: 503 });
  }
  const asset = matchAsset(rel.assets, os);
  if (!asset) {
    return NextResponse.json(
      { error: "asset_missing", tag: rel.tag, want: os },
      { status: 503 },
    );
  }
  return NextResponse.redirect(asset.browser_download_url, 302);
}
