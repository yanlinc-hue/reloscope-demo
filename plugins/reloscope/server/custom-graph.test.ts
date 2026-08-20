import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_GRAPH_LIMITS,
  buildUserGraphPayload,
  type CustomGraphInput,
} from "./custom-graph.js";
import { GraphQueryError } from "./graph-query.js";

const BASE_INPUT = {
  graph: {
    nodes: [
      {
        id: "entity:b",
        label: "Beta",
        kind: "Company",
        sourceIds: ["source:2", "source:1", "source:2"],
      },
      {
        id: "entity:a",
        label: "Alpha",
        position: { x: 10, y: 20, z: 30 },
      },
    ],
    edges: [
      {
        id: "relation:1",
        sourceId: "entity:a",
        targetId: "entity:b",
        kind: "Works_With",
        label: "works with",
        evidenceIds: ["evidence:1", "evidence:1"],
      },
    ],
  },
  evidence: [
    {
      id: "evidence:1",
      sourceId: "source:1",
      title: "Meeting record",
      excerpt: "The parties agreed to work together.",
    },
  ],
  graphTitle: "Alpha and Beta",
  sourceLabel: "Current chat",
  summary: "A caller-supplied relationship graph.",
  focusEntityIds: ["entity:b", "entity:a", "entity:b"],
  focusRelationIds: ["relation:1"],
} satisfies CustomGraphInput;

function expectInvalid(callback: () => unknown, message: RegExp) {
  assert.throws(
    callback,
    (error) =>
      error instanceof GraphQueryError
      && error.code === "INVALID_ARGUMENT"
      && message.test(error.message),
  );
}

test("buildUserGraphPayload returns the existing payload shape with stable sorted IDs", () => {
  const first = buildUserGraphPayload(BASE_INPUT);
  const reversed = buildUserGraphPayload({
    ...BASE_INPUT,
    graph: {
      nodes: [...BASE_INPUT.graph.nodes].reverse(),
      edges: BASE_INPUT.graph.edges,
    },
  });

  assert.equal(first.mode, "replace");
  assert.equal(first.graphTitle, "Alpha and Beta");
  assert.equal(first.sourceLabel, "Current chat");
  assert.deepEqual(first.graph.nodes.map((node) => node.id), ["entity:a", "entity:b"]);
  assert.deepEqual(first.graph.edges.map((edge) => edge.id), ["relation:1"]);
  assert.deepEqual(first.evidence.map((record) => record.id), ["evidence:1"]);
  assert.deepEqual(first.selection, {
    entityIds: ["entity:a", "entity:b"],
    relationIds: ["relation:1"],
  });
  assert.deepEqual(first.graph.nodes[0]?.position, { x: 10, y: 20, z: 30 });
  assert.deepEqual(first.graph.nodes[1]?.position, reversed.graph.nodes[1]?.position);
  assert.equal(first.graph.nodes[1]?.kind, "company");
  assert.deepEqual(first.graph.nodes[1]?.sourceIds, ["source:1", "source:2"]);
  assert.deepEqual(first.graph.edges[0]?.evidenceIds, ["evidence:1"]);
  assert.equal(first.graph.edges[0]?.confidence, null);
  assert.equal(first.evidence[0]?.confidence, null);
  assert.equal(first.graph.nodes[0]?.risk, "unknown");
  assert.equal(first.summary, BASE_INPUT.summary);
  assert.equal(first.truncated, false);
});

test("buildUserGraphPayload is stateless and does not share mutable output", () => {
  const first = buildUserGraphPayload(BASE_INPUT);
  first.graph.nodes[0]!.label = "mutated";
  first.graph.nodes[0]!.position.x = 9_999;
  first.evidence[0]!.excerpt = "mutated";

  const second = buildUserGraphPayload(BASE_INPUT);
  assert.equal(second.graph.nodes[0]?.label, "Alpha");
  assert.deepEqual(second.graph.nodes[0]?.position, { x: 10, y: 20, z: 30 });
  assert.equal(second.evidence[0]?.excerpt, "The parties agreed to work together.");
});

test("buildUserGraphPayload rejects duplicate stable IDs in every collection", () => {
  expectInvalid(
    () => buildUserGraphPayload({
      graph: {
        nodes: [
          { id: "entity:1", label: "One" },
          { id: "entity:1", label: "Duplicate" },
        ],
        edges: [],
      },
    }),
    /graph\.nodes contains duplicate stable ID entity:1/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: {
        nodes: [{ id: "entity:1", label: "One" }],
        edges: [
          { id: "relation:1", sourceId: "entity:1", targetId: "entity:1", kind: "related", label: "related" },
          { id: "relation:1", sourceId: "entity:1", targetId: "entity:1", kind: "related", label: "related" },
        ],
      },
    }),
    /graph\.edges contains duplicate stable ID relation:1/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One" }], edges: [] },
      evidence: [
        { id: "evidence:1", sourceId: "source:1", title: "First", excerpt: "First claim" },
        { id: "evidence:1", sourceId: "source:1", title: "Second", excerpt: "Second claim" },
      ],
    }),
    /evidence contains duplicate stable ID evidence:1/,
  );
});

test("buildUserGraphPayload enforces endpoint, evidence, and focus integrity", () => {
  expectInvalid(
    () => buildUserGraphPayload({
      graph: {
        nodes: [{ id: "entity:1", label: "One" }],
        edges: [{ id: "relation:1", sourceId: "missing", targetId: "entity:1", kind: "related", label: "related" }],
      },
    }),
    /missing source entity missing/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: {
        nodes: [{ id: "entity:1", label: "One" }],
        edges: [{ id: "relation:1", sourceId: "entity:1", targetId: "missing", kind: "related", label: "related" }],
      },
    }),
    /missing target entity missing/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: {
        nodes: [{ id: "entity:1", label: "One" }],
        edges: [{ id: "relation:1", sourceId: "entity:1", targetId: "entity:1", kind: "related", label: "related", evidenceIds: ["missing"] }],
      },
    }),
    /missing evidence missing/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One" }], edges: [] },
      focusEntityIds: ["missing"],
    }),
    /Focused entity missing is not present/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One" }], edges: [] },
      focusRelationIds: ["missing"],
    }),
    /Focused relation missing is not present/,
  );
});

test("buildUserGraphPayload strictly bounds structured input and rejects raw HTML", () => {
  const tooManyNodes = Array.from(
    { length: CUSTOM_GRAPH_LIMITS.nodes + 1 },
    (_, index) => ({ id: `entity:${index}`, label: `Entity ${index}` }),
  );

  expectInvalid(
    () => buildUserGraphPayload({ graph: { nodes: tooManyNodes, edges: [] } }),
    /Too big|at most 100/i,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "<script>alert(1)</script>" }], edges: [] },
    }),
    /raw HTML delimiters/,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One", html: "<b>One</b>" }], edges: [] },
    }),
    /Unrecognized key|unrecognized/i,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One" }], edges: [] },
      mode: "merge",
    }),
    /Unrecognized key|unrecognized/i,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "entity:1", label: "One" }], edges: [] },
      sourceUrl: "https://example.com",
    }),
    /Unrecognized key|unrecognized/i,
  );
  expectInvalid(
    () => buildUserGraphPayload({
      graph: { nodes: [{ id: "not a stable id", label: "One" }], edges: [] },
    }),
    /stable 1-64 character ASCII ID/,
  );
});
