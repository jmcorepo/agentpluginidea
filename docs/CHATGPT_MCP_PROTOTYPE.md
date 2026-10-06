# Switchboard host-browser prototype

One user request activates `plugin/skills/compare-rides/SKILL.md`. The host calls
`prepare_ride_comparison`, browses Uber and Lyft using its own signed-in sessions,
and calls `finish_ride_comparison` with observed quotes. Switchboard checks the
route, equivalent standard category, capacity, USD currency and timestamps, then
returns rankings. Price, pickup wait and estimated total arrival are separate.

This is an experimental addition to the existing MVP. It does not replace the
Render dashboard or add food comparison, purchasing, portable preferences,
provider OAuth, or automatic access to ChatGPT's browser. The host must actually
provide and choose browser capability. Skill activation and mobile behavior are
not proven by local tests. Provider sessions belong to the host; Switchboard
cannot import them, check their connection status, or guarantee their lifetime.

## Local development

From the repository, run `npm ci`, then `npm run mcp:http`. The endpoint is
`http://127.0.0.1:3037/mcp`. `npm run mcp` provides stdio for local MCP clients.
The `plugin/` directory includes the portable plugin manifest, local HTTP MCP
mapping and browsing skill. It is an authoring package, not an installed or
published ChatGPT plugin. A phone or remote ChatGPT backend cannot reach the
Mac's loopback address. Installing only the MCP does not install the skill.

Use the official MCP Inspector to discover the two tools and exercise a plan
followed by quote submission. Plans expire after five minutes and are returned as encrypted, authenticated
client-held tokens. No trip plan is retained on the server. Process restarts
invalidate tokens. The loopback development endpoint is for one local tester. No provider cookies or
credentials are stored, and observations are not written to history. Plain source
URLs must omit credentials, query parameters and fragments. Avoid account
identifiers in evidence. Server checks establish consistency of agent-supplied
observations, not authenticity of source pages. A model could submit fabricated
but consistent evidence; do not describe this as independent verification.

## Before the phone test

1. The anonymous calculation-only test endpoint is
   `https://agent-commerce-browser.onrender.com/mcp`. It cannot read provider
   sessions, account data or stored comparisons. It does not retain trip plans,
   quotes or history. The input is supplied by the caller; encrypted plan tokens
   prevent request tampering. Saved preferences or account access will require
   authenticated, user-scoped tools before those features are added.
2. Register the custom MCP connection in ChatGPT, then wire the registered
   connection ID into the plugin package and install the comparison skill through
   the supported private testing path. Available installation paths vary by
   ChatGPT surface and account; verify them before promising mobile installation.
3. Start a fresh phone conversation with one explicit route and passenger count.
   Confirm the skill activates, calls prepare, visits BOTH providers, requests
   secure sign-in when needed, and submits actual page observations to finish.
4. Confirm the answer distinguishes price, pickup and arrival times. A blocked
   provider produces an incomplete comparison, never a fabricated winner.
5. Start a new conversation and repeat. Verify host login reuse and one-request
   orchestration. Also test missing browser capability and expired login.

Go/no-go: actual signed-in provider evidence returned through MCP on the phone,
repeated across conversations without asking the user to check each provider.
Do not substitute a local fixture run, web-search result, or Render browser test.

## Sources

- [Plugin skills](https://developers.openai.com/plugins/concepts/skills)
- [MCP server implementation](https://developers.openai.com/plugins/build/mcp-server)
- [Plugin packaging and private testing](https://developers.openai.com/plugins/build/plugins)
- [MCP authentication](https://developers.openai.com/plugins/build/auth)
- [ChatGPT cloud browser and saved sign-ins](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt)

## Connect the hosted test in ChatGPT

After deployment and live MCP validation, open ChatGPT Plugins, choose Add custom
MCP server, use the hosted `/mcp` URL, choose no authentication for these two
calculation-only tools, and Create as a plugin. Complete the account warning
yourself. Open a new Work conversation with the connection enabled and ask:

> Use Switchboard to compare Uber and Lyft for one standard ride from [full pickup]
> to [full destination], one passenger. Prepare the comparison, use your browser
> to collect both live quotes, and submit them to Switchboard. Let me sign in if
> needed. Tell me cheapest, fastest pickup and fastest arrival. Do not book.

This is an explicit first activation test. Generic-question activation, skill
installation and phone availability still require validation. The MCP exposes
`skills/list`, `skills/get` and a hashed SKILL.md resource for the documented
submission-time skill import. A custom MCP registration alone does not guarantee
that the packaged skill is installed. The server also provides initialization
instructions and a plan so an enabled connection can be tested directly.
