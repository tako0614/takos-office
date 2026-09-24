# Design — Takos Office

A locked design system for the Office application. Every app surface reads this
before visual changes. Extend this file when the system grows; do not invent a
separate theme per editor.

## Genre

Modern-minimal, utilitarian, and paper-first. The reference is the information
hierarchy of Google Workspace: the current file and its editing commands outrank
suite branding and preference controls.

## Macrostructure family

- Per-editor libraries: **Workbench** — compact suite navigation, one primary
  create action, search where useful, then recent work. There is no second
  suite launcher; `/` enters the Docs library directly.
- Editors: **Workbench canvas** — app navigation, file title, contextual tools,
  then the document/slide/grid surface.
- Marketing pages: outside this app redesign and unchanged.

## Theme

- `--color-paper`: `oklch(0.985 0.004 255)`
- `--color-paper-2`: `oklch(0.965 0.008 255)`
- `--color-ink`: `oklch(0.23 0.025 255)`
- `--color-ink-2`: `oklch(0.49 0.025 255)`
- `--color-rule`: `oklch(0.89 0.012 255)`
- `--color-accent`: `oklch(0.57 0.19 258)`
- `--color-focus`: `oklch(0.57 0.19 258)`
- Docs, Slides, and Sheets may use blue, orange, and green respectively only
  for app identity and the current primary action. They are not page themes.

## Typography

- Display: platform UI sans, weight 650, normal.
- Body: platform UI sans, weight 400–600.
- Document content: editor-owned document fonts; never inherit suite display
  styling into user content.
- Mono: platform monospace, weight 400.
- Display tracking: `-0.025em`.
- No ornamental type pairing inside the application.

## Spacing

Use the 4-point named scale in `tokens.css`. Dense toolbars use `--space-2xs`
and `--space-xs`; libraries use `--space-sm` through `--space-xl`. Intentional
editor canvases own their scrolling; the page chrome must not overflow.

## Motion

- Short state changes use `--dur-short` and `--ease-out`.
- No entrance choreography or decorative reveal.
- Reduced motion removes transforms and reduces transition duration.

## Microinteractions stance

- Autosave is quiet; show text only while saving, on failure, or on conflict.
- Hover never moves editor chrome; a library card may lift by at most 1px.
- Focus is immediate and visible. Touch targets are at least 40px, preferably
  44px on mobile.
- Destructive actions require a named confirmation and retain retryable errors.

## App chrome

- Do not show a Takos Office logo or wordmark in persistent chrome.
- Do not add a suite-home control. Editors may expose a labelled back action to
  their own library where the editing flow needs it.
- Do not put language or theme switches in editing headers. Language follows the
  browser/Takosumi locale; appearance follows the operating system.
- Keep only app navigation, current file title, editing commands, contextual
  help, and the app's primary action in persistent chrome.
- Standard Office import/download belongs in the library and file action
  surfaces. Native JSON record extensions stay out of normal user chrome.

## CTA voice

- Primary: one compact rectangular action in the current app colour.
- Secondary: quiet border or text action; no pill-shaped marketing controls.
- Copy names the action: New document, Add slide, Present, Create.

## Per-page allowances

- App pages must not use decorative enrichment; function carries the page.
- Docs may render a paper canvas, Slides a stage and filmstrip, Sheets a grid.
- Semantic app colours may differ; typography, borders, radii, spacing, focus,
  error states, and chrome hierarchy must remain shared.

## Exports

### tokens.css

The canonical runnable export is [`tokens.css`](tokens.css).

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(0.985 0.004 255);
  --color-paper-2: oklch(0.965 0.008 255);
  --color-ink: oklch(0.23 0.025 255);
  --color-ink-2: oklch(0.49 0.025 255);
  --color-rule: oklch(0.89 0.012 255);
  --color-accent: oklch(0.57 0.19 258);
  --font-display: ui-sans-serif, system-ui, sans-serif;
  --font-body: ui-sans-serif, system-ui, sans-serif;
  --spacing-md: 1.5rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(0.985 0.004 255)", "$type": "color" },
    "ink": { "$value": "oklch(0.23 0.025 255)", "$type": "color" },
    "accent": { "$value": "oklch(0.57 0.19 258)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" }
  },
  "space": { "md": { "$value": "1.5rem", "$type": "dimension" } }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 0.985 0.004 255;
  --foreground: 0.23 0.025 255;
  --primary: 0.57 0.19 258;
  --primary-foreground: 0.99 0.004 255;
  --muted: 0.965 0.008 255;
  --muted-foreground: 0.49 0.025 255;
  --border: 0.89 0.012 255;
  --input: 0.89 0.012 255;
  --ring: 0.57 0.19 258;
  --radius: 0.5rem;
}
```
