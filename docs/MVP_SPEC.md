# Automatic rides and food comparison MVP

## Objective and boundaries

Build a U.S.-only, single-owner local application that compares actual prices in the user's existing Uber/Lyft and DoorDash/Uber Eats accounts. The core interaction is **enter once, prepare both providers automatically, validate independent provider evidence, compare**. The interface is plain functional forms, status messages and tables. Login and exceptional account/cart problems can require attention; routine manual provider setup, manual prices and quote-verification checkboxes are outside the workflow.

The current implementation is an automatic browser-adapter prototype. Supported rendered page patterns are exercised with local Chromium fixtures. Actual account access and current live layouts remain a separate acceptance gate. It must report unsupported pages or unresolved context rather than present fixture success as live-provider support.

No purchases, meal discovery, group planning, MCP, ChatGPT app or unused API-key collection in this build. Local desktop use is the primary test path. An optional single-owner Node/Chromium container configuration supports future hosting; it has not been built or deployed here, and a Sites/static preview is not the automatic backend. Local account state is the basis for personalization; provider-displayed offers and fees are used rather than generic price models. Account state alone does not prove every membership or coupon is applied.

## Rides

The user enters full pickup and destination addresses and 1–4 passengers. The first supported comparison is standard private UberX against Lyft Standard; shared rides and premium categories are excluded.

Each adapter finds provider route controls, enters both addresses, chooses a uniquely matching autocomplete result where available and invokes a price-search control. It never invokes a ride-request or payment control. After preparation, it reads independently rendered resolved pickup/destination details, the standard category, passenger capacity and an unambiguous fare. Typed input values and the submitted request are not route evidence.

Both resolved addresses must match the request after conservative formatting/common street-suffix normalization. Ambiguous geocoding, missing capacity, wrong/shared category, unsupported controls, sign-in interruptions or unclear prices produce an unavailable result with a precise next action. Destination arrival/trip duration may support fastest ranking when explicitly displayed. Pickup waiting time must never be relabeled as arrival at the destination.

## Food

The user enters the restaurant name and exact physical branch address, delivery address, exact item names, quantities, structured modifier group/option pairs, optional kitchen instructions and one common tip. The first comparison uses standard delivery, without substitutions.

Each adapter prepares the exact branch and basket using visible provider controls and stops before purchase. It preserves a conflicting existing cart and asks the owner to resolve that exception instead of clearing it or merging unrelated items. Matching pages may be resumed without duplicate additions.

The accepted quote needs independently rendered merchant name/branch address, delivery address, every item and quantity, all specified modifiers and instructions, standard delivery, common tip and an unambiguous final total. Matching the item name alone is insufficient. A missing required option, wrong size, branch mismatch, quantity mismatch, undisclosed tip, changed delivery speed or extra cart item makes the comparison unavailable. Notes cannot substitute for structured paid options.

Read explicit fee/discount breakdowns and account benefits when displayed. Subtotal is not a final total. Missing fees are unknown, not zero. When all components are present, a contradictory final total is rejected. Never invent discounts or claim an unapplied membership is reflected in the price.

## Verification, currency and ranking

Each quote carries provider, source, status, integer-cent amount or null, capture/freshness times, optional ETA/breakdown, observed benefits, warnings and evidence. A request fingerprint prevents record mixing; it does not establish provider context.

Automatic quotes also carry `verification: automatic` and `observedContext` from rendered provider DOM or a permitted provider API. The server independently validates that context against the submitted request. Only quotes that pass this validation can be `verified` and ranked. Legacy assisted history may retain its provenance but does not become automatic evidence.

USD requires either an explicit USD/US$ label or independently observed full U.S. addresses with a U.S. state and five-digit ZIP: both resolved ride endpoints, or merchant and delivery addresses for food. Configuring an expected currency or reading a plain dollar sign alone is not sufficient. Explicit foreign-currency markers are rejected.

Cheapest ranks current, equivalent, automatically verified totals. Fastest requires independently identified comparable destination/delivery ETA. At least two distinct providers must have eligible quotes before the dashboard declares a cross-provider winner. A single available result is useful but does not prove superiority over an unavailable provider.

App freshness limits are five minutes for rides and fifteen minutes for food. They are refresh rules, not provider-issued fare validity. Expired quotes leave ranking automatically. Historical records remain snapshots; refresh before acting.

## Architecture and ownership of state

Node.js 22.12+, TypeScript, a small local HTTP server, Zod request validation, Playwright and static HTML/CSS/JavaScript. Separate browser contexts isolate provider accounts; actions serialize within each provider. The orchestration runs both sector adapters and records a comparison with each provider's success or actionable exception.

Visible provider windows are the default on supported desktops, with screenshot controls as a fallback. Account authentication remains on provider pages. Allowed navigation is restricted to the provider's HTTPS domain family, with separately permitted authentication redirects; authentication pages cannot supply quotes.

Local sessions and history are encrypted in `.data/` using an owner-restricted key. Disconnect removes session state. This is a single-owner local application, not a multi-tenant credential service. The server defaults to localhost and uses same-origin API guards and a dashboard client header. Optional `MVP_PASSWORD` locks the local dashboard. Non-local operation requires a password of at least 12 characters. An included Docker/Compose option uses headless Chromium, persistent encrypted `/data`, a password and exact `APP_ORIGIN` for an external HTTPS reverse proxy. Compose binds its port to localhost by default. This packaging is not proof of a successful image build, deployment or remote provider login.

Adapters use original rendered-page automation. No stealth, challenge bypass, proxy evasion, reverse-engineered private APIs or autonomous purchases. Screenshot controls reject recognized purchase actions; the owner may independently continue in the native provider window.

