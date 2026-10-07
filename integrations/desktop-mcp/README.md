# Optional desktop MCP connection

The old bundled HTTPS connection is retained here for desktop MCP clients and backend development. This folder is outside the mobile plugin package. Do not copy its `mcp.json` into `plugin/`: OpenAI documents bundled MCP declarations as a source of desktop-only classification for imported plugins, including remote HTTPS servers.

The Render server remains at `https://agent-commerce-browser.onrender.com/mcp`. A future cross-surface package must reference a real registered ChatGPT App using `.app.json` and verify its availability on the intended client. The remote URL alone is not such a mapping. See [the mobile acceptance gates](../../docs/CHATGPT_MOBILE.md).
