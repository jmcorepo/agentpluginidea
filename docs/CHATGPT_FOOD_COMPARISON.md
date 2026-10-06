# Test food comparisons in ChatGPT

The private Switchboard plugin version 0.2.0 adds `compare-food`, `prepare_food_comparison` and `finish_food_comparison` at the existing HTTPS `/mcp` endpoint. It retains the ride skill and tools. No new hosting or provider credentials are required by the MCP.

Open the existing Switchboard plugin, refresh/update it if the client shows an older release, and start a new conversation on a surface with authorized provider tools or an interactive browser. Use one request:

> @Switchboard Compare Uber Eats and DoorDash for delivery to [full address]. I want [restaurant], [items and quantities], [modifiers/notes], with a $[amount] tip and standard delivery. Tell me the final total on each, the delivery windows, which is cheapest and whether paying more is faster. Do not place an order.

Choose a restaurant branch and identical basket available on both platforms. The host resolves the exact branch address before starting the comparison. Sign in to official provider pages only if requested; the sessions belong to the host browser. Switchboard does not collect credentials or guarantee sessions never expire. A native provider app is useful only if its available tools expose the required final checkout information. The plugin cannot activate arbitrary apps or make a browser available on a ChatGPT surface that lacks one; mobile compatibility remains to be tested on the actual client.

Expected flow: resolve missing basket details once → prepare food comparison → collect both provider checkouts without submitting orders → finish food comparison → table with both totals, fees, applied discounts, delivery windows and price/time tradeoffs. Existing unrelated carts must be preserved. Unsupported or blocked providers appear with their reason; one quote alone is not declared the winner.

Totals include the same tip. Missing fee details remain unknown. Currency requires an explicit USD/US$ label, both observed U.S. addresses with state and ZIP, or observed provider U.S. country context plus state-bearing addresses and dollar pricing. The host must not invent missing currency evidence. Overlapping delivery windows have no clear fastest provider.

Automated checks cover basket equivalence, branches, addresses, tips, currency, total arithmetic, capture time, blocked providers, price ties and delivery window overlap. SDK tests cover tool/skill discovery and prepare/finish calls across separate HTTP requests. These checks and synthetic deployed smoke tests do not prove signed-in provider compatibility. A successful live two-checkout comparison is the remaining acceptance gate. Nothing is ordered by these tools.