## API and UI

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Browser availability, authentication requirement and provider states |
| `POST /api/connections/:provider/open` | Open/resume account browser, preserving its page |
| `DELETE /api/connections/:provider` | Disconnect and remove saved session |
| `GET /api/browser/:provider/screenshot` | Account/exception viewport |
| `POST /api/browser/:provider/action` | Account/exception navigation and controls |
| `POST /api/rides/compare` | Start an automatic ride comparison; return HTTP 202 job |
| `POST /api/eats/compare` | Start an automatic food comparison; return HTTP 202 job |
| `GET /api/jobs/:id` | Provider progress and completed comparison |
| `GET /api/comparisons/:id` | Comparison with current eligibility/ranking |
| `GET /api/comparisons` | History with provenance |
| `GET /api/settings` | Capability flags without secrets |

Forms submit the request once and poll the job once per second, showing provider preparation, validation and action-required stages. The initial version has no cancellation endpoint. Results show provider, category/basket, actual amount, ETA, status, evidence and actionable exceptions. Connections distinguishes browser-open from proven readiness. No demo quotes or seeded account states. History preserves request details and proof. No normal-workflow manual price or quote-confirmation controls.

## Acceptance gates

1. Both providers in each sector prepare from a single submitted request and obtain prices without routine user re-entry.
2. Route/basket context is observed independently after preparation. Tests catch a provider showing stale details even when inputs contain the new request.
3. Wrong branch/address/items/modifiers/notes/quantity/tip/speed/category/capacity, ambiguous price, unsupported currency and missing evidence yield unavailable quotes, never fabricated zeroes.
4. Existing conflicting carts are preserved. Retries do not duplicate basket contents or create orders.
5. A failed provider does not suppress the other provider's result or create a false cross-provider winner.
6. Authentication/challenge/unsupported-page failures are actionable. Browser state does not falsely assert successful login.
7. Expired quotes and legacy assisted records cannot enter automatic rankings. Refresh/reload/history preserve these rules.
8. Local fixtures exercise real browser interactions, adapter preparation, independent evidence, failures and purchase avoidance. Fixture values are test data, never application content.
9. Live acceptance requires each current provider to complete the flow with a real signed-in U.S. account; record rendered selectors/evidence and repeat with changed routes/baskets, existing carts and benefits. Fixture tests alone cannot pass this gate.
10. Before public distribution, establish permitted comparison/automation, access reliability and support responsibilities. This does not block implementing/testing the local prototype.

## Research evidence and production path

The [official Uber authentication SDK](https://github.com/uber/rides-android-sdk/tree/main/authentication) supplies OAuth/PKCE. Older [Uber rider SDK documentation](https://github.com/uber/rides-python-sdk) describes quotes and booking; this is not evidence that a new developer has those production scopes. [Lyft's old official Go SDK](https://github.com/lyft/lyft-go-sdk) is deprecated. [DoorDash Drive's example](https://github.com/doordash-oss/doordash_sdk_example_application) demonstrates dispatch, not personalized consumer marketplace comparison.

A [secondary MealMe specification](https://github.com/jentic/jentic-public-apis/blob/main/apis/openapi/mealme/main/1.0.0/openapi.json) describes menus, quotes and ordering. Personal DoorDash/Uber Eats memberships/coupons, exact channels, actual pricing and permitted comparison need primary confirmation. Do not substitute an aggregator basket for an account-personalized quote without proving equivalence.

Existing [DoorDash](https://github.com/markswendsen-code/mcp-doordash) and [Uber Eats](https://github.com/markswendsen-code/mcp-ubereats) agent prototypes demonstrate prior browser attempts. Some code defaults unknown totals to zero or creates timestamp-based order IDs without provider confirmation. This build uses original adapters, preserves unknowns and has no purchase execution. Their current reliability and rights are unverified.

Secondary browser research supplies useful warnings, not access proof. An [openweb progress report](https://github.com/imoonkey/openweb/blob/main/src/sites/ubereats/PROGRESS.md) says Uber route inputs lacked standard accessible/test attributes during its capture. A [separate agent skill](https://github.com/AFK-surf/Comma/blob/main/resources/salix-system-files/skills/lyft-grab/SKILL.md) reports Lyft web redirects and closed new-app API access. These claims have not been checked live here. Referenced food prototypes supply some address/menu/cart selector leads, but not complete independent branch/modifier/instruction/delivery evidence. Local fixture semantics for missing fields must not be presented as established vendor DOM. Reverse-engineered API calls in other repositories are not adopted by this build.

Live vendor terms and competitor coverage could not be fully checked in this environment because public-web access was unavailable. Commercial API access and automation/comparison rights remain unresolved, not technically impossible. The smallest useful proof is the four live automatic quote flows with strict equivalence; prioritize hardening rides first if that proof succeeds sooner.

After live proof: stabilize selectors and diagnostics, secure permitted official integrations when available, add MCP/ChatGPT app around the same verified contract, then add approved purchasing with duplicate prevention and ambiguous-result recovery. Meal discovery and group planning follow reliable menu/basket infrastructure. The [authenticated Apps SDK example](https://github.com/openai/openai-apps-sdk-examples/tree/main/authenticated_server_python) is an integration pattern; Sign in with ChatGPT eligibility and the [DevKit commercial license](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE) are separate questions.

Potential moat: reliable personalized comparison, permitted provider access, robust execution and agent distribution. Validate subscriptions or agent-API usage pricing against actual savings, frequency, browser maintenance and support costs; no affiliate rates are assumed.
