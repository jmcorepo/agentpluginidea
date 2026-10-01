# Switchboard: rides and eats dashboard MVP

## Product decision

Switchboard compares options across a person's existing accounts. The intended product is U.S.-only and eventually agent-connected. This implementation is a **local dashboard for both rides and food**, with browser-assisted capture and explicitly labeled user observations. MCP, a ChatGPT app, unattended purchasing, and meal discovery are later stages.

The core promise remains personalized comparison: the user prepares the actual quote in their signed-in provider account. The MVP does not substitute synthetic prices or generic fare models for their checkout. It proves the comparison contract and local account workflow; it does not establish provider permission or commercial API approval.

## Implemented journeys

### Rides

1. Enter pickup, destination, and passenger count.
2. Open Uber and Lyft in separate local browser contexts; sign in directly with each provider.
3. Prepare the same journey and equivalent vehicle categories in the provider windows or interactive screenshot view.
4. Capture visible exact fares. Recognized category blocks with unambiguous amounts become provisional quotes. Unsupported layouts, fare ranges, missing prices, and foreign currencies are unavailable.
5. Check route, passenger capacity, category equivalence, and USD currency. Confirm each usable quote before ranking.
6. Continue directly on the chosen provider. Switchboard does not book rides.

Pickup waiting time is not destination arrival time. Ride ETA is eligible for fastest ranking only when explicitly identified as destination arrival or total trip time. Unknown ETA remains unknown.

### Eats

1. Enter delivery address, restaurant branch, exact items, quantities, options, and the common tip.
2. Open DoorDash and Uber Eats; sign in directly.
3. Prepare matching baskets and delivery options, stopping at checkout before purchase.
4. Capture the actual visible final total. Subtotal alone is insufficient. Record explicit breakdowns and applied benefits only where displayed.
5. Check branch, every item and modifier, quantity, address, delivery option, matching tip, and USD currency. Confirm provisional quotes.
6. Continue directly with the chosen provider. Capture never changes baskets, clears carts, or places an order.

A detected tip mismatch makes a captured basket ineligible. Missing tip information requires user verification. Partial fee breakdowns do not establish completeness or justify inventing missing charges.

### Observed quote fallback

When a page cannot be parsed, the user can enter the amount actually observed. It is labeled `manual`, bound to the same request, and requires an explicit equivalence/USD checkbox. An unknown ETA is left blank. This is a user observation, not a provider API quote.

## Dashboard and account setup

- Rides and Eats have request forms, provider-browser shortcuts, quote cards, captured evidence, confirmation controls, and observed-quote forms.
- Connections displays browser state. An open browser is never proof of sign-in.
- History stores comparisons and provenance. Historical prices are snapshots.
- Settings explains local browser setup and session storage. No API secrets are collected.
- The layout responds to smaller screens, but this pilot runs on the user's computer. Native ChatGPT phone integration is not implemented.
- Empty states have no pretend quotes or seeded connections.

On desktop, provider windows open visibly so users can authenticate normally. Screenshot controls allow clicking, typing, key presses, scrolling, and navigation within the corresponding provider. No API keys are needed. Sign in is handled by the provider; the dashboard does not collect provider passwords as account settings.

## Quote contract and ranking

A quote has an ID, provider, sector, provenance, status, category/basket label, integer-cent total or `null`, currency context, capture time, freshness cutoff, optional ETA/breakdown, observed benefits, warnings, evidence, and request fingerprint.

Statuses are `needs_confirmation`, `verified`, and `unavailable`. Browser extraction starts provisional. **Verified means the user checked contextual equivalence**, not a provider guarantee or an automatic match of route/items. The request fingerprint binds the quote record to the submitted request; it does not independently prove what the provider page contains.

Missing values are unknown, never zero. Conflicting final totals, malformed amounts, non-USD currencies, and known inequivalence fail closed. Plain `$` is accepted only in the explicitly configured U.S./USD pilot context, with a warning and USD confirmation.

Only confirmed, current, matching-fingerprint quotes rank. Cheapest uses the total; fastest uses explicit ETA when available. Before calling an option cheaper than another provider, both need eligible equivalent quotes. Existing memberships and offers are accounted for by the actual provider checkout; unsupported benefit extraction does not invent savings.

App freshness cutoffs are five minutes for rides and fifteen minutes for food. These are refresh requirements, **not provider-issued fare guarantees**. Stale confirmation is rejected and stale quotes leave the ranking. Capture again before choosing.

## Architecture

