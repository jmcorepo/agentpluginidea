# MVP verification

Verified locally in the build environment on 2026-10-01 using Node.js 24.19.0 and Chromium 151.0.7922.173.

- TypeScript checking and production compilation passed.
- All 31 unit tests passed: provider-origin checks, conservative money parsing, food fee reconciliation, tip mismatch, currency, ETA semantics, ranking eligibility, freshness, confirmation, and encrypted storage.
- `npm run verify` passed using synthetic pages in real Chromium. It exercised all four provider readers, isolated session cookies, prepared-page preservation, screenshots, typing, recognized purchase-control rejection, and disconnect.
- The dashboard workflow passed through the HTTP API and encrypted store: password login, API origin/client/auth guards, provisional quote confirmation, two-provider cost/ETA ranking, rides and food manual observations, unavailable-provider errors, history reload, server restart, and a 390px viewport without horizontal overflow. No uncaught browser page errors occurred.
- A separate agent-browser check loaded the dashboard, inspected its controls, and captured its initial screenshot.

## Practical limits

Fixture data lives only in temporary verification directories, which the script removes. The normal dashboard starts empty. These checks do not prove successful live Uber, Lyft, Uber Eats, or DoorDash login or compatibility with their current account-specific layouts. Public provider-site access was blocked in the build environment; those checks require the user's computer and actual accounts.

No real rides, food orders, or charges were made. No account credentials or API keys are included in the source. The GitHub CI workflow runs the same checks on Node 22; see the draft PR for its current result. An initial CI run identified a Node-version-specific test-launcher flag, which was replaced with a portable single-process launcher. The declared minimum Node version is 22.12; the local run above used Node 24.
