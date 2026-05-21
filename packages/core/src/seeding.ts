/**
 * Deterministic, reproducible seeding utilities.
 *
 * The tournament keeps a single integer "seed" that drives the Fisher–Yates
 * shuffle used to order participants within each category. Re-running the
 * shuffle with the same seed yields identical bracket assignments, so a result
 * can always be reproduced from the seed value alone.
 */

/** Mulberry32 — small, fast, well-distributed seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRandomSeed(): number {
  // 0..2^31-1
  return Math.floor(Math.random() * 2147483647);
}

export function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
