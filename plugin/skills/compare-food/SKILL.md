---
name: compare-food
description: Compare the same food basket on Uber Eats and DoorDash using authorized provider tools or the host browser, then validate final checkout totals and delivery windows with Switchboard.
---

# Compare Uber Eats and DoorDash

Use this workflow when the user asks Switchboard to compare a meal, food order, delivery cost or delivery time. Handle BOTH providers from one request. The user should not need to issue a separate prompt for each provider.

## Resolve the basket

Use the conversation for the delivery address, restaurant, items, quantities, modifiers, notes, tip and preference for cheapest or quickest. Ask once for missing details that materially affect the comparison, particularly the tip; never silently choose a tip. Use standard delivery on both sides.

Check which provider tools and browser are actually available. Prefer an authorized provider tool if it exposes the required account-specific final checkout data; a listing, menu price or deep link is insufficient. Otherwise use the host's browser in its existing signed-in sessions. This MCP cannot start a browser, invoke another plugin itself, copy cookies, link accounts or supply credentials. If neither source is available, explain the missing capability immediately.

Resolve the same physical restaurant branch offered on both platforms, including its full street address. Do not compare different branches, similar menu items, pickup versus delivery, or express versus standard delivery. Item descriptions can be normalized for capitalization and punctuation, but quantities, selections, notes and contents must match exactly. If the same basket cannot be represented on both platforms, report that restriction instead of substituting it. Do not promise discovery of every restaurant.

## Sign in and gather both checkouts

Reuse the host's existing authorized sessions. If login or verification is necessary, open the official provider page through the available host browser and let the user complete it. Never ask for passwords or verification codes in chat, take credentials through Switchboard, or claim that one login is permanent. Do not bypass provider challenges. Ask only when sign-in, a cart conflict or a missing selection requires user action; routine navigation and reading quotes need no extra conversational confirmation.

Preserve unrelated existing carts. Do not clear or replace them without the user's specific agreement. Preparing this requested comparison can involve adding the requested items or changing the common tip in its own basket. Stop at the final review screen: never place an order, pay, change payment details or activate a subscription. Follow the host's required approvals.

Once branch, basket and sign-in are resolved, call `prepare_food_comparison` with `address`, `restaurant`, `restaurantAddress`, `items`, `tipCents`, `deliverySpeed: "standard"`, both providers and `priority: "cheapest"` or `"quickest"`. Items contain `name`, `quantity`, `notes` and `modifiers` with `group` and `option`. The returned encrypted comparison token expires after 15 minutes and after a server restart; prepare again if needed.

Gather fresh, independently observed checkout details on BOTH platforms:

- Exact displayed delivery address, restaurant name, branch address, every item and selection, standard delivery and the common tip.
- Final checkout total INCLUDING that tip. Record `totalCents`, `totalIncludesTip: true`, and the actual total label and amount in `totalEvidence`. A subtotal or menu price is not a final quote.
- Subtotal, tax, delivery fee, service fee, other fees and applied discount in integer cents. Use `null` for fields that cannot be observed. Use zero only when the checkout establishes there is no such charge or discount. Include only benefits actually applied to this user's basket; do not infer membership or apply hypothetical promotions.
- Displayed delivery window, its text evidence and both bounds in minutes from capture time. For a clock-time estimate, convert using the provider's local time and capture time. Use `null` for both bounds if unavailable. Do not turn an overlapping window into a guaranteed faster option.
- Clean official HTTPS quote URL with queries/fragments removed, current ISO UTC `capturedAt`, source `connected_tool` or `provider_page`, and concise non-sensitive evidence of the displayed fields. Never include passwords, codes, cookies, payment details or authentication URLs.

For `currencyContext`, choose one supported form backed by what the provider actually displayed:

- `{"kind":"explicit_currency","evidence":"<displayed USD or US$ text>"}`.
- `{"kind":"us_addresses"}` only if BOTH observed branch and delivery addresses include a U.S. state and ZIP.
- `{"kind":"us_checkout","countryCode":"US","countryEvidence":"<displayed United States/USA or country: US context>","priceEvidence":"<displayed dollar pricing>"}` when BOTH observed addresses include their U.S. state but a ZIP is omitted. Country must come from the provider checkout/page or connected-tool response, not the user's request, hostname or model assumption.

A bare `$` is not sufficient evidence of USD. Do not invent a currency label or append an unobserved ZIP to pass validation.

Submit both provider results in ONE `finish_food_comparison` call. Each observed result uses `status: "observed"` and all required checkout fields. If a provider is blocked, has no matching basket or cannot expose the checkout, submit `status: "unavailable"` with the concrete reason instead. If validation rejects a recoverable observation, collect the actual missing field and retry; never rewrite evidence to disguise the rejection.

## Present the useful comparison

Show a compact table for BOTH Uber Eats and DoorDash: final total including tip, standard delivery window, applied benefits and status. Give the fee and discount breakdown, capture time, cheapest total, dollar difference and delivery tradeoff. Follow the returned `recommendation` for the user's priority. If totals tie, say so. If delivery windows overlap or are unknown, say there is no clear fastest option. If only one quote is valid, show it as an available option and explain the other provider's blocker; do not declare a cross-provider winner.

Explain limitations briefly: these are agent-reported observations checked for consistency, not independent source verification, and live prices can change. Nothing has been ordered. A custom card UI is optional and is not part of this version.
