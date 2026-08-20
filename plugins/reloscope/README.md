# Reloscope Plugin

Reloscope is an MCP-backed plugin for ChatGPT and Codex. ChatGPT owns the
conversation; Reloscope provides read-only graph tools and an interactive
relationship canvas rendered inside the conversation.

## Local development

Requirements: Node.js 22.13 or newer.

1. Run `npm run plugin:dev` from the repository root.
2. Test `http://localhost:8787/mcp` with MCP Inspector using Streamable HTTP.
3. Expose the endpoint through HTTPS for ChatGPT developer-mode testing.
4. Add the HTTPS URL ending in `/mcp` from the ChatGPT Plugins page.

The first release uses synthetic data and exposes only read operations. Graph
mutation, authentication, and customer workspaces are intentionally out of
scope until the read and evidence flows pass evaluation.

## Tool flow

1. Search for stable entity IDs.
2. Read a neighborhood, relationship path, or evidence record.
3. Render the prepared graph with `render_relationship_graph`.
4. Use selections from the visual canvas as context for the next ChatGPT turn.

The visual resource is `ui://reloscope/graph-v1.html`.
