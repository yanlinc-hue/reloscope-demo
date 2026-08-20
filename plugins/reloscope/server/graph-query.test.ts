import assert from "node:assert/strict";
import test from "node:test";

import {
  GraphQueryError,
  buildGraphPayload,
  explainRelation,
  findShortestPaths,
  getNeighborhood,
  searchEntities,
  type GetNeighborhoodInput,
} from "./graph-query.js";

test("searchEntities ranks exact matches first and is deterministic", () => {
  const first = searchEntities({ query: "Jichuan Power", limit: 5 });
  const second = searchEntities({ query: "  jichuan   power  ", limit: 5 });

  assert.equal(first.matches[0]?.id, "N01");
  assert.equal(first.matches[0]?.label, "Jichuan Power");
  assert.equal(first.matches[0]?.score, 98);
  assert.deepEqual(second, first);
});

test("searchEntities applies kind and result limits", () => {
  const result = searchEntities({ query: "capital", kinds: ["capital"], limit: 1 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.id, "N10");
  assert.equal(result.matches[0]?.kind, "capital");
});

test("searchEntities rejects empty queries, invalid kinds, and invalid limits", () => {
  assert.throws(
    () => searchEntities({ query: "   " }),
    (error) => error instanceof GraphQueryError && error.code === "INVALID_ARGUMENT",
  );
  assert.throws(
    () => searchEntities({ query: "power", kinds: ["unknown"] }),
    /Unknown entity kind unknown/,
  );
  assert.throws(() => searchEntities({ query: "power", limit: 0 }), /limit must be an integer/);
});

test("buildGraphPayload creates a stable normalized payload with evidence", () => {
  const result = buildGraphPayload({
    edgeIds: ["E05"],
    mode: "merge",
    focusEntityIds: ["N05", "N01", "N05"],
    focusRelationIds: ["E05"],
  });

  assert.equal(result.mode, "merge");
  assert.deepEqual(result.graph.nodes.map((node) => node.id), ["N01", "N05"]);
  assert.deepEqual(result.graph.edges.map((edge) => edge.id), ["E05"]);
  assert.deepEqual(result.selection, {
    entityIds: ["N01", "N05"],
    relationIds: ["E05"],
  });
  assert.equal(result.graph.nodes[0]?.label, "Jichuan Power");
  assert.deepEqual(result.graph.edges[0]?.evidenceIds, ["S01-C2"]);
  assert.equal(result.evidence[0]?.sourceId, "S01");
  assert.equal(result.evidence[0]?.title, "Jichuan Power 2025 Operating Brief");
  assert.equal(result.truncated, false);
});

test("buildGraphPayload derives induced edges for an explicit node set", () => {
  const result = buildGraphPayload({ nodeIds: ["N03", "N01", "N02"] });

  assert.deepEqual(result.graph.nodes.map((node) => node.id), ["N01", "N02", "N03"]);
  assert.deepEqual(result.graph.edges.map((edge) => edge.id), ["E01", "E02", "E03"]);
});

test("buildGraphPayload returns the full demo graph by default without sharing mutable output", () => {
  const first = buildGraphPayload();
  assert.equal(first.graph.nodes.length, 18);
  assert.equal(first.graph.edges.length, 32);

  first.graph.nodes[0]!.label = "mutated";
  first.graph.nodes[0]!.position.x = 999;

  const second = buildGraphPayload();
  assert.equal(second.graph.nodes[0]?.label, "Jichuan Power");
  assert.notEqual(second.graph.nodes[0]?.position.x, 999);
});

test("buildGraphPayload validates IDs, focus membership, and mode", () => {
  assert.throws(() => buildGraphPayload({ nodeIds: ["N99"] }), /unknown entity N99/);
  assert.throws(
    () => buildGraphPayload({ nodeIds: ["N01"], focusEntityIds: ["N02"] }),
    /Focused entity N02 is not present/,
  );
  assert.throws(
    () => buildGraphPayload({ mode: "invalid" as "replace" }),
    /mode must be either replace or merge/,
  );
});

test("getNeighborhood respects incoming and outgoing direction", () => {
  const incoming = getNeighborhood({
    rootId: "N01",
    depth: 1,
    direction: "incoming",
    edgeKinds: ["supply"],
  });
  const outgoing = getNeighborhood({
    rootId: "N01",
    depth: 1,
    direction: "outgoing",
    edgeKinds: ["supply"],
  });

  assert.deepEqual(incoming.graph.nodes.map((node) => node.id), ["N01", "N02", "N03", "N04", "N05"]);
  assert.deepEqual(incoming.graph.edges.map((edge) => edge.id), ["E02", "E03", "E04", "E05"]);
  assert.deepEqual(incoming.distances, { N01: 0, N02: 1, N03: 1, N04: 1, N05: 1 });

  assert.deepEqual(outgoing.graph.nodes.map((node) => node.id), ["N01", "N06", "N07"]);
  assert.deepEqual(outgoing.graph.edges.map((edge) => edge.id), ["E06", "E07"]);
  assert.deepEqual(outgoing.distances, { N01: 0, N06: 1, N07: 1 });
});

test("getNeighborhood caps nodes deterministically and reports truncation", () => {
  const result = getNeighborhood({
    rootId: "N01",
    depth: 1,
    direction: "both",
    edgeKinds: ["supply"],
    maxNodes: 2,
  });

  assert.deepEqual(result.graph.nodes.map((node) => node.id), ["N01", "N02"]);
  assert.deepEqual(result.graph.edges.map((edge) => edge.id), ["E02"]);
  assert.equal(result.truncated, true);
});

test("getNeighborhood accepts tool defaults above the demo node count and rejects invalid bounds", () => {
  const result = getNeighborhood({
    rootId: "N01",
    depth: 3,
    direction: "both",
    maxNodes: 40,
  });
  assert.ok(result.graph.nodes.length <= 18);

  assert.throws(
    () => getNeighborhood({
      rootId: "N01",
      depth: 4,
      direction: "both",
    } as unknown as GetNeighborhoodInput),
    /depth must be an integer between 1 and 3/,
  );
  assert.throws(
    () => getNeighborhood({
      rootId: "N01",
      depth: 1,
      direction: "sideways",
    } as unknown as GetNeighborhoodInput),
    /direction must be one of incoming, outgoing, or both/,
  );
});

test("findShortestPaths follows direction and returns a bounded shortest result", () => {
  const result = findShortestPaths({
    fromId: "N11",
    toId: "N17",
    maxHops: 4,
    maxPaths: 3,
    direction: "outgoing",
  });

  assert.deepEqual(result.paths, [
    { nodeIds: ["N11", "N01", "N17"], edgeIds: ["E11", "E26"], hops: 2 },
  ]);
  assert.deepEqual(result.selection.entityIds, ["N11", "N17"]);
  assert.equal(result.truncated, false);
});

test("findShortestPaths distinguishes parallel directed edges and maxPaths truncation", () => {
  const outgoing = findShortestPaths({
    fromId: "N01",
    toId: "N08",
    maxHops: 2,
    maxPaths: 2,
    direction: "outgoing",
  });
  const incoming = findShortestPaths({
    fromId: "N01",
    toId: "N08",
    maxHops: 2,
    maxPaths: 2,
    direction: "incoming",
  });
  const bothLimited = findShortestPaths({
    fromId: "N01",
    toId: "N08",
    maxHops: 2,
    maxPaths: 1,
    direction: "both",
  });

  assert.deepEqual(outgoing.paths[0]?.edgeIds, ["E08"]);
  assert.deepEqual(incoming.paths[0]?.edgeIds, ["E09"]);
  assert.deepEqual(bothLimited.paths[0]?.edgeIds, ["E08"]);
  assert.equal(bothLimited.truncated, true);
});

test("findShortestPaths handles no path and identical endpoints", () => {
  const noPath = findShortestPaths({
    fromId: "N11",
    toId: "N17",
    maxHops: 1,
    maxPaths: 3,
    direction: "outgoing",
  });
  const same = findShortestPaths({
    fromId: "N01",
    toId: "N01",
    maxHops: 1,
    maxPaths: 3,
  });

  assert.deepEqual(noPath.paths, []);
  assert.deepEqual(noPath.graph.nodes.map((node) => node.id), ["N11", "N17"]);
  assert.deepEqual(noPath.graph.edges, []);
  assert.deepEqual(same.paths, [{ nodeIds: ["N01"], edgeIds: [], hops: 0 }]);
});

test("findShortestPaths validates endpoints and limits", () => {
  assert.throws(
    () => findShortestPaths({ fromId: "N99", toId: "N01", maxHops: 2, maxPaths: 2 }),
    /unknown entity N99/,
  );
  assert.throws(
    () => findShortestPaths({ fromId: "N01", toId: "N02", maxHops: 0, maxPaths: 2 }),
    /maxHops must be an integer/,
  );
  assert.throws(
    () => findShortestPaths({ fromId: "N01", toId: "N02", maxHops: 7, maxPaths: 2 }),
    /maxHops must be an integer between 1 and 6/,
  );
  assert.throws(
    () => findShortestPaths({ fromId: "N01", toId: "N02", maxHops: 2, maxPaths: 0 }),
    /maxPaths must be an integer/,
  );
  assert.throws(
    () => findShortestPaths({ fromId: "N01", toId: "N02", maxHops: 2, maxPaths: 11 }),
    /maxPaths must be an integer between 1 and 10/,
  );
});

test("explainRelation returns normalized endpoints and source-backed evidence", () => {
  const result = explainRelation({ edgeId: "E05", evidenceLimit: 8 });

  assert.equal(result.edge.id, "E05");
  assert.deepEqual(result.nodes.map((node) => node.id), ["N05", "N01"]);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.evidence[0], {
    id: "S01-C2",
    sourceId: "S01",
    title: "Jichuan Power 2025 Operating Brief",
    date: "2026-02-28",
    type: "Corporate Materials",
    sourceSummary: "Discloses Jichuan Power's capacity, revenue, management, major customers, and control-system coverage.",
    excerpt: "Lanxin Intelligent Controls supplies controllers for 62% of Jichuan Power's battery packs in production.",
    location: "p.7 §3.2",
    confidence: 0.98,
    status: "verified",
  });
  assert.match(result.summary, /62% coverage/);
});

test("explainRelation validates the relation ID and evidence limit", () => {
  assert.throws(() => explainRelation({ edgeId: "E99" }), /unknown relation E99/);
  assert.throws(
    () => explainRelation({ edgeId: "E05", evidenceLimit: 21 }),
    /evidenceLimit must be an integer between 1 and 20/,
  );
});
