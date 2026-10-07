# Local MCP test results

Run: 2026-10-06T04:41:48.898Z

Synthetic fixtures only. No live provider prices, logins, or phone/ChatGPT plugin behavior tested.

PASS: MCP connection and tool discovery
PASS: fixture quotes distinguish cheapest, fastest pickup and fastest arrival
PASS: mismatched routes cannot produce a winner
PASS: blocked provider yields an incomplete comparison
PASS: invalid tool arguments rejected
PASS: cross-origin access rejected

TypeScript check, build and four focused regression tests also passed.
