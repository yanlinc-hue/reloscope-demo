# Reloscope

A chat-driven Visual Analyst demo: conversation on the left, a relationship graph on the right. The project uses a fully synthetic new-energy dataset to demonstrate graph investigation, evidence-backed explanations, change previews, and reusable analysis scenes.

## Demo capabilities

- 18 fictional entities, 32 relationships, 15 synthetic sources, and 4 preset scenes
- Natural-language upstream exploration, capital-path tracing, entity focus, and risk explanation
- Two-way chat/canvas context: selecting a node or edge informs the next turn
- Read-only analysis updates the graph immediately; graph changes and scene saves require preview and approval
- Structured Action Plans, evidence references, unsupported-write blocking, and visual undo
- Shared graph state across analytical 3D and presentation-ready 2D views
- Force, radial, and layered layouts with draggable, pinnable nodes
- Edge-level evidence drawer with “Explain in Chat”
- Browser-local CSV / JSON import
- PNG, SVG, and complete project JSON export

This demo uses deterministic local orchestration for a stable presentation. It does not call a live model and does not represent production-grade authorization, auditing, or million-element GPU rendering.

## Suggested demo prompts

- `Why is Lanxin Intelligent Controls a high-risk node?`
- `Trace the industrial fund's path to both projects.`
- `Change Jiaxu Capital's relationship to Lanxin Intelligent Controls to effective control and mark it verified.`
- `Turn this analysis into investment committee scenes.`

## Local development

Requires Node.js 22.13 or later.

```bash
npm install
npm run dev
```
