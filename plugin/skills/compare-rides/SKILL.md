---
name: compare-rides
description: Compare Uber and Lyft prices and pickup or arrival times for a user's route through Switchboard, collecting live quotes with the host browser.
---

When the user asks for the cheapest or quickest ride, execute the complete workflow from one request. Do not require them to request each provider separately.

1. Resolve the pickup, destination, passenger count and whether quickest means pickup or arrival. Use explicit user context; ask one concise question for missing or ambiguous locations. Do not assume access to phone GPS. This first prototype supports USD standard non-shared UberX and Lyft rides for up to four passengers.
2. Call `prepare_ride_comparison` with both providers. Keep its comparison ID for the final call.
3. Use the host's available interactive browser to visit each planned provider. This requires browser capability on the current ChatGPT surface; the MCP does not supply it. If unavailable, stop and explain the requirement. Do not treat search snippets as live quotes.
4. If sign-in is needed, use the host's secure user sign-in or browser takeover flow. Never request passwords or verification codes in chat or send them to Switchboard. Saved login belongs to the host browser. Do not promise permanent sessions or mark accounts linked merely because a page opened. Follow host confirmation requirements for challenges and permissions; never bypass a blocked page.
5. Prepare the same route for every provider. Independently observe both displayed addresses, standard category, capacity, non-shared status, USD currency, final displayed price, pickup wait, and trip duration if shown. Record only benefits explicitly applied on the page. Do not manufacture observations by copying requested addresses. Keep unavailable timing fields null. Never book or pay.
6. Collect every provider before finishing, respecting host browsing limits. For a blocked provider, submit `unavailable` with a precise reason. Collect fresh observations within the plan's five-minute lifetime. Use clean source URLs without query strings, fragments or credentials. Evidence should quote only relevant visible route, category, price and time text, without account identifiers.
7. Call `finish_ride_comparison`. If rejected for stale or mismatched evidence, obtain fresh matching evidence or report the failure. Do not relabel rejected quotes as verified.
8. Present one concise table with provider, price, pickup wait, arrival estimate and source/capture time. State cheapest, fastest pickup and fastest arrival only when the returned data supports them. Identify ties; distinguish incomplete comparisons. Clearly describe quotes as agent-observed, not independently authenticated by Switchboard. Do not imply an order or ride was placed.

The user should interact only for missing trip details, first sign-in, expired sessions, or required approvals. This skill guides tool use; it cannot force the host to provide a browser or activate on every request.
