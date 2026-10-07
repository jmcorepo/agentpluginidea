# Compare provider evidence when the MCP is unavailable

Use this only when the current host exposes usable provider tools or an interactive browser but no Switchboard comparison tools. The skill can guide the host through both providers and present a table; it cannot provide server validation, independently authenticate evidence or render the MCP card. Keep the main skill's account, cart, purchase and evidence rules.

## Check equivalent quotes

Obtain independently displayed delivery and branch addresses, exact items, quantities, modifiers and notes, standard delivery, the common tip, a final total including that tip, observed currency, capture time and an official source on both providers. Do not substitute menu prices, a prepared cart, search snippets, public estimates or a before-tip total. Do not infer missing context from the user's request. For DoorDash, read the final order-button amount without clicking it. Use the main skill's currency-evidence rules; a bare dollar sign is insufficient.

Only compare matching branch, basket, address, speed, tip and currency. Use observations captured less than 15 minutes ago; retain their real timestamps. Mark mismatched, stale or missing final evidence unavailable with a concrete reason. Never fabricate evidence or retry a blocked provider indefinitely. Unknown fees or timing remain unknown. If a mismatch can be resolved by a targeted read, make one correction attempt, then report the blocker.

## Check the numbers

Calculate in integer cents, using a host calculation tool if available. Where all fee components are displayed, confirm:

`subtotal + tax + delivery fee + service fee + other fees - applied discount + tip = final total`

Count each charge once. A discount already included in the final total is not subtracted again. If the displayed breakdown contradicts the final amount, obtain the missing context once or exclude that quote. Missing components do not mean zero; a clearly displayed final total can still be compared when optional breakdown fields are unknown.

With two equivalent final quotes, cheapest is the smaller total. Saving is the larger total minus the smaller total. Equal totals are a tie. With only one supported quote, show it without declaring a cross-provider winner.

Use both displayed delivery-window bounds. Provider A has a clearly earlier window only when A's latest estimate is less than B's earliest estimate. Overlapping, touching or missing windows have no clear fastest option. Convert clock estimates relative to their actual capture time and observed local timezone; do not invent a timezone. Explain these are estimates, not guarantees.

For cheapest priority, recommend the lower final total and explain timing. For quickest priority, recommend an earlier non-overlapping window only when established; otherwise explain that timing cannot distinguish them and identify any supported price saving. Show only discounts actually applied to this basket. Finding unapplied offers or all restaurants is outside this workflow.

## Return one result

Show both providers in a compact table with final total including tip, delivery window, applied savings and status. Add the dollar difference and a brief recommendation. Include capture time and clean official source links. Provide observed fee details when useful. State that the comparison comes from the host's observations and has not passed the Switchboard server validator. Do not claim a quote was independently verified or call this an automatic backend comparison. Nothing has been ordered.

Reuse fresh matching observations for a follow-up about sorting or fees. A changed branch, basket, delivery address, speed or tip needs new checkouts. A future request can reuse the cloud browser's provider sessions if still active, but sessions can expire. Never move credentials or cookies between hosts.
