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

## ARIA Launcher / Tell ARIA Capsule

The global **Tell ARIA** launcher is a signature interactive control and must remain reachable above page content on every non-ARIA route.

Contract:
- It is a fixed, floating control with an authoritative high stacking layer so normal page content can never cover its hit area.
- It remains pointer-interactive (`pointer-events:auto`) and supports touch and mouse pointer events.
- Its compact state is the round ARIA orb; its expanded state reveals the label through the existing width/reveal transition.
- It may be repositioned by pointer drag without losing its click/tap action.
- On mobile it must respect the safe-area inset and maintain a small visual gap from the screen edge.
- The launcher must be hidden only on the ARIA route itself, not as a side effect of page content layering.
- The launcher uses the same living glass material as the rest of NYEO UI and must not introduce a separate visual language.

### Home action relationship

The three primary Home actions — **Scan**, **Attendance**, and **Review** — remain in normal document flow but are intentionally lifted slightly above the floating Tell ARIA launcher baseline. This creates a clear vertical relationship without changing their actions, sizes, labels, or state logic.

## ARIA Conversation Presentation

ARIA assistant responses are presentation content, not raw source text. The conversation surface must render supported Markdown rather than exposing formatting delimiters to users.

Supported presentation includes:
- **bold** and __bold__ emphasis;
- *italic* and _italic_ emphasis;
- ordered and unordered lists;
- headings inside longer responses;
- inline code when technical context is intentionally surfaced.

User messages remain plain text. Assistant Markdown must be rendered as readable DOM elements with accessible spacing, and raw formatting markers should not be visible merely because ARIA used Markdown syntax.

## ARIA Welcome Controls / Person Finder

The four welcome prompt cards are real interactive actions and must remain clickable when the conversation thread is empty. The empty thread layer must not intercept pointer/touch events over the welcome area.

The **Find a person…** control must keep its search results above the conversation stage. Search results are loaded from the organization-scoped People API, and choosing a result sets the ARIA page's person context without changing or corrupting organization data.

## Motion vocabulary
Float, Breathe, Merge, Press, Expand, Reveal, Settle, Glow, Drift.

Use only the smallest motion needed to explain state.

## Visibility contract
Every component must remain legible against all NYEO living-background states. Prefer material density and contrast adjustments over changing the semantic palette. Respect `prefers-reduced-motion` and `prefers-reduced-transparency` where supported.

## Inspiration, not dependency
Research references include OpenGlass UI, LiquidGlass UI, Motion Primitives, and other open-source liquid-glass implementations. NYEO UI remains dependency-free for now so NYEOCARE keeps its current Next.js 14 / React 18 architecture stable.


### People card semantic rows
People cards must use semantic row class names for dynamic person facts:
- `ny-last-seen` for the canonical last-seen value.
- `ny-phone-row` for the phone value.

CSS must not hide or identify these rows by matching SVG path/rect geometry. Icon implementation is replaceable; row meaning is not. Last seen remains visible when data exists and displays month + day in the Africa/Lagos timezone.

