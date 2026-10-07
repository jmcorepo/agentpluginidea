# Switchboard's ChatGPT direction

The desired product is one delivery request in the ChatGPT phone app, a brief
setup when needed, and one comparison of Uber Eats and DoorDash without a
connected Mac. Version 0.4.0 is a skill package without bundled desktop MCP
configuration; it uses actually available provider tools or the host browser.
ChatGPT Work's cloud browser is a documented mobile candidate, subject to plan
and rollout, distinct from ordinary Chat. See [the mobile acceptance gates](CHATGPT_MOBILE.md).
The optional comparison backend validates exact food and standard ride quotes
and returns food cards on compatible MCP Apps hosts. Without that connection,
the skill presents host-observed comparisons without server validation.
Native provider-app capabilities, phone eligibility and signed-in cloud-browser
provider compatibility still need testing. Per-user preferences, meal discovery,
onboarding panels and purchasing remain future scope.

## Recommended architecture

1. A plugin skill guides ChatGPT through the complete comparison from one request.
2. Prefer the user's authorized native provider tools when they expose the data
   needed for an equivalent route or basket. Discover and test their actual
   capabilities first. A directory listing does not establish quote access.
3. Use the host's signed-in browser only where available and needed. Provider
   challenges, session expiry and missing browser support remain possible.
4. Switchboard's MCP normalizes and ranks supported evidence, identifying missing
   data instead of manufacturing prices or declaring an incomplete winner.
5. Add native MCP App UI for the result, with Extensions for setup, settings and
   a conversation panel. The website should be optional for routine comparison.
6. Before storing personal preferences, use authenticated, user-scoped identity.
   Switchboard authentication and provider authorization are separate. A provider
   connection belongs to the host/provider; Switchboard cannot inherit its tokens.

ChatGPT orchestrates available tools under the user's permissions. Switchboard
does not call another plugin's private backend or command the host browser from
the server. A skill can guide this workflow but does not guarantee tool access,
automatic activation, instant results, or permanent provider sessions.

## Hosting

Render was selected for the original persistent Node/Chromium browser runtime.
That runtime uses a disk for browser sessions; the comparison MCP does not use
those sessions. The calculation-only MCP can be hosted separately on a suitable
HTTP platform, including Vercel, or continue on the existing Render service.
Changing hosting is not a remedy for missing provider capability or ChatGPT
installation compatibility. Do not buy another service to validate this design.

## Next acceptance tests

- Install the saved private Switchboard plugin and discover both live MCP tools.
- Inspect native Uber, Lyft and food-provider tools in a ChatGPT surface where
  they are available, without placing an order. Record which return full route
  or basket context, final total, applied benefits, timing and source evidence.
- Test one complete two-provider comparison on mobile and repeat in a new chat.
- Verify expired login, blocked provider, missing fees/timing and mismatched
  basket handling before claiming seamless or complete comparisons.
- Select the first supported provider pair from those results, then implement
  its adapter and native setup/result UI.

## Reviewed sources

- [Plugins in ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- [Plugin skills](https://developers.openai.com/plugins/concepts/skills)
- [Extensions](https://developers.openai.com/plugins/build/extensions)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Packaging](https://developers.openai.com/plugins/build/plugins)
- [Connection tests](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [TechCrunch announcement](https://techcrunch.com/2026/09/29/openai-expands-chatgpts-plugins-with-app-like-interfaces-and-automations/)

Native provider listings were reported by John. Provider tool schemas and
quote behavior have not been verified in this execution environment, where
those provider tools are not currently exposed.
