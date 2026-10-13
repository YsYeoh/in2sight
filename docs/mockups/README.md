# Approved mockups (visual reference)

These are the owner-approved design mockups: plain HTML/CSS/JS, **not** production code. The real app is built with Next.js + Tailwind + shadcn/ui + Recharts and must match these visually (tokens, spacing, radius, motion, density).

```
node docs/mockups/serve.cjs        # then open http://localhost:5173/
```

| Page | What it shows |
|---|---|
| `app-prototype` | Full clickable app: login (particles), shell, Overview, Accounts + connect flow, Account detail (tabs, globe), Tags, Settings |
| `kit-forms` | Buttons, inputs, selects, choice controls, date-range picker, form layout, alerts, dialogs, toasts, tabs |
| `kit-data` | Interactive data table, comparison table, lists, loading/empty states |
| `kit-charts` | Line, area, stacked, diverging, grouped bars, donut, ranked bars, funnel, heatmap, rings, sparklines, states |
| `design-tokens`, `themes`, `motion-demo`, `dense-account` | Earlier exploration (tokens, 4 themes, motion, dense layout) |

`kit.css` is the token source of truth for the mockups (4 themes × light/dark × density × radius presets). The bar at the top of each page switches theme, mode, density, radius and language (EN / 简体).

Notes for implementers:
- Charts here are hand-drawn SVG; the app uses Recharts with the same visual spec (colours `--chart-1…6`, 2px lines, dashed grid, tooltip style, entry animation).
- Mockup UI text uses a tiny inline EN/zh helper; the app uses next-intl message files.
- Heavy effects (particles, globe) must be gated for phones, reduced-motion and Save-Data (see `docs/SPEC.md` §8b).
