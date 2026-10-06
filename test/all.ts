// Run in one process on supported Node versions without shell-specific globbing.
await import('./core.test.js');
await import('./browser-routing.test.js');
await import('./server-access.test.js');
await import('./eats.test.js');
await import('./rides.test.js');

await import('./verification.test.js');
await import('./ride-flow.test.js');
await import('./eat-flow.test.js');

await import('./addresses.test.js');
