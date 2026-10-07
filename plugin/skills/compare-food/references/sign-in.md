# Provider sign-in playbook

Read this before opening any sign-in or verification flow for a food comparison. Use only capabilities actually available in the current host and their current documentation. These are workflow instructions, not a provider API, an implemented sign-in adapter or a guarantee that authentication succeeds.

## Start with the right browser and a short request

Keep one independent provider tab/session for Uber Eats and one for DoorDash. Reuse the host's authorized provider connection or its existing browser session. A local Chrome session, a phone's provider app and ChatGPT Work's cloud browser are separate sessions; do not export credentials or cookies to connect them. Open the official provider homepage or a previously validated provider page. Check the current rendered state before navigating or requesting sign-in.

An open page, a browser-auth `submitted` result, account recognition, a masked account label or a welcome-back screen is not proof of sign-in. Confirm that the flow has returned to the provider and that a signed-in account control or an account-requiring page is usable. Checkout readiness is a separate check: the correct branch, address, basket and final total must still be observed.

If signed out, say once: “Uber Eats needs a sign-in in this browser. Complete the secure sign-in panel; I'll resume when it finishes.” Use the corresponding provider name. Do not ask the user to send passwords or codes in chat. Do not require an additional “done” message if the host already signals completion and the provider page confirms it.

## Let the user choose their existing method

Read the host's secure authentication capability documentation once. Inspect only visible field labels, roles, types and autocomplete metadata needed to describe the current form; never read field values, cookies, local storage, passwords or verification codes. Use current tab/element handles, not saved numeric click IDs from another snapshot.

Offer the provider's visible existing-account methods through the host's secure sign-in UI. Preserve a method the user has already selected; do not select Google, Apple, email, SMS or WhatsApp just because it looks convenient. Account recognition may require a different second step; let the user choose the visible method there. Do not create a new account, reset a password, alter account recovery or use another person's identity as a fallback.

Use the host's documented secure form for supported fields. Verify the form's identity and current field mapping immediately before requesting submission. A social-login choice may open a popup: locate that popup, inspect its origin and rendered status, and preserve it for user handoff if needed. Do not assume the original tab contains the entire flow. Full OAuth/session URLs stay out of chat, evidence and logs.

For a multi-field verification code, use a documented secure capability that supports that layout. Never obtain the code from a snapshot or chat and fill it with ordinary browser automation. If the secure bridge cannot handle the page, use the host's supported “Sign in on web page” or manual takeover flow instead. Do not guess selectors, split a code yourself, or keep submitting an unchanged field mapping. Hand off only the relevant provider tab and any popup involved in its chosen sign-in flow, not unrelated provider tabs. Follow the host's documented handoff API; do not invent one.

If a user sends a code in chat, do not repeat or transfer it into the page. Direct them to enter it in the secure form or manual sign-in page. Do not claim the code was wrong or expired without a specific provider message.

## Observe the result and use a bounded recovery

After each secure submission or takeover completion, inspect the actual current page once. If loading, wait using the host's documented page-state tools and inspect once more; do not repeatedly reload or reopen login. If a non-sensitive inactivity modal obscures the flow, dismiss it with its visible continue control and inspect the form/error again before any further authentication request. Do not submit stale handles underneath a modal.

Distinguish these outcomes:

| Observation | Required action |
| --- | --- |
| `submitted` but the form remains | Inspect the page or popup; continue only from the observed next stage. Do not mark signed in. |
| `declined`, cancelled or skipped | Respect the dismissal. Stop this provider's sign-in; do not reopen it unless the user explicitly asks. Continue the other provider where allowed. |
| `submission_failed` | Report a secure-form submission failure, not a rejected credential. Inspect once for a changed form, popup, modal or provider error. Prefer documented manual takeover. |
| Popup/page `502`, connection refused or other network failure | Report the connection failure. Do not call it a CAPTCHA, invalid password or bot block. Do not resubmit credentials to the same failed route. Another visible method needs user selection. |
| Explicit provider invalid/expired-code message | Convey that message without exposing the code. Let the user obtain/enter a replacement through the secure flow; never automatically resend codes or switch channels. |
| Generic “try another login method” error | Do not guess the cause. Stop that route and offer the visible methods or documented manual takeover. |
| Challenge/access-denied page | Report the observed block and offer supported user takeover if available. No stealth, proxy rotation, challenge bypass or cookie transfer. |
| Return to a usable signed-in provider page | Resume the requested basket automatically under existing permissions; do not ask routine navigation confirmations. |

Allow at most one targeted recovery from a failed secure submission per provider in a comparison, and only when the page reveals a concrete fix. Normal successful identifier → method → verification stages are not retries. A user cancellation ends automatic recovery immediately. A recovery may clear a non-sensitive modal or use newly observed supported field metadata; it must not guess credentials or repeat the same failed request. If that recovery fails, stop automated authentication for that provider and leave a precise manual next action. A later explicit request to resume starts from a fresh page observation; never treat retained JS variables as proof that a session is still usable.

Avoid conversational questions for routine navigation. User interaction remains necessary to choose an account/method, submit secure credentials, resolve an existing-cart conflict, or satisfy the host's approvals. Do not promise these confirmations can always be removed.

## Keep providers independent

Uber sign-in failure must not end DoorDash's attempt. Record Uber's concrete blocker, preserve its page, and continue DoorDash under the same comparison request. A separate prompt or permission to “try DoorDash” is unnecessary for ordinary navigation already within that request; use DoorDash's secure sign-in prompt when its account authorization is needed. Apply the same rule in reverse. Never overlap two secure sign-in prompts; handle user authentication sequentially while using independent tabs. Respect an explicit instruction to stop all work.

After both attempts, report each provider's actual state: quote collected, sign-in required, user skipped, submission failed or observed provider/network block. “Homepage opened” and “not attempted” are distinct from failed login. One completed provider cannot establish cheapest or fastest across providers. Keep authentication details out of the comparison evidence.

Source for host sign-in/takeover behavior: [OpenAI cloud browser guide](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt). Exact APIs and supported controls must be read from the active host.
