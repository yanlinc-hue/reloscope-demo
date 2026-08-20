import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  buildGraphPayload,
  explainRelation,
  findShortestPaths,
  getNeighborhood,
  searchEntities,
} from "./graph-query.js";

const SERVER_NAME = "reloscope";
const SERVER_VERSION = "0.1.0";

export const UI_RESOURCE_URI = "ui://reloscope/graph-v1.html";

export interface CreateReloscopeServerOptions {
  widgetHtml: string;
  widgetDomain?: string;
}

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const graphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  subtitle: z.string(),
  summary: z.string(),
  metric: z.string(),
  risk: z.string(),
  status: z.string(),
  sourceIds: z.array(z.string()),
  position: positionSchema,
});

const graphEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  kind: z.string(),
  label: z.string(),
  weight: z.number(),
  status: z.string(),
  evidenceIds: z.array(z.string()),
  confidence: z.number(),
  directed: z.boolean(),
});

const graphEvidenceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  date: z.string(),
  type: z.string(),
  sourceSummary: z.string(),
  excerpt: z.string(),
  location: z.string(),
  confidence: z.number(),
  status: z.enum(["verified", "review"]),
});

const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const selectionSchema = z.object({
  entityIds: z.array(z.string()),
  relationIds: z.array(z.string()),
});

const graphPayloadShape = {
  mode: z.enum(["replace", "merge"]),
  graph: graphSchema,
  evidence: z.array(graphEvidenceSchema),
  summary: z.string(),
  selection: selectionSchema,
  truncated: z.boolean(),
};

const directionSchema = z.enum(["incoming", "outgoing", "both"]);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function success<T extends Record<string, unknown>>(
  structuredContent: T,
  text: string,
) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown graph query error";

  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: `Reloscope could not complete the query: ${message}`,
      },
    ],
  };
}

export function createReloscopeServer({
  widgetHtml,
  widgetDomain,
}: CreateReloscopeServerOptions) {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const widgetUiMeta = {
    prefersBorder: true,
    csp: {
      connectDomains: [] as string[],
      resourceDomains: [] as string[],
    },
    ...(widgetDomain ? { domain: widgetDomain } : {}),
  };

  registerAppResource(
    server,
    "Reloscope relationship graph",
    UI_RESOURCE_URI,
    {
      title: "Reloscope relationship graph",
      description: "Interactive relationship graph for the current Reloscope analysis.",
      _meta: { ui: widgetUiMeta },
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: { ui: widgetUiMeta },
        },
      ],
    }),
  );

  server.registerTool(
    "search_entities",
    {
      title: "Search entities",
      description:
        "Search the Reloscope dataset for stable entity IDs before querying relationships. This is read-only and does not render a graph.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        kinds: z.array(z.string().trim().min(1)).max(20).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
      outputSchema: {
        matches: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            kind: z.string(),
            subtitle: z.string(),
            score: z.number(),
          }),
        ),
      },
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = searchEntities(input);
        const text = result.matches.length
          ? result.matches
              .map((match) => `- ${match.label} (${match.id}; ${match.kind})`)
              .join("\n")
          : `No entities matched “${input.query}”.`;

        return success(result, text);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_neighborhood",
    {
      title: "Get entity neighborhood",
      description:
        "Return a bounded relationship neighborhood around one stable entity ID. This is read-only and does not render a graph.",
      inputSchema: {
        rootId: z.string().trim().min(1),
        depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
        direction: directionSchema.default("both"),
        edgeKinds: z.array(z.string().trim().min(1)).max(20).optional(),
        maxNodes: z.number().int().min(1).max(100).default(40),
      },
      outputSchema: {
        ...graphPayloadShape,
        rootId: z.string(),
        depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        direction: directionSchema,
        distances: z.record(z.string(), z.number()),
      },
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = getNeighborhood(input);
        return success(
          result,
          `${result.summary} Returned ${result.graph.nodes.length} entities and ${result.graph.edges.length} relationships.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "find_relationship_paths",
    {
      title: "Find relationship paths",
      description:
        "Find bounded shortest relationship paths between two stable entity IDs. This is read-only and does not render a graph.",
      inputSchema: {
        fromId: z.string().trim().min(1),
        toId: z.string().trim().min(1),
        maxHops: z.number().int().min(1).max(6).default(6),
        maxPaths: z.number().int().min(1).max(10).default(5),
        direction: directionSchema.default("both"),
      },
      outputSchema: {
        ...graphPayloadShape,
        fromId: z.string(),
        toId: z.string(),
        direction: directionSchema,
        maxHops: z.number().int(),
        maxPaths: z.number().int(),
        paths: z.array(
          z.object({
            nodeIds: z.array(z.string()),
            edgeIds: z.array(z.string()),
            hops: z.number().int(),
          }),
        ),
      },
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = findShortestPaths(input);
        return success(
          result,
          result.paths.length
            ? `${result.summary} Found ${result.paths.length} path${result.paths.length === 1 ? "" : "s"}.`
            : `No relationship path was found between ${input.fromId} and ${input.toId} within ${input.maxHops} hops.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "explain_relationship",
    {
      title: "Explain relationship",
      description:
        "Explain one relationship by its stable edge ID and return its supporting evidence. This is read-only and does not render a graph.",
      inputSchema: {
        edgeId: z.string().trim().min(1),
        evidenceLimit: z.number().int().min(1).max(20).default(5),
      },
      outputSchema: {
        edge: graphEdgeSchema,
        nodes: z.array(graphNodeSchema),
        evidence: z.array(graphEvidenceSchema),
        summary: z.string(),
      },
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = explainRelation(input);
        return success(result, result.summary);
      } catch (error) {
        return failure(error);
      }
    },
  );

  registerAppTool(
    server,
    "render_relationship_graph",
    {
      title: "Render relationship graph",
      description:
        "Render selected Reloscope entities and relationships as an interactive graph. Use data tools first to identify stable IDs.",
      inputSchema: {
        nodeIds: z.array(z.string().trim().min(1)).max(100).optional(),
        edgeIds: z.array(z.string().trim().min(1)).max(150).optional(),
        focusEntityIds: z.array(z.string().trim().min(1)).max(20).optional(),
        focusRelationIds: z.array(z.string().trim().min(1)).max(20).optional(),
      },
      outputSchema: graphPayloadShape,
      annotations: readOnlyAnnotations,
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
        },
      },
    },
    async (input) => {
      try {
        const result = buildGraphPayload({ ...input, mode: "replace" });
        return success(
          result,
          `${result.summary} Rendering ${result.graph.nodes.length} entities and ${result.graph.edges.length} relationships.`,
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
