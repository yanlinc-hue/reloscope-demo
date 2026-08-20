import {
  DEMO_EDGES,
  DEMO_NODES,
  DEMO_SOURCES,
  type DemoEdge,
  type DemoNode,
  type EdgeKind,
  type NodeKind,
} from "../../../app/demo-data";

export type GraphDirection = "incoming" | "outgoing" | "both";
export type GraphMode = "replace" | "merge";

export type GraphQueryErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND";

export class GraphQueryError extends Error {
  readonly code: GraphQueryErrorCode;

  constructor(code: GraphQueryErrorCode, message: string) {
    super(message);
    this.name = "GraphQueryError";
    this.code = code;
  }
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  subtitle: string;
  summary: string;
  metric: string;
  risk: DemoNode["risk"];
  status: DemoNode["status"];
  sourceIds: string[];
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  label: string;
  weight: number;
  status: DemoEdge["status"];
  evidenceIds: string[];
  confidence: number;
  directed: boolean;
}

export interface GraphEvidence {
  id: string;
  sourceId: string;
  title: string;
  date: string;
  type: string;
  sourceSummary: string;
  excerpt: string;
  location: string;
  confidence: number;
  status: DemoEdge["status"];
}

export interface GraphPayload extends Record<string, unknown> {
  mode: GraphMode;
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  evidence: GraphEvidence[];
  summary: string;
  selection: {
    entityIds: string[];
    relationIds: string[];
  };
  truncated: boolean;
}

export interface SearchEntitiesInput {
  query: string;
  kinds?: string[];
  limit?: number;
}

export interface EntitySearchMatch {
  id: string;
  label: string;
  kind: NodeKind;
  subtitle: string;
  score: number;
}

export interface SearchEntitiesResult extends Record<string, unknown> {
  matches: EntitySearchMatch[];
}

export interface GetNeighborhoodInput {
  rootId: string;
  depth: 1 | 2 | 3;
  direction: GraphDirection;
  edgeKinds?: string[];
  maxNodes?: number;
}

export interface NeighborhoodResult extends GraphPayload {
  rootId: string;
  depth: 1 | 2 | 3;
  direction: GraphDirection;
  distances: Record<string, number>;
}

export interface FindShortestPathsInput {
  fromId: string;
  toId: string;
  maxHops?: number;
  maxPaths?: number;
  direction?: GraphDirection;
}

export interface GraphPath {
  nodeIds: string[];
  edgeIds: string[];
  hops: number;
}

export interface ShortestPathsResult extends GraphPayload {
  fromId: string;
  toId: string;
  direction: GraphDirection;
  maxHops: number;
  maxPaths: number;
  paths: GraphPath[];
}

export interface ExplainRelationInput {
  edgeId: string;
  evidenceLimit?: number;
}

export interface ExplainRelationResult extends Record<string, unknown> {
  edge: GraphEdge;
  nodes: GraphNode[];
  evidence: GraphEvidence[];
  summary: string;
}

export interface BuildGraphPayloadInput {
  nodeIds?: string[];
  edgeIds?: string[];
  mode?: GraphMode;
  focusEntityIds?: string[];
  focusRelationIds?: string[];
}

type DemoSource = (typeof DEMO_SOURCES)[number];
type TraversalStep = { edge: DemoEdge; nextNodeId: string };

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_MAX_HOPS = 6;
const DEFAULT_MAX_PATHS = 5;
const MAX_HOPS = 6;
const MAX_PATHS = 10;

const SORTED_NODES = [...DEMO_NODES].sort(compareById);
const SORTED_EDGES = [...DEMO_EDGES].sort(compareById);
const NODE_BY_ID = new Map(SORTED_NODES.map((node) => [node.id, node]));
const EDGE_BY_ID = new Map(SORTED_EDGES.map((edge) => [edge.id, edge]));
const SOURCE_BY_ID = new Map(DEMO_SOURCES.map((source) => [source.id, source]));
const NODE_KINDS = new Set<NodeKind>(SORTED_NODES.map((node) => node.kind));
const EDGE_KINDS = new Set<EdgeKind>(SORTED_EDGES.map((edge) => edge.kind));
const DIRECTIONS = new Set<GraphDirection>(["incoming", "outgoing", "both"]);
const MODES = new Set<GraphMode>(["replace", "merge"]);

