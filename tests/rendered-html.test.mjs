import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the chat-driven visual analyst demo", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
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
