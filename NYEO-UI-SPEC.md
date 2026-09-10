# NYEO UI

NYEO UI is the visual foundation for NYEO products. It is inspired by open-source work on dimensional glass, accessible component systems, and restrained motion, but is not a copy of any existing library.

## Principles
- People first; technology disappears into the material.
- One coherent material language across pages and future NYEO apps.
- Semantic colors stay stable. Time/weather changes optical response, not meaning.
- Glass must remain readable on bright and dark living backgrounds.
- Motion explains state: breathe, press, merge, reveal, settle.
- No decorative animation that does not communicate something.
- Accessible controls, visible focus, reduced-motion fallback.
- Mobile-first and touch-safe.

## Canonical tokens
- Night: #070D1D
- Surface: #0B1326 / #101A31
- Text: #F5F7FA
- Muted text: rgba(245,247,250,.68/.42/.25)
- Gold: #D6B86A / #E8D49A
- ARIA: #8FAFD6
- Good: #7FBF9A
- Attention: #D6B86A
- Critical: #D77B7B
- Info: #8FAFD6
- Borders: rgba(255,255,255,.055/.08/.14)
- Radius scale: 8, 12, 16, 20, 24, 28, 32px

## Materials
1. Surface — quiet dense glass for cards and rows.
2. Liquid — dimensional interactive glass for buttons and floating controls.
3. Living — thick dimensional glass for navigation, ARIA objects, and signature interactions.

Material response may adapt to the living environment by increasing/decreasing opacity, rim contrast, shadow, and internal highlights. Semantic colors never change.

## Signature navigation
The primary navigation is a single living material made from three spherical nodes joined by two true hourglass/hyperbolic liquid connectors. Connectors are wider at each orb and narrow toward their center; they must never read as rectangles or a flat capsule.

The active node is illuminated from inside. Its light should softly bleed into the surrounding material and environment rather than appear as a gold outline. Press compresses the node and lets it rebound like viscous gel.

## Components
Initial foundation:
- NYEO Card
- NYEO Button
- NYEO Icon Button
- NYEO Liquid Navigation
- NYEO Row
- NYEO Badge
- NYEO Input

Future components should consume the same tokens and material rules rather than invent local visual systems.

## Motion vocabulary
Float, Breathe, Merge, Press, Expand, Reveal, Settle, Glow, Drift.

Use only the smallest motion needed to explain state.

## Visibility contract
Every component must remain legible against all NYEO living-background states. Prefer material density and contrast adjustments over changing the semantic palette. Respect `prefers-reduced-motion` and `prefers-reduced-transparency` where supported.

## Inspiration, not dependency
Research references include OpenGlass UI, LiquidGlass UI, Motion Primitives, and other open-source liquid-glass implementations. NYEO UI remains dependency-free for now so NYEOCARE keeps its current Next.js 14 / React 18 architecture stable.
