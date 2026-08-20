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

The plugin includes a synthetic reference graph plus a bounded, stateless tool
for visualizing structured relationship data supplied from the current ChatGPT
conversation. Graph mutation, file ingestion, authentication, persistence, and
customer workspaces remain out of scope until the read and evidence flows pass
evaluation.

## Tool flow

1. Search for stable entity IDs.
2. Read a neighborhood, relationship path, or evidence record.
3. Render the prepared graph with `render_relationship_graph`.
4. Use selections from the visual canvas as context for the next ChatGPT turn.

For user-supplied data, ChatGPT can instead call
`visualize_relationship_graph` with stable entity, relationship, and evidence
IDs. The tool accepts at most 100 entities, 150 relationships, and 150 evidence
records, replaces the current visual, and never stores the supplied graph.

The visual resource is `ui://reloscope/graph-v1.html`.
