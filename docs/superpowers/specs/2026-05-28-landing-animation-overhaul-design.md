# Landing Page Animation Overhaul — Design

_Date: 2026-05-28_

## Goal

Replace the generic animation set on the Kumite/OS cloud landing page
(`apps/cloud`, route `/`) with a cohesive, premium **kinetic editorial**
motion system. Preserve all layout, content, and functionality — only the
visual presentation of motion changes. Vanilla CSS/JS only, no new
dependencies. Everything degrades gracefully under
`prefers-reduced-motion` and on coarse/touch pointers.

## Scope

In: landing page surfaces only — `app/page.tsx` (hero, about, how-it-works),
`components/chrome.tsx` (topbar, footer, brand, nav), `components/showcase-strip.tsx`,
`components/reveal-client.tsx` (the only client effect module), and the
landing-relevant sections of `app/globals.css`.

Out: `apps/web`, admin/request/download/wizard pages, `packages/core`.

## Audit → Replacement map

| Current effect | Replacement |
|----------------|-------------|
| Hero CTA: brightness + lift hover | Magnetic pull (pointer-tracked), inner spotlight glow, click ripple, spring-back |
| Hero title: per-letter translateY rise | Per-line clip-path wipe + per-letter blur-rise with overshoot stagger |
| Hero grid: static radial mask | Pointer-reactive spotlight mask (rAF-throttled), static fallback |
| Kanji: scale+fade in | Scroll parallax drift + gentle breathing scale |
| `.reveal` scroll: uniform fade-up | Directional clip-wipe + subtle scale, spring easing |
| Cards / steps: delayed fade-up + box-shadow hover | 3D perspective tilt-in on reveal + cursor-tracked tilt & sheen on hover |
| Section-head: inner fade-up stagger | Mono digit scramble-in on the section number |
| Topnav underline: linear sweep | Liquid elastic underline (spring overshoot) with leading accent dot |
| Brand logo: linear 45° rotate | Spring rotate (overshoot then settle) |
| Status dot: box-shadow pulse | Breathing glow refinement |
| Topbar: slide-down | Mask-reveal slide with staggered inner items |
| Showcase strip: linear infinite scroll | Eased perspective carousel, hover pop + pause, shimmer sweep |

## Foundations

- New easing tokens: `--ease-spring` (overshoot) alongside existing
  `--ease-out` / `--ease-soft`.
- A single extended client module (`reveal-client.tsx`) owns all
  pointer-driven JS: magnetic CTA, card/frame tilt, hero-grid spotlight,
  section-number scramble. Guarded by a capability check
  (`matchMedia("(hover: hover) and (pointer: fine)")`) and the existing
  reduced-motion guard. Pointer handlers are rAF-throttled.
- Each replaced CSS block is annotated `/* REPLACED: old → new */`.

## Constraints

- Modern Chrome, Firefox, Safari. Use `-webkit-` prefixes where needed
  (backdrop-filter already prefixed; clip-path and text-stroke are stable).
- No external libraries.
- No layout/content/markup-semantics changes beyond adding class hooks
  and `data-` attributes.
- Reduced-motion: all transforms/animations short-circuit (existing
  `@media (prefers-reduced-motion: reduce)` block extended to cover new
  classes); JS effects no-op.

## Verification

Build + typecheck `apps/cloud` clean. No live browser pass this round
(user reviews visually).