function compareById<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id);
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requireInteger(value: number, field: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GraphQueryError(
      "INVALID_ARGUMENT",
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function requireDirection(value: GraphDirection | string): GraphDirection {
  if (!DIRECTIONS.has(value as GraphDirection)) {
    throw new GraphQueryError(
      "INVALID_ARGUMENT",
      "direction must be one of incoming, outgoing, or both.",
    );
  }
  return value as GraphDirection;
}

function requireMode(value: GraphMode | string): GraphMode {
  if (!MODES.has(value as GraphMode)) {
    throw new GraphQueryError(
      "INVALID_ARGUMENT",
      "mode must be either replace or merge.",
    );
  }
  return value as GraphMode;
}

function requireNode(id: string, field = "nodeId") {
  const node = NODE_BY_ID.get(id);
  if (!node) {
    throw new GraphQueryError("NOT_FOUND", `${field} references unknown entity ${id}.`);
  }
  return node;
}

function requireEdge(id: string, field = "edgeId") {
  const edge = EDGE_BY_ID.get(id);
  if (!edge) {
    throw new GraphQueryError("NOT_FOUND", `${field} references unknown relation ${id}.`);
  }
  return edge;
}

function requireNodeIds(ids: readonly string[], field: string) {
  const result = uniqueSorted(ids);
  result.forEach((id) => requireNode(id, field));
  return result;
}

function requireEdgeIds(ids: readonly string[], field: string) {
  const result = uniqueSorted(ids);
  result.forEach((id) => requireEdge(id, field));
  return result;
}

function requireNodeKinds(kinds: readonly string[]) {
  const result = [...new Set(kinds)];
  for (const kind of result) {
    if (!NODE_KINDS.has(kind as NodeKind)) {
      throw new GraphQueryError("INVALID_ARGUMENT", `Unknown entity kind ${String(kind)}.`);
    }
  }
  return result as NodeKind[];
}

function requireEdgeKinds(kinds: readonly string[]) {
  const result = [...new Set(kinds)];
  for (const kind of result) {
    if (!EDGE_KINDS.has(kind as EdgeKind)) {
      throw new GraphQueryError("INVALID_ARGUMENT", `Unknown relation kind ${String(kind)}.`);
    }
  }
  return result as EdgeKind[];
}

function toGraphNode(node: DemoNode): GraphNode {
  return {
    id: node.id,
    label: node.name,
    kind: node.kind,
    subtitle: node.subtitle,
    summary: node.summary,
    metric: node.metric,
    risk: node.risk,
    status: node.status,
    sourceIds: uniqueSorted(node.sources),
    position: { x: node.x, y: node.y, z: node.z },
  };
}

function toGraphEdge(edge: DemoEdge): GraphEdge {
  return {
    id: edge.id,
    sourceId: edge.source,
    targetId: edge.target,
    kind: edge.kind,
    label: edge.label,
    weight: edge.weight,
    status: edge.status,
    evidenceIds: [edge.evidenceId],
    confidence: edge.confidence,
    directed: edge.directed,
  };
}

function evidenceSourceId(evidenceId: string) {
  return evidenceId.split("-", 1)[0] ?? evidenceId;
}

function toGraphEvidence(edge: DemoEdge): GraphEvidence {
  const sourceId = evidenceSourceId(edge.evidenceId);
  const source: DemoSource | undefined = SOURCE_BY_ID.get(sourceId);
  return {
    id: edge.evidenceId,
    sourceId,
    title: source?.title ?? edge.sourceTitle,
    date: source?.date ?? "",
    type: source?.type ?? "Unknown",
    sourceSummary: source?.summary ?? "",
    excerpt: edge.evidence,
    location: edge.location,
    confidence: edge.confidence,
    status: edge.status,
  };
}

function evidenceForEdges(edges: readonly DemoEdge[]) {
  const byId = new Map<string, GraphEvidence>();
  for (const edge of [...edges].sort(compareById)) {
    const evidence = toGraphEvidence(edge);
    if (!byId.has(evidence.id)) byId.set(evidence.id, evidence);
  }
  return [...byId.values()].sort(compareById);
}

function traversalSteps(
  nodeId: string,
  direction: GraphDirection,
  allowedKinds?: ReadonlySet<EdgeKind>,
) {
  const steps: TraversalStep[] = [];

  for (const edge of SORTED_EDGES) {
    if (allowedKinds && !allowedKinds.has(edge.kind)) continue;

    if (!edge.directed || direction === "both") {
      if (edge.source === nodeId) steps.push({ edge, nextNodeId: edge.target });
      if (edge.target === nodeId && edge.source !== edge.target) {
        steps.push({ edge, nextNodeId: edge.source });
      }
      continue;
    }

    if (direction === "outgoing" && edge.source === nodeId) {
      steps.push({ edge, nextNodeId: edge.target });
    } else if (direction === "incoming" && edge.target === nodeId) {
      steps.push({ edge, nextNodeId: edge.source });
    }
  }

  return steps.sort((left, right) =>
    left.nextNodeId.localeCompare(right.nextNodeId) || left.edge.id.localeCompare(right.edge.id),
  );
}

function entitySearchScore(node: DemoNode, query: string, terms: string[]) {
  const id = normalizeText(node.id);
  const label = normalizeText(node.name);
  const subtitle = normalizeText(node.subtitle);
  const summary = normalizeText(node.summary);
  const metric = normalizeText(node.metric);
  const kind = normalizeText(node.kind);
  const allText = [id, label, subtitle, summary, metric, kind].join(" ");

  let score = 0;
  if (id === query) score = 100;
  else if (label === query) score = 98;
  else if (label.startsWith(query)) score = 90;
  else if (label.includes(query)) score = 82;
  else if (subtitle.includes(query)) score = 70;
  else if (summary.includes(query)) score = 62;
  else if (metric.includes(query)) score = 54;
  else if (kind === query) score = 46;

  const matchedTerms = terms.filter((term) => allText.includes(term)).length;
  if (matchedTerms === 0) return 0;
  const coverage = matchedTerms / terms.length;
  score = Math.max(score, Math.round(35 + coverage * 35));
  return Math.min(100, score);
}

export function searchEntities(input: SearchEntitiesInput): SearchEntitiesResult {
  const query = normalizeText(input.query ?? "");
  if (!query) {
    throw new GraphQueryError("INVALID_ARGUMENT", "query must not be empty.");
  }

  const limit = requireInteger(input.limit ?? DEFAULT_SEARCH_LIMIT, "limit", 1, MAX_SEARCH_LIMIT);
  const allowedKinds = input.kinds ? new Set(requireNodeKinds(input.kinds)) : null;
  const terms = query.split(/[^\p{L}\p{N}%]+/u).filter(Boolean);

  const matches = SORTED_NODES
    .filter((node) => !allowedKinds || allowedKinds.has(node.kind))
    .map((node) => ({ node, score: entitySearchScore(node, query, terms) }))
    .filter(({ score }) => score > 0)
    .sort(({ node: left, score: leftScore }, { node: right, score: rightScore }) =>
      rightScore - leftScore
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map(({ node, score }) => ({
      id: node.id,
      label: node.name,
      kind: node.kind,
      subtitle: node.subtitle,
      score,
    }));

  return { matches };
}

export function buildGraphPayload(input: BuildGraphPayloadInput = {}): GraphPayload {
  const mode = requireMode(input.mode ?? "replace");
  const hasNodeSelection = input.nodeIds !== undefined;
  const hasEdgeSelection = input.edgeIds !== undefined;
  const selectedNodeIds = new Set(
    hasNodeSelection ? requireNodeIds(input.nodeIds ?? [], "nodeIds") : [],
  );
  let selectedEdgeIds = new Set(
    hasEdgeSelection ? requireEdgeIds(input.edgeIds ?? [], "edgeIds") : [],
  );

  if (!hasNodeSelection && !hasEdgeSelection) {
    SORTED_NODES.forEach((node) => selectedNodeIds.add(node.id));
    selectedEdgeIds = new Set(SORTED_EDGES.map((edge) => edge.id));
  } else if (hasNodeSelection && !hasEdgeSelection) {
    selectedEdgeIds = new Set(
      SORTED_EDGES
        .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
        .map((edge) => edge.id),
    );
  }

  for (const edgeId of selectedEdgeIds) {
    const edge = requireEdge(edgeId);
    selectedNodeIds.add(edge.source);
    selectedNodeIds.add(edge.target);
  }

  const focusEntityIds = requireNodeIds(input.focusEntityIds ?? [], "focusEntityIds");
  const focusRelationIds = requireEdgeIds(input.focusRelationIds ?? [], "focusRelationIds");

  for (const id of focusEntityIds) {
    if (!selectedNodeIds.has(id)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Focused entity ${id} is not present in the graph payload.`,
      );
    }
  }
  for (const id of focusRelationIds) {
    if (!selectedEdgeIds.has(id)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Focused relation ${id} is not present in the graph payload.`,
      );
    }
  }

  const nodes = [...selectedNodeIds]
    .map((id) => toGraphNode(requireNode(id)))
    .sort(compareById);
  const sourceEdges = [...selectedEdgeIds]
    .map((id) => requireEdge(id))
    .sort(compareById);
  const edges = sourceEdges.map(toGraphEdge);
  const evidence = evidenceForEdges(sourceEdges);

  return {
    mode,
    graph: { nodes, edges },
    evidence,
    summary: `${nodes.length} entities, ${edges.length} relationships, ${evidence.length} evidence claims.`,
    selection: {
      entityIds: focusEntityIds,
      relationIds: focusRelationIds,
    },
    truncated: false,
  };
}

export function getNeighborhood(input: GetNeighborhoodInput): NeighborhoodResult {
  const root = requireNode(input.rootId, "rootId");
  const depth = requireInteger(input.depth, "depth", 1, 3) as 1 | 2 | 3;
  const direction = requireDirection(input.direction);
  const maxNodes = requireInteger(
    input.maxNodes ?? SORTED_NODES.length,
    "maxNodes",
    1,
    100,
  );
  const effectiveMaxNodes = Math.min(maxNodes, SORTED_NODES.length);
  const allowedKinds = input.edgeKinds
    ? new Set(requireEdgeKinds(input.edgeKinds))
    : undefined;

  const distances = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  let cursor = 0;
  let truncated = false;

  while (cursor < queue.length) {
    const currentId = queue[cursor++];
    const currentDistance = distances.get(currentId) ?? 0;
    if (currentDistance >= depth) continue;

    for (const step of traversalSteps(currentId, direction, allowedKinds)) {
      if (distances.has(step.nextNodeId)) continue;
      if (distances.size >= effectiveMaxNodes) {
        truncated = true;
        continue;
      }
      distances.set(step.nextNodeId, currentDistance + 1);
      queue.push(step.nextNodeId);
    }
  }

  const selectedIds = new Set(distances.keys());
  const selectedEdgeIds = new Set<string>();
  for (const [nodeId, distance] of distances) {
    if (distance >= depth) continue;
    for (const step of traversalSteps(nodeId, direction, allowedKinds)) {
      if (selectedIds.has(step.nextNodeId)) selectedEdgeIds.add(step.edge.id);
    }
  }

  const payload = buildGraphPayload({
    nodeIds: [...selectedIds],
    edgeIds: [...selectedEdgeIds],
    focusEntityIds: [root.id],
  });
  const distanceEntries = [...distances.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return {
    ...payload,
    rootId: root.id,
    depth,
    direction,
    distances: Object.fromEntries(distanceEntries),
    summary: `${payload.graph.nodes.length} entities and ${payload.graph.edges.length} relationships within ${depth} hop${depth === 1 ? "" : "s"} ${direction} from ${root.name}.`,
    truncated,
  };
}

export function findShortestPaths(input: FindShortestPathsInput): ShortestPathsResult {
  const from = requireNode(input.fromId, "fromId");
  const to = requireNode(input.toId, "toId");
  const maxHops = requireInteger(
    input.maxHops ?? DEFAULT_MAX_HOPS,
    "maxHops",
    1,
    MAX_HOPS,
  );
  const maxPaths = requireInteger(input.maxPaths ?? DEFAULT_MAX_PATHS, "maxPaths", 1, MAX_PATHS);
  const direction = requireDirection(input.direction ?? "both");

  const candidates: GraphPath[] = [];

  if (from.id === to.id) {
    candidates.push({ nodeIds: [from.id], edgeIds: [], hops: 0 });
  } else {
    const distances = new Map<string, number>([[from.id, 0]]);
    const parents = new Map<string, Array<{ previousNodeId: string; edgeId: string }>>();
    const queue = [from.id];
    let cursor = 0;
    let targetDistance: number | null = null;

    while (cursor < queue.length) {
      const currentId = queue[cursor++];
      const currentDistance = distances.get(currentId) ?? 0;
      if (currentDistance >= maxHops) continue;
      if (targetDistance !== null && currentDistance >= targetDistance) continue;

      for (const step of traversalSteps(currentId, direction)) {
        const nextDistance = currentDistance + 1;
        const knownDistance = distances.get(step.nextNodeId);

        if (knownDistance === undefined) {
          distances.set(step.nextNodeId, nextDistance);
          parents.set(step.nextNodeId, [{ previousNodeId: currentId, edgeId: step.edge.id }]);
          queue.push(step.nextNodeId);
          if (step.nextNodeId === to.id) targetDistance = nextDistance;
        } else if (knownDistance === nextDistance) {
          parents.get(step.nextNodeId)?.push({ previousNodeId: currentId, edgeId: step.edge.id });
        }
      }
    }

    if (targetDistance !== null) {
      const reversedNodeIds = [to.id];
      const reversedEdgeIds: string[] = [];

      const collect = (nodeId: string) => {
        if (candidates.length > maxPaths) return;
        if (nodeId === from.id) {
          candidates.push({
            nodeIds: [...reversedNodeIds].reverse(),
            edgeIds: [...reversedEdgeIds].reverse(),
            hops: reversedEdgeIds.length,
          });
          return;
        }

        const nodeParents = [...(parents.get(nodeId) ?? [])].sort((left, right) =>
          left.previousNodeId.localeCompare(right.previousNodeId)
          || left.edgeId.localeCompare(right.edgeId),
        );
        for (const parent of nodeParents) {
          reversedNodeIds.push(parent.previousNodeId);
          reversedEdgeIds.push(parent.edgeId);
          collect(parent.previousNodeId);
          reversedNodeIds.pop();
          reversedEdgeIds.pop();
          if (candidates.length > maxPaths) return;
        }
      };

      collect(to.id);
    }
  }

  const truncated = candidates.length > maxPaths;
  const paths = candidates.slice(0, maxPaths);
  const pathNodeIds = uniqueSorted(paths.flatMap((path) => path.nodeIds));
  const pathEdgeIds = uniqueSorted(paths.flatMap((path) => path.edgeIds));
  const payload = buildGraphPayload({
    nodeIds: pathNodeIds.length > 0 ? pathNodeIds : [from.id, to.id],
    edgeIds: pathEdgeIds,
    focusEntityIds: uniqueSorted([from.id, to.id]),
  });
  const shortest = paths[0]?.hops;

  return {
    ...payload,
    fromId: from.id,
    toId: to.id,
    direction,
    maxHops,
    maxPaths,
    paths,
    summary: shortest === undefined
      ? `No ${direction} path from ${from.name} to ${to.name} was found within ${maxHops} hops.`
      : `${truncated ? `Showing ${paths.length}` : `Found ${paths.length}`} shortest ${direction} path${paths.length === 1 ? "" : "s"} from ${from.name} to ${to.name} in ${shortest} hop${shortest === 1 ? "" : "s"}.`,
    truncated,
  };
}

export function explainRelation(input: ExplainRelationInput): ExplainRelationResult {
  const edge = requireEdge(input.edgeId, "edgeId");
  const evidenceLimit = requireInteger(input.evidenceLimit ?? 5, "evidenceLimit", 1, 20);
  const source = requireNode(edge.source);
  const target = requireNode(edge.target);
  const evidence = evidenceForEdges([edge]).slice(0, evidenceLimit);
  const direction = edge.directed ? "to" : "with";

  return {
    edge: toGraphEdge(edge),
    nodes: [toGraphNode(source), toGraphNode(target)],
    evidence,
    summary: `${source.name} has a ${edge.kind} relationship ${direction} ${target.name}: ${edge.label}. The claim is ${edge.status} with ${Math.round(edge.confidence * 100)}% extraction confidence and ${evidence.length} evidence reference${evidence.length === 1 ? "" : "s"}.`,
  };
}
