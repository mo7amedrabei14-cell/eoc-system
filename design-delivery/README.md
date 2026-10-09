# EOC Red Crescent Command — design delivery

## One-page implementation report

- **Framework:** React 19 + Vite 8; route composition is in `frontend/src/App.jsx`.
- **CSS:** Tailwind CSS 4 plus semantic CSS variables. `index.css` owns global tokens and component foundations; `supercharged.css` owns shared desktop materials; `mobile.css` owns responsive behavior; `login/loginScene.css` owns login presentation.
- **Protected behavior:** keep `Dashboard.jsx`, `Login.jsx`, `SegInputs.jsx`, `apiBase.js`, `App.jsx`, backend routes, and form/API bindings behaviorally unchanged. This pass changes only CSS and design-delivery assets.
- **Direction selected:** **Crimson Command** — cool charcoal / porcelain surfaces, measured Red Crescent red, strong operational hierarchy, RTL-first composition, and low-noise transitions. The concept board also records Signal Atlas and Field Console as the two alternatives.

## Five immediate visual improvements

1. Cool, layered dark and light surface palettes are defined in `frontend/src/index.css` and mirrored in `frontend/src/supercharged.css`.
2. Light-theme muted text is darkened for improved legibility while accent red remains reserved for priority states.
3. The shared navigation keeps its moving active surface but no longer transitions the hover shadow.
4. Card and glass elevations use quieter, shorter shadows to avoid rectangular-looking halos and preserve hierarchy.
5. Login submit now has an explicit keyboard-visible focus ring; existing responsive and reduced-motion rules remain in place.

## Files changed

- `frontend/src/index.css` — global dark/light semantic palette and static shadow tokens.
- `frontend/src/supercharged.css` — corresponding shared surface tokens and nav hover transition.
- `frontend/src/login/loginScene.css` — keyboard focus visibility for the submit control.
- `design-delivery/` — portable tokens, SCSS map, SVG concept board, and integration notes.

## Integration constraints

No React, API, route, authentication, RBAC, form field, or endpoint code was changed. No dependency was added. Existing PNG assets and embedded SVG icons remain untouched because converting or swapping them requires changing their JSX references, outside the CSS-only boundary. Skeleton markup and reduced-motion handling already exist; this pass preserves them rather than introducing a second loader system.

`figma-export/direction-board.svg` is a vector concept sheet and can be imported into Figma. It is **not** a native `.fig` project or a published Figma URL; no Figma integration is available in this workspace.

## Validation status

- Before-edit browser sample on the development dashboard: `first-contentful-paint` observed at **2.20 s** (browser Performance API, not Lighthouse). This is not a production baseline and does not prove an LCP/FCP target.
- After palette tuning, browser-calculated contrast for the muted and subtle text tokens is at least **4.69:1 in dark mode** and **4.78:1 in light mode** across the documented neutral surface steps. This measures palette tokens, not every possible component/background pairing.
- Dashboard rendered after reload without page errors; both themes and the narrow responsive layout were visually inspected. The development server reported an aborted realtime-stream request during navigation; this is not evidence of a design-related performance regression.
- Lighthouse and `gh` CLI are not installed in the workspace. A verified before/after Lighthouse report and hosted pull request therefore remain unavailable; do not treat the browser sample as a Lighthouse result.
- Verify with `npm --prefix frontend run build` and `npm --prefix frontend test`, then compare keyboard navigation, light/dark mode, RTL/LTR, desktop/mobile screenshots, contrast, and production Lighthouse under the same device/network profile.
