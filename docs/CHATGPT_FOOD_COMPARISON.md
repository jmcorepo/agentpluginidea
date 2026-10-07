# Test food comparisons in ChatGPT

The private Switchboard plugin version 0.3.0 provides `compare-food`, the preferred one-call `compare_food_quotes`, and the compatible `prepare_food_comparison` / `finish_food_comparison` flow at the existing HTTPS `/mcp` endpoint. It retains the ride skill and tools. No new hosting or provider credentials are required by the MCP.

Open the existing Switchboard plugin, refresh/update it if the client shows an older release, and start a new conversation on a surface with authorized provider tools or an interactive browser. Use one request:

> @Switchboard Compare Uber Eats and DoorDash for delivery to [full address]. I want [restaurant], [items and quantities], [modifiers/notes], with a $[amount] tip and standard delivery. Tell me the final total on each, the delivery windows, which is cheapest and whether paying more is faster. Do not place an order.

Choose a restaurant branch and identical basket available on both platforms. The host resolves the exact branch address before starting the comparison. Sign in to official provider pages only if requested; the sessions belong to the host browser. Switchboard does not collect credentials or guarantee sessions never expire. A native provider app is useful only if its available tools expose the required final checkout information. The plugin cannot activate arbitrary apps or make a browser available on a ChatGPT surface that lacks one; mobile compatibility remains to be tested on the actual client.

Expected flow: resolve missing basket details once → collect both provider checkouts without submitting orders → call `compare_food_quotes` once → comparison card with both totals, fees, applied discounts, delivery windows and price/time tradeoffs. Hosts without MCP Apps UI still receive structured data for a table. Only final comparison tools declare the UI resource; preparation never mounts a card. This saves one MCP round trip, not the provider checkout navigation. Client sorting and expanding fees make no tool calls. Existing unrelated carts must be preserved. Unsupported or blocked providers appear with their reason; one quote alone is not declared the winner.

Totals include the same tip. Missing fee details remain unknown. Currency requires an explicit USD/US$ label, both observed U.S. addresses with state and ZIP, or observed provider U.S. country context plus state-bearing addresses and dollar pricing. The host must not invent missing currency evidence. Overlapping delivery windows have no clear fastest provider.

DoorDash's final `Place Order` button amount is accepted as total evidence on its checkout page. Read it without clicking. Before-tip figures and conflicting final totals remain invalid. Fresh matching observations may be collected before the comparison plan; the 15-minute quote-age and plan-expiry checks apply separately. Preserve actual capture times rather than changing them to avoid rejection. After one targeted correction for the same error, the host reports the blocker instead of repeating failed calls.

Automated checks cover basket equivalence, branches, addresses, tips, currency, total arithmetic, capture time, blocked providers, price ties and delivery window overlap. SDK tests cover tool/skill discovery and prepare/finish calls across separate HTTP requests. These checks and synthetic deployed smoke tests do not prove signed-in provider compatibility. A successful live two-checkout comparison is the remaining acceptance gate. Nothing is ordered by these tools.

## Comparison UI and mobile status

The self-contained MCP Apps resource is `ui://switchboard/food-comparison/v1.html`, with `text/html;profile=mcp-app`, `_meta.ui.resourceUri` and the ChatGPT output-template compatibility alias. It uses the standard initialize/initialized/tool-result bridge, local sort controls, safe text rendering, no external assets or connections, light/dark themes, stale-quote warnings and a single-column layout at phone widths. The anonymous `/comparison-preview?preview=1` route shows clearly labeled synthetic prices only, not live quotes or account data.

A 390px Chromium host-emulation test validates layout and bridge behavior; this is not a test inside the ChatGPT mobile app. The private plugin being installed does not prove that its tools are available to ordinary phone chats. The package currently includes the remote MCP URL, not a registered ChatGPT App mapping. The existing private Site does not advertise MCP either. No replacement plugin, public listing, new hosting or account access has been created to work around this.

As checked October 7, 2026, OpenAI's developer-mode MCP documentation says custom MCP apps are web-only. The documented immediate phone-testing path is Codex/Remote using an awake, connected computer, with that host's plugins, browser and authorized sessions. Native ordinary mobile-chat availability remains blocked pending a supported app connection and verification in the actual client. Do not promise that adding UI or an app mapping alone fixes it.

Sources: [Plugin packaging](https://developers.openai.com/plugins/build/plugins), [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), [custom MCP availability](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), [Remote connections](https://learn.chatgpt.com/docs/remote-connections).

Restaurant discovery for a vague meal request, budget/deadline search, unapplied promotion discovery and purchases remain outside this comparator. Applied discounts are shown once, already included in final totals. Overlapping delivery windows have no fastest winner.