- Node.js 22.12+, TypeScript, a small HTTP server, Zod validation, Playwright, and a static HTML/CSS/JavaScript dashboard.
- Original adapters read rendered text on the current page. No private reverse-engineered APIs, stealth, fingerprint spoofing, challenge bypasses, or autonomous purchasing.
- Separate provider browser contexts; serialized actions per provider. Provider navigation uses the corresponding HTTPS domain family. Supported authentication redirects are allowed separately; authentication pages cannot be quote sources.
- Headed windows by default on supported desktops; screenshot fallback without a display.
- Encrypted local history and browser storage state with an owner-restricted local key. This is a single-owner local store, not a cloud multi-tenant credential service.
- Localhost binding by default; same-origin API checks and dashboard client header. Deliberate non-local operation requires an access password and is outside initial local testing.
- No ordering endpoint. Screenshot controls reject recognized purchase actions. The user can independently buy in their provider window.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Browser availability and connection states |
| `POST /api/connections/:provider/open` | Open or resume provider browser |
| `DELETE /api/connections/:provider` | Disconnect and remove saved session |
| `GET /api/browser/:provider/screenshot` | Current viewport |
| `POST /api/browser/:provider/action` | Click, type, key, scroll, navigate |
| `POST /api/rides/compare` | Capture current ride pages for submitted request |
| `POST /api/eats/compare` | Capture current checkout pages for basket |
| `POST /api/comparisons/:id/quotes/:quoteId/confirm` | Confirm with `{confirmed:true}` |
| `POST /api/comparisons/:id/manual` | Save explicitly observed quote |
| `GET /api/comparisons/:id` | Comparison and current ranking |
| `GET /api/comparisons` | History |
| `GET /api/settings` | Capability flags; no secrets |

## Acceptance criteria

1. Both sectors work through real browser-session capture or explicitly observed amounts.
2. Disconnected or failed providers produce unavailable quotes, never demo prices.
3. Captured amounts cannot rank until exact context and USD are confirmed.
4. Subtotal-only, conflicting, malformed, foreign-currency, expired, wrong-request, and wrong-origin quotes fail closed.
5. Manual provenance remains visible; invalid provider/sector and invalid monetary fields are rejected.
6. Reopening a provider preserves the prepared page unless the user explicitly navigates.
7. Disconnect deletes provider session state; history persists.
8. Reload restores history; current ranking excludes expired quotes.
9. Browser controls, forms, capture, confirmation, manual fallback, and history are verified end-to-end with local fixtures. Fixture amounts are test inputs, never seeded dashboard content.
10. Live provider sign-in and current layouts must be tested on the user's computer. Fixture success is not live provider validation.

## Research evidence and remaining gates

The [official Uber authentication SDK](https://github.com/uber/rides-android-sdk/tree/main/authentication) supplies maintained OAuth/PKCE. Older [Uber rider documentation](https://github.com/uber/rides-python-sdk) shows estimates, upfront fares, and booking; current rider-scope access remains unresolved. [Lyft's official Go SDK](https://github.com/lyft/lyft-go-sdk) is deprecated. [DoorDash Drive's official example](https://github.com/doordash-oss/doordash_sdk_example_application) demonstrates dispatch, not personalized consumer baskets.

A [secondary MealMe specification](https://github.com/jentic/jentic-public-apis/blob/main/apis/openapi/mealme/main/1.0.0/openapi.json) describes menus, quotes, and ordering. It does not establish existing DoorDash/Uber Eats membership/coupon access. Actual pricing, channels, consumer linking, and comparison rights need primary confirmation.

[Existing DoorDash](https://github.com/markswendsen-code/mcp-doordash) and [Uber Eats](https://github.com/markswendsen-code/mcp-ubereats) agent connectors establish prior attempts. Some code defaults unknown totals to zero and generates timestamp-based order IDs without provider confirmation. This MVP preserves unknowns and does not execute purchases. Their live reliability and permissions are unverified.

Before unattended commercial release, settle competitive-comparison permissions, intended automation rights, production API eligibility, personalized benefit coverage, quote guarantees, pricing, and purchase/support responsibilities. Current vendor terms and traditional competitor capabilities could not be fully verified through public-web access in this environment. That evidence gap is not a claim of technical impossibility.

## Next stages

1. Test actual provider layouts locally and extend parsers only from observed evidence.
2. Add supported official quote adapters as provider access and rights become available.
3. Add permitted route/basket preparation, preserving existing carts and enforcing item/category equivalence.
4. Add MCP and a ChatGPT app to the same backend. The [official authenticated Apps SDK example](https://github.com/openai/openai-apps-sdk-examples/tree/main/authenticated_server_python) is the starting pattern. Sign in with ChatGPT eligibility is a separate commercial question; its local DevKit has a [noncommercial license](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE).
5. Add supported purchase execution with exact-quote approval, duplicate prevention, and ambiguous-result recovery.
6. Add meal discovery and group planning using proven menu/basket infrastructure.

The likely moat is reliable personalized comparison and execution, permitted provider access, and agent distribution. Test consumer subscription or agent-API pricing against savings, repeat usage, comparison costs, and support burden. No affiliate rates or aggregator prices are assumed.
