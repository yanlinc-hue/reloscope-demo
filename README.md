# Reloscope

Reloscope is relationship intelligence for ChatGPT. ChatGPT owns the conversation; Reloscope contributes read-only graph tools and an interactive visual component that can open inline or fullscreen.

The current public preview uses a fully synthetic new-energy dataset. It does not accept customer uploads, mutate graph data, or make automated decisions.

## Plugin capabilities

- Search entities and return stable IDs
- Expand a bounded one-to-three-hop neighborhood
- Trace bounded shortest relationship paths
- Explain a relationship with source-backed evidence
- Render selected entities and relationships as an interactive visual graph
- Send node and relationship selections back into the ChatGPT conversation context
- Switch between analytical 2D and perspective views, drag nodes, inspect evidence, and request fullscreen

The production MCP endpoint is served from `/mcp`. The UI resource is `ui://reloscope/graph-v1.html`.

## Surfaces

- `/` — legacy split-screen product demo
- `/visual` — visual-only companion workspace
- `/privacy` — privacy policy
- `/terms` — terms of use
- `/support` — support information

## Local development

Requires Node.js 22.13 or later.

```bash
npm ci
npm run plugin:dev
```

Use `http://localhost:8787/mcp` with an MCP Inspector or an HTTPS tunnel. Run the website separately with `npm run dev`.

## Validation

```bash
npm run plugin:test
npm run typecheck
npm run lint
npm run build
```

## Release status

Version 0.1 is a synthetic, read-only preview intended for developer-mode testing and OpenAI app review preparation. Authentication, tenant isolation, private datasets, durable workspaces, and graph mutation remain out of scope for this release.
