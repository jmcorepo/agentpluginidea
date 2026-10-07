---
name: compare-food
description: Compare the same food basket on Uber Eats and DoorDash using authorized provider tools or the host browser, then validate final checkout totals and delivery windows with Switchboard.
---

# Compare Uber Eats and DoorDash

Use this workflow when the user asks Switchboard to compare a meal, food order, delivery cost or delivery time. Handle BOTH providers from one request. The user should not need to issue a separate prompt for each provider.

## Check the current host first

Inspect the tools exposed in this conversation before asking for basket details or promising a comparison. Prefer authorized Uber Eats and DoorDash tools when they expose account-specific final checkouts. In ChatGPT Work on mobile, use the host's cloud browser if it is actually available; use its secure sign-in form or takeover flow. Do not require a connected Mac, a Chrome extension, the Switchboard dashboard or developer mode for the phone workflow. Ordinary Chat needs capable provider tools or an available interactive browser; installing a skill does not provide either.

The comparison MCP is optional in this package. If `compare_food_quotes` or the compatible prepare/finish pair is available, use it as described below. If it is absent, read [comparison without MCP](references/without-mcp.md) and use that evidence-based table workflow. Do not pretend the server validated it or an MCP card rendered. Do not try to fetch or install a desktop-only MCP dependency, send checkout data through shell commands, or activate arbitrary apps to work around the host. If provider tools can be discovered through the host, inspect their actual schemas; a provider's name in the directory does not prove checkout access. If no usable source is available, explain the missing capability once and stop.

## Resolve the basket

Use the conversation for the delivery address, restaurant, items, quantities, modifiers, notes, tip and preference for cheapest or quickest. Ask once for missing details that materially affect the comparison, particularly the tip; never silently choose a tip. Use standard delivery on both sides.

Check which provider tools and browser are actually available. Prefer an authorized provider tool if it exposes the required account-specific final checkout data; a listing, menu price or deep link is insufficient. Otherwise use the host's browser in its existing signed-in sessions. This MCP cannot start a browser, invoke another plugin itself, copy cookies, link accounts or supply credentials. If neither source is available, explain the missing capability immediately.

Resolve the same physical restaurant branch offered on both platforms, including its full street address. Do not compare different branches, similar menu items, pickup versus delivery, or express versus standard delivery. Item descriptions can be normalized for capitalization and punctuation, but quantities, selections, notes and contents must match exactly. If the same basket cannot be represented on both platforms, report that restriction instead of substituting it. Do not promise discovery of every restaurant.

## Keep the workflow quick

Reuse relevant addresses, basket details and signed-in sessions from the conversation. Ask for missing details together once. Go directly to each provider's matching branch and checkout; avoid exploring menus unrelated to the requested basket. Use targeted browser snapshots or provider tools that collect several displayed fields together rather than separate tool calls for every label. Where the host permits safe concurrent work in independent tabs, collect the two provider checkouts concurrently; never overlap writes to the same cart. Do not repeatedly check an unavailable source or recheck valid fresh observations just to fill optional fees. Stop after one targeted retry for a repeated rejection. Do not claim this makes provider browsing instantaneous.

If the user asks for an unspecified meal within a budget or deadline, resolve a specific basket before using this comparator. Meal discovery is not implemented. Never pretend an exact-basket comparison searched all restaurants or promotions.

## Sign in and gather both checkouts

Reuse the host's existing authorized sessions. If login or verification is necessary, open the official provider page through the available host browser and let the user complete it. Never ask for passwords or verification codes in chat, take credentials through Switchboard, or claim that one login is permanent. Do not bypass provider challenges. Ask only when sign-in, a cart conflict or a missing selection requires user action; routine navigation and reading quotes need no extra conversational confirmation.

Preserve unrelated existing carts. Do not clear or replace them without the user's specific agreement. Preparing this requested comparison can involve adding the requested items or changing the common tip in its own basket. Stop at the final review screen: never place an order, pay, change payment details or activate a subscription. Follow the host's required approvals.

