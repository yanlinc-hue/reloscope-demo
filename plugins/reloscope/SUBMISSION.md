# Reloscope plugin release checklist

The deployed build is still the synthetic developer preview. The next local
build adds a stateless, user-authorized workflow for relationship data supplied
through the current conversation. Do not submit it to the public directory
until that workflow has passed developer-mode, privacy, and policy testing.

## Listing

- **Name:** Reloscope
- **Category:** Productivity
- **Short description:** Explore relationships. Verify the evidence.
- **Website:** https://relation-star-map-819.yanlinc.chatgpt.site/
- **Privacy:** https://relation-star-map-819.yanlinc.chatgpt.site/privacy
- **Terms:** https://relation-star-map-819.yanlinc.chatgpt.site/terms
- **Support:** https://relation-star-map-819.yanlinc.chatgpt.site/support
- **Production MCP:** https://relation-star-map-819.yanlinc.chatgpt.site/mcp

## Starter prompts

1. Map Jichuan Power's upstream relationships.
2. Trace the strongest path between two entities.
3. Explain the evidence behind this relationship.

## Positive review tests

1. **Entity lookup** — “Find Jichuan Power.” Expected: a stable entity ID and a concise matching result.
2. **Neighborhood** — “Show two hops upstream from Jichuan Power.” Expected: a bounded subgraph with no dangling relationships.
3. **Path trace** — “Trace a path from Jiaxu Capital to the Qingyu storage project.” Expected: one or more valid paths with stable node and relationship IDs.
4. **Evidence** — “What supports relationship E05?” Expected: source title, location, excerpt, verification state, and confidence.
5. **Visual render** — “Show that result as a relationship map.” Expected: one interactive Reloscope component, usable inline and fullscreen.
6. **Follow-up context** — Select a relationship in the component, then ask “Explain this relationship.” Expected: the selected relationship ID is used, not guessed from its label.
7. **Conversation graph** — Provide a small set of entities and relationships, then ask “Turn this into an interactive relationship graph.” Expected: the supplied graph renders without being persisted and every relationship retains its supplied evidence IDs.

## Negative review tests

1. **Unknown entity** — Search for an entity absent from the workspace. Expected: an empty result with a helpful message; no invented node.
2. **Invalid bounds** — Request 20-hop expansion. Expected: schema rejection or a clear maximum-depth message; no oversized response.
3. **Unsupported write** — Ask to delete or rewrite a relationship. Expected: explain that this release is read-only and leave the graph unchanged.
4. **Unrelated prompt** — Ask for a weather forecast. Expected: Reloscope is not selected.

## Release notes

The next local preview adds `visualize_relationship_graph`, a bounded and stateless rendering path for structured relationship data supplied by ChatGPT. It does not accept customer uploads, persist supplied graphs, mutate external data, or make automated decisions. The deployed public preview remains synthetic-only until explicitly updated.

## Submission gates

- Validate the conversation-supplied graph workflow against several non-synthetic, user-authorized examples.
- Verify the individual or business publisher identity in the OpenAI Platform.
- Confirm Apps Management Write permission for the submitting organization.
- Add the OpenAI-provided domain challenge value to the production environment.
- Run MCP Inspector and ChatGPT developer-mode tests against the production `/mcp` endpoint.
- Choose initial country availability in the submission portal.
- Capture accurate PNG screenshots after the production component is connected.
