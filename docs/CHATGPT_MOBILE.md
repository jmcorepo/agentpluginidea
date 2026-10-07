# Switchboard on ChatGPT mobile

Reviewed October 7, 2026. The acceptance target is a request in the ChatGPT phone app with no connected Mac. A desktop comparison, a responsive preview or a successful HTTPS MCP test does not establish mobile support.

## Documented execution paths

OpenAI documents plugins in Chat and Work on mobile, subject to capability and account availability. Its separate developer-mode custom MCP documentation says those connections are web-only. The plugin-management guide also states that imported packages declaring `mcp.json` or `.mcp.json` are Desktop only, including remote HTTPS servers. These are distinct restrictions; the provider's name being listed or a plugin being installed is insufficient evidence of availability in a conversation.

OpenAI now documents ChatGPT Work's cloud browser on mobile, including authenticated websites on Plus/Pro subject to rollout. The cloud browser can retain its own sign-in sessions for later tasks and offers a secure sign-in form or page takeover. It does not need the user's Mac and does not inherit local browser sessions. This is a candidate for the website-based food workflow; actual Uber Eats and DoorDash challenge handling and layout compatibility still need testing. Ordinary Chat requires capable connected provider tools or another interactive browser actually available to that conversation. Work should not silently be presented as ordinary Chat.

## Implemented package change

Version 0.4.1 keeps the existing private plugin identity and both skills, removes its bundled MCP declarations, and makes the comparison tools optional. No registered App ID is invented. The host checks provider/browser capabilities before collecting request details, uses both providers from one request, and can produce an evidence-based comparison table without MCP. That fallback has no server validation or custom comparison card. Missing providers and missing host capabilities remain explicit blockers.

The food skill now includes a [guided sign-in playbook and evaluation cases](SIGN_IN_TESTS.md); actual secure host sign-in still needs replay.

The Render comparison MCP and card source remain available for compatible hosts and future registered App integration. Removing the desktop package declaration does not shut down or change the existing runtime. A registered app can be referenced using `.app.json` only after obtaining the real App ID and verifying its availability on the intended phone surface. Connecting a developer-mode app or publishing a listing alone does not prove ordinary Chat support. Public submission, identity verification and review remain separate steps.

## Next proof, before more product features

1. Refresh the same private Switchboard plugin and start a new phone conversation. Record client version, plan, Chat/Work mode and whether Switchboard appears in the composer and its skill loads. The packaging change is a test candidate, not a verified picker fix.
2. Inspect actual provider tool schemas if available. Confirm whether they return account-specific final totals including the common tip, exact branch/basket/address, applied discounts, delivery windows and source evidence. A menu search or checkout deep link does not satisfy the comparison.
3. If Work cloud browsing is accepted and available, perform secure provider sign-in in that cloud browser. Never ask for credentials in chat, export cookies or rely on local Chrome. Compare one identical standard-delivery basket on both providers without submitting either order.
4. Repeat in a new phone conversation with the Mac offline. Confirm the host's own sessions are reused or sign-in is correctly requested when expired. This is the required independence test.
5. Record collection latency separately from calculation and card rendering. Verify both providers start promptly, no duplicate navigation occurs, and changing only sort/fee questions reuses fresh matching observations.
6. Verify missing-provider, overlapping windows, missing fees, currency ambiguity and unrelated cart cases. No incomplete winner, invented discount or purchase is acceptable.
7. Establish mobile availability for the registered comparison App and actual MCP card before describing custom UI as ready on the phone. Until then, the host-observed table is the usable fallback when collection succeeds.

## Current evidence and blockers

The private plugin previously contained remote MCP declarations and no registered App mapping. That has been inspected in both local source and account source. The existing backend passes synthetic comparison/transport tests and its cards pass a phone-width browser-emulation test; those results remain desktop/backend evidence. This environment has no ChatGPT mobile client, cloud-browser session or callable Uber Eats/DoorDash app tools. Mobile picker eligibility, authenticated two-provider collection, session reuse and actual card rendering have not been demonstrated here. The first phone run is still necessary; do not ask the user to repeat setup without a concrete changed package.

## Sources

- [Plugins on Chat and Work, including mobile](https://learn.chatgpt.com/docs/plugins)
- [Desktop-only MCP declarations and registered App references](https://learn.chatgpt.com/docs/enterprise/plugin-management)
- [ChatGPT Work cloud browser and secure mobile sign-in](https://learn.chatgpt.com/docs/browser)
- [Developer-mode custom MCP availability](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Package and registered App mapping](https://developers.openai.com/plugins/build/plugins)
- [Connection and evaluation workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Submission and publication](https://developers.openai.com/plugins/deploy/submission)
