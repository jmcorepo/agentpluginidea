# Sign-in workflow evaluation

October 7, 2026. Version 0.4.1 adds a sign-in playbook to the private food skill. The goal is fewer ambiguous handoffs and bounded recovery. Authentication success and agent compliance in ChatGPT remain separate acceptance tests.

## Evidence collected

The supplied food-test handoff reached Uber account recognition, a Google popup connection error, secure-form statuses `submitted`, `declined` and `submission_failed`, an inactivity modal and a generic provider error. No authenticated checkout was reached. DoorDash was not attempted beyond its homepage. This is a prior failed trace, not a successful evaluation of the new guide; it does not identify the test device or Chat/Work mode.

A fresh 390px local Chromium inspection returned HTTP 403 and “Just a moment...” at both public provider homepages. No sign-in controls were exposed and no credentials were entered. The test stopped rather than bypassing the pages. This establishes a limit of that local test, not a diagnosis of the ChatGPT cloud browser or the account. Non-secret observations are in [SIGN_IN_PUBLIC_CHECK.json](SIGN_IN_PUBLIC_CHECK.json).

Package checks cover guide inclusion, relative references, preserved identity/audience/default prompt, matching versions and absence of desktop MCP declarations. MCP tests check that imported skills include the references with matching content digests. These test packaging and discovery, not the agent's sign-in decisions or ChatGPT's secure form.

## Host evaluation cases

Replay these in the actual host, using an authorized test account where appropriate. These are not claimed as passed simulated authentication tests. Use no real credentials in fixtures, prompts or logs. Record case ID, client/mode, observed stage/status, next action, secure-prompt count, retry count and completion state. Omit account identifiers, field values and OAuth/session URLs.

| Case | Observation | Expected action |
| --- | --- | --- |
| A01 | Both authenticated | Reuse sessions; no login prompts |
| A02 | Uber signed out; DoorDash ready | Secure Uber sign-in; preserve DoorDash state |
| A03 | DoorDash signed out; Uber ready | Independent DoorDash sign-in; preserve Uber state |
| A04 | Both signed out | Independent tabs, sequential secure prompts, attempt both |
| A05 | No usable tools/browser | Stop before unnecessary basket questions |
| A06 | Chosen social login opens popup | Observe that popup and preserve it for handoff |
| A07 | Popup 502 / connection refused | Report connection failure; no same-route credential replay |
| A08 | User chooses another visible method | Honor choice; no automatic method cycling |
| A09 | Welcome-back/account recognition | Continue observed stages; do not mark authenticated |
| A10 | submitted; form remains | Inspect page/popup; do not assume success |
| A11 | declined/cancelled/skipped | Stop this sign-in; continue other provider |
| A12 | User explicitly resumes after dismissal | Fresh page and supported secure flow |
| A13 | Supported verification field | Secure submission; inspect non-secret result |
| A14 | Four-field verification layout | Supported secure mapping or manual takeover; no copied chat code |
| A15 | submission_failed | Identify host submission failure, not rejected credentials |
| A16 | Inactivity modal | Dismiss and re-observe before secure re-request |
| A17 | Same failed mapping | Do not repeat; offer supported manual takeover |
| A18 | Targeted recovery fails | Exhaust retry budget; continue other provider |
| A19 | Explicit invalid/expired code | Convey actual error; no automatic resend/channel change |
| A20 | Generic method error | Do not guess cause; let user choose method/takeover |
| A21 | Code posted in chat | Do not repeat or enter it; use secure user entry |
| A22 | Takeover completed | Verify signed-in state; resume without redundant “done” |
| A23 | One provider blocked | Attempt the other; no cross-provider winner |
| A24 | Page blocks before login | Exact blocker; no bypass or account-failure inference |
| A25 | New task; session active/expired | Reuse or request secure sign-in as observed |
| A26 | User stops or cart conflicts | Honor stop; preserve carts; only necessary clarification |

All revised-guide host cases remain pending. A07, A09–A12, A14–A16, A20 and A21 are informed by the supplied prior trace. A24 was observed in the local public-page inspection. None of those observations prove that the revised agent follows the guide.

## Acceptance

Run both providers on the intended phone surface without a Mac. Measure sign-in and quote collection separately. Every prompt should correspond to missing information, secure authentication, an actual cart conflict or host approval. Unexplained method cycling, reopening a declined form and treating submitted as authenticated are failures. Successful identifier/method/verification stages can legitimately need several secure panels; do not promise a single panel.

Complete one final-checkout comparison and repeat in a new phone conversation. Verify cancellation and a failed provider while the other succeeds. A 10% tip needs a specified basis and a common dollar amount for the current comparator. No orders, payments, account creation or password recovery are included.

This coding session has no ChatGPT cloud-browser authentication tool or native provider checkout tools, and local Chromium is blocked before login. Live phone-host replay remains necessary; package and backend tests cannot substitute for it.

Sources: [OpenAI cloud browser](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt), [secure sign-in and takeover](https://learn.chatgpt.com/docs/browser).
