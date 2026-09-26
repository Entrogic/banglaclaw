# ADR-0011: Admin Dashboard as a Static SPA over the Admin API

## Status

Accepted

## Context

Operators need to see usage (runs, errors, tokens, cost), browse conversations across users and manage API keys without the CLI. The gateway must stay a pure API server (ADR-0005, ADR-0007), the `/v1` API is stable, and the page must not become a second authentication system.

## Decision

- **Data comes only from the `/v1` API** as an admin: `/v1/admin` plus the existing handoff, audit, agent, tool, skill and knowledge endpoints. The dashboard needs no endpoints of its own. Aggregation happens in `RunStore.stats()`, in SQL for Postgres, so the dashboard, `/metrics` and the database agree.
- **`apps/dashboard` is a Vite + React + TypeScript SPA** built to static files. React is already a dependency (the Ink chat). It uses `@entrogic-net/client` and no chart or UI library; the charts are small SVG components. Fonts (Inter, Noto Sans Bengali) are bundled from `@fontsource` so they load under `font-src 'self'`; colours are `light-dark()` tokens shared with the web chat, with a light/dark/system toggle stored in `localStorage`.
- **The gateway serves the build as static files at `/admin`** only when `gateway.dashboardDir` is set, with a strict CSP (`script-src 'self'`, `connect-src 'self'`) and immutable caching for hashed assets. The files are public; all data needs an API key.
- **Sign-in is an admin API key** kept in `sessionStorage` (cleared when the tab closes). There are no cookies, so there is no CSRF surface, and any 401 signs out.

## Consequences

Positive:
- No new auth mechanism, no server-side rendering, and no change to the runtime
- The dashboard can also be hosted separately (for example behind SSO) against the same API
- Everything it shows is available to scripts through the API and the typed client

Trade-offs:
- An admin key typed into a browser is a powerful credential; issue a dedicated key per person and revoke it when no longer needed
- A key in `sessionStorage` is readable by script on the page, which the strict CSP and the absence of third-party scripts mitigate
- Stats are computed per request; very large installations may need rollup tables later
