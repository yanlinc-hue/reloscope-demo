import { z } from "zod";

import {
  GraphQueryError,
  type GraphEdge,
  type GraphEvidence,
  type GraphNode,
  type GraphPayload,
} from "./graph-query.js";

export const CUSTOM_GRAPH_LIMITS = {
  nodes: 100,
  edges: 150,
  evidence: 150,
  focusIds: 20,
  sourceIdsPerNode: 20,
  evidenceIdsPerEdge: 20,
} as const;

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const KIND_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const RAW_HTML_DELIMITER_PATTERN = /[<>]/;

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 127 || (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13);
  });
}

function plainText(minimum: number, maximum: number) {
  return z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !hasControlCharacter(value), {
      message: "must not contain control characters",
    })
    .refine((value) => !RAW_HTML_DELIMITER_PATTERN.test(value), {
      message: "must be plain text and must not contain raw HTML delimiters",
    });
}

const stableIdSchema = z
  .string()
  .trim()
  .regex(
    STABLE_ID_PATTERN,
    "must be a stable 1-64 character ASCII ID using letters, numbers, dot, underscore, colon, or hyphen",
  );

const kindSchema = z
  .string()
  .trim()
  .regex(KIND_PATTERN, "must be a 1-40 character ASCII kind slug")
  .transform((value) => value.toLowerCase());

const boundedScoreSchema = z.number().finite().min(0).max(1);
const boundedCoordinateSchema = z.number().finite().min(-10_000).max(10_000);

const customPositionSchema = z.strictObject({
  x: boundedCoordinateSchema,
  y: boundedCoordinateSchema,
  z: boundedCoordinateSchema,
});

export const customGraphNodeSchema = z.strictObject({
  id: stableIdSchema,
  label: plainText(1, 200),
  kind: kindSchema.default("other"),
  subtitle: plainText(0, 300).default(""),
  summary: plainText(0, 1_000).default(""),
  metric: plainText(0, 200).default(""),
  risk: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
  status: z.enum(["verified", "review", "planned"]).default("review"),
  sourceIds: z
    .array(stableIdSchema)
    .max(CUSTOM_GRAPH_LIMITS.sourceIdsPerNode)
    .default([]),
  position: customPositionSchema.optional(),
});

export const customGraphEdgeSchema = z.strictObject({
  id: stableIdSchema,
  sourceId: stableIdSchema,
  targetId: stableIdSchema,
  kind: kindSchema,
  label: plainText(1, 200),
  weight: boundedScoreSchema.default(0.5),
  status: z.enum(["verified", "review"]).default("review"),
  evidenceIds: z
    .array(stableIdSchema)
    .max(CUSTOM_GRAPH_LIMITS.evidenceIdsPerEdge)
    .default([]),
  confidence: boundedScoreSchema.optional(),
  directed: z.boolean().default(true),
});

export const customGraphEvidenceSchema = z.strictObject({
  id: stableIdSchema,
  sourceId: stableIdSchema,
  title: plainText(1, 300),
  date: plainText(0, 32).default(""),
  type: plainText(0, 80).default("Source"),
  sourceSummary: plainText(0, 2_000).default(""),
  excerpt: plainText(1, 2_000),
  location: plainText(0, 200).default(""),
  confidence: boundedScoreSchema.optional(),
  status: z.enum(["verified", "review"]).default("review"),
});

export const customGraphInputSchema = z.strictObject({
  graph: z.strictObject({
    nodes: z.array(customGraphNodeSchema).min(1).max(CUSTOM_GRAPH_LIMITS.nodes)
      .describe("Entities explicitly supported by the current conversation."),
    edges: z.array(customGraphEdgeSchema).max(CUSTOM_GRAPH_LIMITS.edges)
      .describe("Relationships explicitly supported by the current conversation."),
  }),
  evidence: z
    .array(customGraphEvidenceSchema)
    .max(CUSTOM_GRAPH_LIMITS.evidence)
    .default([]),
  graphTitle: plainText(1, 200).optional()
    .describe("Short visible title for this graph."),
  sourceLabel: plainText(1, 200).optional()
    .describe("Short provenance label, such as Current conversation or Uploaded brief."),
  summary: plainText(0, 1_000).optional()
    .describe("Concise factual summary of the supplied graph without adding unsupported claims."),
  focusEntityIds: z
    .array(stableIdSchema)
    .max(CUSTOM_GRAPH_LIMITS.focusIds)
    .default([]),
  focusRelationIds: z
    .array(stableIdSchema)
    .max(CUSTOM_GRAPH_LIMITS.focusIds)
    .default([]),
});