Collect both checkouts first. When the MCP tool is available, call `compare_food_quotes` ONCE with `request` and `observations`. No preparation call is needed. The request contains `address`, `restaurant`, `restaurantAddress`, `items`, `tipCents`, `deliverySpeed: "standard"`, both providers and `priority: "cheapest"` or `"quickest"`. Items contain `name`, `quantity`, `notes` and `modifiers` with `group` and `option`. Fresh matching observations from this conversation can be reused if they are less than 15 minutes old. Preserve their actual capture times; never give old observations a new timestamp. If only the compatible `prepare_food_comparison` and `finish_food_comparison` tools are available, use them with the returned comparison ID. If neither flow is exposed, use the referenced no-MCP workflow.

Gather fresh, independently observed checkout details on BOTH platforms:

- Exact displayed delivery address, restaurant name, branch address, every item and selection, standard delivery and the common tip.
- Final checkout total INCLUDING that tip. Record `totalCents`, `totalIncludesTip: true`, and the actual total label and amount in `totalEvidence`. DoorDash can show this on a button such as `Place Order $15.75` on its checkout page: READ the button amount, NEVER click it. Keep before-tip and final amounts clearly separate, for example `Total before tip $14.70; Place Order $15.75`. A subtotal, before-tip total or menu price is not a final quote. Do not rewrite a real button label to pretend the page displayed a different label.
- Subtotal, tax, delivery fee, service fee, other fees and applied discount in integer cents. Use `null` for fields that cannot be observed. Use zero only when the checkout establishes there is no such charge or discount. Include only benefits actually applied to this user's basket; do not infer membership or apply hypothetical promotions.
- Displayed delivery window, its text evidence and both bounds in minutes from capture time. For a clock-time estimate, convert using the provider's local time and capture time. Use `null` for both bounds if unavailable. Do not turn an overlapping window into a guaranteed faster option.
- Clean official HTTPS quote URL with queries/fragments removed, current ISO UTC `capturedAt`, source `connected_tool` or `provider_page`, and concise non-sensitive evidence of the displayed fields. Never include passwords, codes, cookies, payment details or authentication URLs.

For `currencyContext`, choose one supported form backed by what the provider actually displayed:

- `{"kind":"explicit_currency","evidence":"<displayed USD or US$ text>"}`.
- `{"kind":"us_addresses"}` only if BOTH observed branch and delivery addresses include a U.S. state and ZIP.
- `{"kind":"us_checkout","countryCode":"US","countryEvidence":"<displayed United States/USA or country: US context>","priceEvidence":"<displayed dollar pricing>"}` when BOTH observed addresses include their U.S. state but a ZIP is omitted. Country must come from the provider checkout/page or connected-tool response, not the user's request, hostname or model assumption.

A bare `$` is not sufficient evidence of USD. Do not invent a currency label or append an unobserved ZIP to pass validation.

When using the MCP, submit the exact request and both provider results in ONE `compare_food_quotes` call. Each observed result uses `status: "observed"` and all required checkout fields. If a provider is blocked, has no matching basket or cannot expose the checkout, submit `status: "unavailable"` with the concrete reason instead. If validation rejects a recoverable observation, collect the actual missing field and retry; never rewrite evidence to disguise the rejection. Make one targeted correction attempt for the same rejection. If it still fails, stop repeating the call, report the precise blocker, and distinguish a directly observed amount from an accepted Switchboard quote. Do not silently override the returned ranking.

## Present the useful comparison

Show a compact table for BOTH Uber Eats and DoorDash: final total including tip, standard delivery window, applied benefits and status. Give the fee and discount breakdown, capture time, cheapest total, dollar difference and delivery tradeoff. When using the MCP, follow the returned `recommendation` for the user's priority. Otherwise follow the referenced comparison rules. If totals tie, say so. If delivery windows overlap or are unknown, say there is no clear fastest option. If only one quote is valid, show it as an available option and explain the other provider's blocker; do not declare a cross-provider winner.

Explain limitations briefly: these are agent-reported observations checked for consistency, not independent source verification, and live prices can change. Nothing has been ordered. On MCP Apps hosts, the final comparison tool returns a responsive card with totals, delivery windows, applied savings and expandable fees. If a card renders, add only a short recommendation and relevant blocker in chat; do not repeat the entire breakdown. Hosts without UI receive the same structured comparison and should show the compact table. Changing the card sort is local and does not recheck prices. Quote freshness still matters.
