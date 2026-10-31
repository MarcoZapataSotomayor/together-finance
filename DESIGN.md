---
name: Together Finance
description: Ornamental and comic identities for the Nuevo consumo prototype.
colors:
  shared-background: "#a8cedd"
  antonella-background: "#f6ced7"
  marco-background: "#8cb4c9"
  shared-paper: "#fff4e7"
  shared-primary: "#92344e"
  antonella-primary: "#974561"
  marco-primary: "#a62e3b"
typography:
  romantic-display:
    fontFamily: "'Lobster Two', 'Segoe Script', cursive"
    fontWeight: 700
    lineHeight: 1.15
  comic-display:
    fontFamily: "'Barlow Condensed', Impact, sans-serif"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.6
---

# Together Finance design system

## Overview

The mandatory visual authority is the actual artwork in `docs/design-references/Antonella.png`, `Marco.png`, `shared.png`, and `original-sketch.png`. Each was opened and inspected before implementing Nuevo consumo. All three identities must remain recognizable through composition, lettering, frames, controls, and decoration; changing only a background color is insufficient.

- **Antonella:** pink draped surroundings, cream sculpted framing, connected handwritten headings, strawberry/flower crest, satin pink bows, delicate rounded controls, a scalloped yellow allocation panel, and a layered mint save button.
- **Marco:** blue surroundings with original rooftop geometry, red diagonal bands, halftone accents, dark panel outlines, a skewed cream title plaque, condensed uppercase lettering, practical rectangular controls, and a graphic red save button.
- **Shared:** blue/red comic scenery outside an ornamental cream panel; strawberry crest and bottom bow; dark bold italic field labels; pink controls; scalloped yellow allocation; a mint save button with condensed uppercase lettering.

## Colors

`frontend/src/theme/tokens.css` is the token source of truth. Preserve semantic roles across themes: background, surface, text, muted text, primary/foreground, borders, focus, and shadows. Form-specific roles include `--paper`, `--input-surface`, `--input-border`, `--frame-edge`, `--frame-highlight`, `--selection`, `--selection-end`, `--selection-ink`, `--save-surface`, `--save-end`, `--save-ink`, `--danger`, and `--panel-gold`.

Use semantic tokens for controls; additional decorative pink, cream, mint, yellow, blue, charcoal, and muted red colors may appear inside the original SVG ornaments. Tailwind semantic utilities remain available for future components. Check contrast against the actual surface and both gradient endpoints.

## Typography

Lobster Two bold italic supplies connected script for Antonella and Shared titles. Barlow Condensed supplies Marco's uppercase title and the Shared/Marco save actions. Antonella uses italic serif field labels; Shared uses dark bold italic sans labels; Marco uses strong dark sans labels. Body text, inputs, percentages, and amounts remain readable sans-serif, with at least 16 px input text and tabular numeric previews.

Fonts are locally bundled WOFF2 files with SIL Open Font Licenses. No external font service is contacted at runtime. Decorative script must not extend to numerical entry or long text.

## Layout

Mobile first, specifically 375 and 390 px, with a one-column fallback at 320 px. Antonella and Shared pair place/date and amount/category; description spans the form. Marco places the purchase field across the width, pairs amount/date, then uses full-width description and category. The actual DOM follows the visual reading order, so keyboard navigation stays coherent.

At 960 px, the cream frame becomes a deliberate two-column composition: purchase/payment details on the left, allocation and a live example preview on the right. The themed save action anchors the bottom. The outer frame stops at 1050 px. No decorative element may obscure controls or create horizontal page scrolling.

## Elevation & Depth

Reference-directed layering is intentional: cream highlight strokes, double ornamental outlines, soft shadows for romantic controls, and offset red/charcoal accents for the comic plaques and save button. Keep halftone texture restrained and outside critical reading areas. The skyline is original geometric scenery, not branded artwork.

## Shapes

Use curved ornamental corners and flourishes for Antonella/Shared, a scalloped SVG allocation panel, rounded pill segments, and a large framed save action. Marco replaces flourishes with stronger outlines, skewed accents, tighter control corners, and a comic divider. SVG gradients suggest ribbon/berry shading without large image assets.

## Components

- Existing `PovProvider`, `usePov`, localStorage handling, Button, Card, Badge, and Icon remain available.
- `PovSelector` stays a native radio group with explicit labels and visible keyboard focus.
- `TextField` and `SelectField` provide native fields, labels, invalid states, and associated errors/hints.
- `SegmentedControl` provides keyboard-accessible radio groups for card type, expense type, and allocation mode.
- `StrawberrySprig`, `RibbonBow`, `CornerFlourish`, `FrameOrnaments`, `OrnamentalDivider`, and `ScallopedPanel` are original reusable decorative SVG components.
- `ExpenseDetailsFields` handles visual field ordering without touching financial state; `AddPaymentMethod` handles session-only method creation; `NewExpenseScreen` composes the controlled prototype.
- `expenseModel.ts` isolates validation, locale formatting, integer-cent parsing, and allocation calculations.

## Do's and Don'ts

- Keep all interface copy in Spanish and implementation identifiers/comments in English.
- Preserve the actual reference identities; do not return to a minimalist dashboard composition.
- Keep required financial selections explicit. POV is never authentication, payer, owner, or proof of identity.
- Persist only the POV preference in localStorage. Shared-password authentication uses a separate HttpOnly cookie; the expense prototype has no financial API calls, expense persistence, or financial filtering.
- Keep decorative SVGs hidden from assistive technology and pointer input, and preserve at least 44 px touch targets.
- Use visible focus and readable validation messages. Respect reduced-motion preferences.
- Preserve sufficient text contrast, including on gradients. Do not solve density by shrinking editable text below 16 px.
- Do not copy protected characters, official logos, or artwork from unrelated brands.

The lightweight vector interpretation intentionally has less dimensional ornament, less distressed texture, and more desktop breathing room than the portrait renderings. Device hardware, status bars, and photographic fabric detail are not reproduced.