export type CustomGraphInput = z.input<typeof customGraphInputSchema>;

function compareById<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id);
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertUniqueIds(values: readonly { id: string }[], collection: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `${collection} contains duplicate stable ID ${value.id}.`,
      );
    }
    seen.add(value.id);
  }
}

function deterministicPosition(id: string): GraphNode["position"] {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = hash >>> 0;
  const angle = (normalized / 0xffffffff) * Math.PI * 2;
  const radius = 70 + ((normalized >>> 8) % 131);
  const z = ((normalized >>> 16) % 201) - 100;

  return {
    x: Number((Math.cos(angle) * radius).toFixed(4)),
    y: Number((Math.sin(angle) * radius).toFixed(4)),
    z,
  };
}

function invalidInput(error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  return new GraphQueryError(
    "INVALID_ARGUMENT",
    `Invalid user graph${path}: ${issue?.message ?? "input does not match the schema"}.`,
  );
}

/**
 * Normalizes one caller-supplied graph into the existing widget payload shape.
 * This is a pure transformation: it does not read or write server state.
 */
export function buildUserGraphPayload(input: unknown): GraphPayload {
  const parsedResult = customGraphInputSchema.safeParse(input);
  if (!parsedResult.success) throw invalidInput(parsedResult.error);
  const parsed = parsedResult.data;

  assertUniqueIds(parsed.graph.nodes, "graph.nodes");
  assertUniqueIds(parsed.graph.edges, "graph.edges");
  assertUniqueIds(parsed.evidence, "evidence");

  const nodeIds = new Set(parsed.graph.nodes.map((node) => node.id));
  const edgeIds = new Set(parsed.graph.edges.map((edge) => edge.id));
  const evidenceIds = new Set(parsed.evidence.map((record) => record.id));

  for (const edge of parsed.graph.edges) {
    if (!nodeIds.has(edge.sourceId)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Relation ${edge.id} references missing source entity ${edge.sourceId}.`,
      );
    }
    if (!nodeIds.has(edge.targetId)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Relation ${edge.id} references missing target entity ${edge.targetId}.`,
      );
    }
    for (const evidenceId of edge.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new GraphQueryError(
          "INVALID_ARGUMENT",
          `Relation ${edge.id} references missing evidence ${evidenceId}.`,
        );
      }
    }
  }

  const focusEntityIds = uniqueSorted(parsed.focusEntityIds);
  const focusRelationIds = uniqueSorted(parsed.focusRelationIds);
  for (const entityId of focusEntityIds) {
    if (!nodeIds.has(entityId)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Focused entity ${entityId} is not present in the user graph.`,
      );
    }
  }
  for (const relationId of focusRelationIds) {
    if (!edgeIds.has(relationId)) {
      throw new GraphQueryError(
        "INVALID_ARGUMENT",
        `Focused relation ${relationId} is not present in the user graph.`,
      );
    }
  }

  const nodes: GraphNode[] = parsed.graph.nodes
    .map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      subtitle: node.subtitle,
      summary: node.summary,
      metric: node.metric,
      risk: node.risk,
      status: node.status,
      sourceIds: uniqueSorted(node.sourceIds),
      position: node.position ? { ...node.position } : deterministicPosition(node.id),
    }))
    .sort(compareById);

  const edges: GraphEdge[] = parsed.graph.edges
    .map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      kind: edge.kind,
      label: edge.label,
      weight: edge.weight,
      status: edge.status,
      evidenceIds: uniqueSorted(edge.evidenceIds),
      confidence: edge.confidence ?? null,
      directed: edge.directed,
    }))
    .sort(compareById);

  const evidence: GraphEvidence[] = parsed.evidence
    .map((record) => ({ ...record, confidence: record.confidence ?? null }))
    .sort(compareById);

  return {
    mode: "replace",
    graphTitle: parsed.graphTitle ?? "Relationship graph",
    sourceLabel: parsed.sourceLabel ?? "User-provided graph",
    graph: { nodes, edges },
    evidence,
    summary:
      parsed.summary
      ?? `${nodes.length} entities, ${edges.length} relationships, ${evidence.length} evidence claims supplied for this view.`,
    selection: {
      entityIds: focusEntityIds,
      relationIds: focusRelationIds,
    },
    truncated: false,
  };
}
