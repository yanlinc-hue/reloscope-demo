import assert from "node:assert/strict";
import test from "node:test";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const UI_RESOURCE_URI = "ui://reloscope/graph-v1.html";

let workerPromise;

async function getWorker() {
  workerPromise ??= (async () => {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    return worker;
  })();

  return workerPromise;
}

async function request(path, init = {}) {
  const worker = await getWorker();
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "text/html");

  return worker.fetch(
    new Request(new URL(path, "http://localhost"), { ...init, headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render(path = "/") {
  return request(path);
}

async function callMcp(method, params, id) {
  const response = await request("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  assert.equal(response.status, 200, `${method} should return HTTP 200`);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");

  const payload = await response.json();
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, id);
  assert.equal(payload.error, undefined, `${method} returned ${JSON.stringify(payload.error)}`);
  return payload.result;
}

test("server-renders the chat-driven visual analyst demo", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="en"/);
  assert.match(html, /RELOSCOPE/);
  assert.match(html, /Visual Analyst/);
  assert.match(html, /DEMO AGENT · LOCAL ORCHESTRATION/);
  assert.match(html, /ACTION PLAN/);
  assert.match(html, /Upstream dependency investigation/);
  assert.match(html, /Donglan New Energy Ecosystem Review/);
  assert.match(html, /SYNTHETIC DATA · DEMO ONLY/);
  assert.doesNotMatch(html, /[一-龥]/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("server-renders a visual-only workspace without a second chat surface", async () => {
  const response = await render("/visual");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /RELOSCOPE/);
  assert.match(html, /VISUAL RELATIONSHIP INTELLIGENCE/);
  assert.match(html, /Visual Workspace/);
  assert.match(html, /Analyze 3D/);
  assert.match(html, /Present 2D/);
  assert.match(html, /SYNTHETIC DATA · DEMO ONLY/);
  assert.doesNotMatch(html, /DEMO AGENT · LOCAL ORCHESTRATION/);
  assert.doesNotMatch(html, /aria-label="Ask Visual Analyst"/);
});

const legalPages = [
  {
    path: "/privacy",
    title: "Privacy Policy",
    marker: "does not use plugin inputs or interaction data to train a shared model",
  },
  {
    path: "/terms",
    title: "Terms of Use",
    marker: "does not replace professional judgment or source verification",
  },
  {
    path: "/support",
    title: "Reloscope Support",
    marker: "Reloscope GitHub issue tracker",
  },
];

for (const { path, title, marker } of legalPages) {
  test(`server-renders the ${path} page`, async () => {
    const response = await render(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

    const html = await response.text();
    assert.match(html, new RegExp(`<h1[^>]*>${title}</h1>`));
    assert.match(html, new RegExp(marker));
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /href="\/support"/);
    assert.match(html, /Last updated\s*(?:<!-- -->)?\s*August 20, 2026/);
  });
}

test("the production worker completes MCP initialization", async () => {
  const result = await callMcp(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "reloscope-rendered-test", version: "1.0.0" },
    },
    1,
  );

  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(result.serverInfo, { name: "reloscope", version: "0.1.0" });
  assert.ok(result.capabilities.tools);
  assert.ok(result.capabilities.resources);
});

test("the production worker exposes the five bounded read-only tools", async () => {
  const result = await callMcp("tools/list", {}, 2);
  const expectedNames = [
    "explain_relationship",
    "find_relationship_paths",
    "get_neighborhood",
    "render_relationship_graph",
    "search_entities",
  ];

  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), expectedNames);
  for (const tool of result.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must remain read-only`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} must remain non-destructive`);
    assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} must remain closed-world`);
  }

  const renderTool = result.tools.find((tool) => tool.name === "render_relationship_graph");
  const pathTool = result.tools.find((tool) => tool.name === "find_relationship_paths");
  assert.equal(renderTool?._meta?.ui?.resourceUri, UI_RESOURCE_URI);
  assert.equal(renderTool?.inputSchema?.properties?.mode, undefined);
  assert.equal(pathTool?.inputSchema?.properties?.maxHops?.maximum, 6);
  assert.equal(pathTool?.inputSchema?.properties?.maxPaths?.maximum, 10);
  assert.equal(
    result.tools.filter((tool) => tool._meta?.ui?.resourceUri).length,
    1,
    "only the render tool should open the visual component",
  );
});

test("the production worker executes the graph render tool", async () => {
  const result = await callMcp(
    "tools/call",
    {
      name: "render_relationship_graph",
      arguments: {
        nodeIds: ["N01", "N05"],
        focusEntityIds: ["N05"],
      },
    },
    3,
  );

  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.mode, "replace");
  assert.deepEqual(
    result.structuredContent.graph.nodes.map((node) => node.id),
    ["N01", "N05"],
  );
  assert.deepEqual(
    result.structuredContent.graph.edges.map((edge) => edge.id),
    ["E05"],
  );
  assert.deepEqual(result.structuredContent.selection.entityIds, ["N05"]);
  assert.match(result.content[0].text, /Rendering 2 entities and 1 relationships/);
});

test("the production worker serves the interactive Reloscope UI resource", async () => {
  const result = await callMcp(
    "resources/read",
    { uri: UI_RESOURCE_URI },
    4,
  );

  assert.equal(result.contents.length, 1);
  const [resource] = result.contents;
  assert.equal(resource.uri, UI_RESOURCE_URI);
  assert.match(resource.mimeType, /^text\/html\b/i);
  assert.match(resource.text, /RELOSCOPE/);
  assert.match(resource.text, /ui\/initialize/);
  assert.match(resource.text, /availableDisplayModes:\s*\["inline",\s*"fullscreen"\]/);
  assert.match(resource.text, /ui\/update-model-context/);
  assert.match(resource.text, /ui\/request-display-mode|requestDisplayMode/);
  assert.equal(resource._meta?.ui?.domain, "http://localhost");
});
