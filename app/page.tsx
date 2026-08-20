"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEMO_EDGES,
  DEMO_NODES,
  DEMO_SCENES,
  DEMO_SOURCES,
  type DemoEdge,
  type DemoNode,
  type DemoScene,
  type EdgeKind,
  type NodeKind,
} from "./demo-data";
import { buildAgentTurn } from "./agent-demo";

type ViewMode = "2d" | "3d";
type LayoutMode = DemoScene["layout"];
type StudioNode = DemoNode & { pinned?: boolean };
type AccessRole = "Analyst" | "External Counsel" | "Executive Viewer";
type InspectorTab = "entity" | "evidence" | "analysis";

type PlanStatus = "applied" | "preview" | "blocked" | "saved";

type ChatPlan = {
  id: string;
  title: string;
  risk: "R0" | "R1" | "R2";
  status: PlanStatus;
  steps: string[];
  impact: string;
  note?: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "context";
  body: string;
  plan?: ChatPlan;
  evidenceRefs?: string[];
  sceneDrafts?: string[];
};

type PendingAgentAction = {
  id: string;
  kind: "relation-change" | "scene-save";
  title: string;
  description: string;
  sceneDrafts?: Array<Omit<DemoScene, "id">>;
};

type ImportedActiveState = {
  viewMode?: ViewMode;
  layoutMode?: LayoutMode;
  selectedId?: string | null;
  selectedEdgeId?: string | null;
  activeSceneId?: string;
  sceneNodeIds?: string[] | null;
  visibleNodeKinds?: NodeKind[];
  visibleEdgeKinds?: EdgeKind[];
  query?: string;
};

type VisualSnapshot = {
  label: string;
  nodes: StudioNode[];
  viewMode: ViewMode;
  layoutMode: LayoutMode;
  selectedId: string | null;
  selectedEdgeId: string | null;
  activeSceneId: string;
  sceneNodeIds: string[] | null;
  visibleNodeKinds: NodeKind[];
  visibleEdgeKinds: EdgeKind[];
  highlightNodeIds: string[];
};

type CanvasHandle = {
  fit: () => void;
  exportPng: () => void;
  exportSvg: () => void;
};

const NODE_META: Record<NodeKind, { label: string; color: string; short: string }> = {
  company: { label: "Company", color: "#69a7ff", short: "CO" },
  capital: { label: "Capital", color: "#b99cff", short: "CA" },
  government: { label: "Government", color: "#f4bb5f", short: "GV" },
  institution: { label: "Institution", color: "#5bd8db", short: "IN" },
  person: { label: "Key Person", color: "#ff9266", short: "PE" },
  project: { label: "Project", color: "#59d7a0", short: "PR" },
};

const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  supply: { label: "Supply", color: "#62a8ff" },
  capital: { label: "Investment / Equity", color: "#b39af8" },
  governance: { label: "Governance", color: "#ff956b" },
  research: { label: "Joint R&D", color: "#51d2d9" },
  certification: { label: "Certification", color: "#efcd61" },
  support: { label: "Policy Support", color: "#e7a84f" },
  delivery: { label: "Project Delivery", color: "#58d694" },
  circular: { label: "Circular Flow", color: "#55cdbc" },
};

const ALL_NODE_KINDS = Object.keys(NODE_META) as NodeKind[];
const ALL_EDGE_KINDS = Object.keys(EDGE_META) as EdgeKind[];

const AI_SUGGESTIONS = [
  "Identify the three most critical single-source dependencies",
  "Trace the industrial fund's path to both projects",
  "Explain why Lanxin Intelligent Controls is high risk",
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: "M00",
    role: "assistant",
    body: "I can investigate this graph, trace every claim to evidence, and turn the analysis into reusable scenes. Read-only analysis updates the canvas immediately; graph changes are previewed first.",
  },
  {
    id: "M01",
    role: "user",
    body: "Starting from Jichuan Power, expand two hops upstream and show only supply and R&D relationships.",
  },
  {
    id: "M02",
    role: "assistant",
    body: "I expanded Jichuan Power's two-hop upstream network. The current view contains 6 entities and 8 supply or R&D relationships; the three highest-dependency nodes are highlighted.",
    plan: {
      id: "AP-01",
      title: "Upstream dependency investigation",
      risk: "R1",
      status: "applied",
      steps: ["Locate Jichuan Power", "Expand two hops", "Filter supply / R&D", "Apply radial layout"],
      impact: "6 entities · 8 relationships · Undo available",
    },
    evidenceRefs: ["S01-C2", "S03-C1", "S03-C2", "S04-C1"],
  },
];

const QUICK_PROMPTS = [
  "Why is Lanxin Intelligent Controls a high-risk node?",
  "Trace the industrial fund's path to both projects",
  "Turn this analysis into investment committee scenes",
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().trim();
}

function nextSceneIds(scenes: DemoScene[], count: number): string[] {
  const used = new Set(scenes.map((scene) => scene.id));
  const numericIds = scenes
    .map((scene) => /^SC(\d+)$/.exec(scene.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  let candidate = Math.max(0, ...numericIds) + 1;
  const ids: string[] = [];

  while (ids.length < count) {
    const id = "SC" + String(candidate).padStart(2, "0");
    if (!used.has(id)) {
      used.add(id);
      ids.push(id);
    }
    candidate += 1;
  }

  return ids;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function edgeDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(px - ax, py - ay);
  const amount = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + amount * dx), py - (ay + amount * dy));
}

function applyLayout(
  nodes: StudioNode[],
  edges: DemoEdge[],
  mode: LayoutMode,
  rootId?: string,
): StudioNode[] {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const movable = sorted.filter((node) => !node.pinned);
  if (mode === "force") {
    return nodes.map((node) => {
      if (node.pinned) return node;
      const index = movable.findIndex((item) => item.id === node.id);
      const angle = index * 2.399963;
      const radius = 9 + Math.sqrt(index + 1) * 8.3;
      const originalWeight = node.id === "N01" ? 0 : 0.32;
      return {
        ...node,
        x: Math.cos(angle) * radius + node.x * originalWeight,
        y: Math.sin(angle) * radius + node.y * originalWeight,
        z: ((index % 5) - 2) * 4.3 + node.z * 0.2,
      };
    });
  }

  const root = rootId && nodes.some((node) => node.id === rootId) ? rootId : "N01";
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node) => adjacency.set(node.id, []));
  edges.forEach((edge) => {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  });
  const distance = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    const nextDistance = (distance.get(current) ?? 0) + 1;
    (adjacency.get(current) ?? []).sort().forEach((next) => {
      if (!distance.has(next)) {
        distance.set(next, nextDistance);
        queue.push(next);
      }
    });
  }
  sorted.forEach((node) => {
    if (!distance.has(node.id)) distance.set(node.id, 5);
  });

  if (mode === "radial") {
    const rings = new Map<number, StudioNode[]>();
    sorted.forEach((node) => {
      const level = distance.get(node.id) ?? 5;
      rings.set(level, [...(rings.get(level) ?? []), node]);
    });
    const positions = new Map<string, Pick<DemoNode, "x" | "y" | "z">>();
    rings.forEach((ringNodes, level) => {
      ringNodes.forEach((node, index) => {
        if (level === 0) {
          positions.set(node.id, { x: 0, y: 0, z: 0 });
          return;
        }
        const angle = (index / ringNodes.length) * Math.PI * 2 - Math.PI / 2;
        const radius = 18 + level * 19;
        positions.set(node.id, {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          z: ((index % 3) - 1) * 5,
        });
      });
    });
    return nodes.map((node) => node.pinned ? node : { ...node, ...positions.get(node.id)! });
  }

  const columns = new Map<number, StudioNode[]>();
  sorted.forEach((node) => {
    const level = Math.min(distance.get(node.id) ?? 5, 4);
    columns.set(level, [...(columns.get(level) ?? []), node]);
  });
  const positions = new Map<string, Pick<DemoNode, "x" | "y" | "z">>();
  columns.forEach((columnNodes, level) => {
    columnNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: (level - 2) * 32,
        y: (index - (columnNodes.length - 1) / 2) * 18,
        z: ((index % 4) - 1.5) * 3,
      });
    });
  });
  return nodes.map((node) => node.pinned ? node : { ...node, ...positions.get(node.id)! });
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function inferEdgeKind(value: string): EdgeKind {
  if (/投资|持股|基金|invest|equity|fund/i.test(value)) return "capital";
  if (/任职|治理|董事|管理|govern|director|manage/i.test(value)) return "governance";
  if (/研发|专利|联合开发|research|patent|r&d/i.test(value)) return "research";
  if (/认证|验收|检测|certif|acceptance|test/i.test(value)) return "certification";
  if (/政策|专项|支持|policy|grant|support/i.test(value)) return "support";
  if (/交付|项目|配套|deliver|project/i.test(value)) return "delivery";
  if (/回收|再生|循环|recycl|circular/i.test(value)) return "circular";
  return "supply";
}

function parseImportedGraph(filename: string, text: string) {
  if (filename.toLowerCase().endsWith(".json")) {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const graph = payload.graph && typeof payload.graph === "object" ? payload.graph as Record<string, unknown> : payload;
    if (!Array.isArray(graph.nodes)) throw new Error("JSON is missing a nodes array");
    const rawEdges = Array.isArray(graph.edges)
      ? graph.edges
      : Array.isArray(graph.relations)
        ? graph.relations
        : null;
    if (!rawEdges) throw new Error("JSON is missing an edges or relations array");
    const nodes: StudioNode[] = graph.nodes.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const name = String(item.name ?? item.label ?? "").trim();
      if (!name) throw new Error("Node " + (index + 1) + " is missing name/label");
      const kind = ALL_NODE_KINDS.includes(item.kind as NodeKind) ? item.kind as NodeKind : "company";
      return {
        id: String(item.id ?? "N-" + stableHash(name)),
        name,
        kind,
        subtitle: String(item.subtitle ?? item.role ?? "Imported entity"),
        x: Number.isFinite(Number(item.x)) ? Number(item.x) : Math.cos(index * 2.4) * (18 + index * 1.5),
        y: Number.isFinite(Number(item.y)) ? Number(item.y) : Math.sin(index * 2.4) * (18 + index * 1.5),
        z: Number.isFinite(Number(item.z)) ? Number(item.z) : (index % 5) * 2,
        summary: String(item.summary ?? "Entity imported from a local file."),
        metric: String(item.metric ?? "LOCAL IMPORT"),
        risk: ["high", "medium", "low"].includes(String(item.risk)) ? item.risk as DemoNode["risk"] : "medium",
        status: ["verified", "review", "planned"].includes(String(item.status)) ? item.status as DemoNode["status"] : "review",
        sources: Array.isArray(item.sources) ? item.sources.map(String) : ["LOCAL"],
        pinned: item.pinned === true,
      };
    });
    const ids = new Set(nodes.map((node) => node.id));
    const edges: DemoEdge[] = rawEdges.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const source = String(item.source ?? "");
      const target = String(item.target ?? "");
      if (!ids.has(source) || !ids.has(target)) {
        throw new Error("Relationship " + (index + 1) + " points to a missing node");
      }
      const label = String(item.label ?? item.relation ?? "Related to");
      const kind = ALL_EDGE_KINDS.includes(item.kind as EdgeKind)
        ? item.kind as EdgeKind
        : inferEdgeKind(label);
      return {
        id: String(item.id ?? "E-" + stableHash(source + target + label)),
        source,
        target,
        kind,
        label,
        weight: Math.max(0.1, Math.min(1, Number(item.weight ?? 0.6))),
        status: item.status === "verified" ? "verified" : "review",
        evidenceId: String(item.evidenceId ?? "LOCAL-" + (index + 1)),
        evidence: String(item.evidence ?? "No evidence excerpt was provided in the imported file."),
        sourceTitle: String(item.sourceTitle ?? filename),
        location: String(item.location ?? "Local import"),
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
        directed: item.directed !== false && item.directed !== "false",
      };
    });
    const edgeIds = new Set(edges.map((edge) => edge.id));
    const seenSceneIds = new Set<string>();
    const scenes: DemoScene[] = Array.isArray(payload.scenes)
      ? payload.scenes.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const id = String(item.id ?? "").trim();
        const selectedId = String(item.selectedId ?? "").trim();
        if (!id || seenSceneIds.has(id) || !ids.has(selectedId)) return [];
        seenSceneIds.add(id);
        const layout = ["force", "radial", "layered"].includes(String(item.layout))
          ? item.layout as LayoutMode
          : "force";
        const viewMode = ["2d", "3d"].includes(String(item.viewMode))
          ? item.viewMode as ViewMode
          : undefined;
        const selectedEdgeId = edgeIds.has(String(item.selectedEdgeId))
          ? String(item.selectedEdgeId)
          : undefined;
        const visibleNodes = Array.isArray(item.visibleNodes)
          ? item.visibleNodes.map(String).filter((nodeId) => ids.has(nodeId))
          : undefined;
        const visibleKinds = Array.isArray(item.visibleKinds)
          ? item.visibleKinds.filter((kind): kind is EdgeKind => ALL_EDGE_KINDS.includes(kind as EdgeKind))
          : undefined;
        return [{
          id,
          title: String(item.title ?? id),
          subtitle: String(item.subtitle ?? "Imported project scene"),
          viewMode,
          layout,
          selectedId,
          selectedEdgeId,
          visibleNodes,
          visibleKinds,
          callout: String(item.callout ?? "Imported project scene."),
        }];
      })
      : [];

    const rawActiveState = payload.activeState && typeof payload.activeState === "object"
      ? payload.activeState as Record<string, unknown>
      : null;
    const activeState: ImportedActiveState | null = rawActiveState
      ? {
        viewMode: ["2d", "3d"].includes(String(rawActiveState.viewMode)) ? rawActiveState.viewMode as ViewMode : undefined,
        layoutMode: ["force", "radial", "layered"].includes(String(rawActiveState.layoutMode)) ? rawActiveState.layoutMode as LayoutMode : undefined,
        selectedId: ids.has(String(rawActiveState.selectedId)) ? String(rawActiveState.selectedId) : null,
        selectedEdgeId: edgeIds.has(String(rawActiveState.selectedEdgeId)) ? String(rawActiveState.selectedEdgeId) : null,
        activeSceneId: seenSceneIds.has(String(rawActiveState.activeSceneId)) ? String(rawActiveState.activeSceneId) : "",
        sceneNodeIds: Array.isArray(rawActiveState.sceneNodeIds)
          ? rawActiveState.sceneNodeIds.map(String).filter((nodeId) => ids.has(nodeId))
          : null,
        visibleNodeKinds: Array.isArray(rawActiveState.visibleNodeKinds)
          ? rawActiveState.visibleNodeKinds.filter((kind): kind is NodeKind => ALL_NODE_KINDS.includes(kind as NodeKind))
          : undefined,
        visibleEdgeKinds: Array.isArray(rawActiveState.visibleEdgeKinds)
          ? rawActiveState.visibleEdgeKinds.filter((kind): kind is EdgeKind => ALL_EDGE_KINDS.includes(kind as EdgeKind))
          : undefined,
        query: typeof rawActiveState.query === "string" ? rawActiveState.query : "",
      }
      : null;

    return {
      nodes,
      edges,
      scenes,
      activeState,
      isProject: payload.kind === "relationship-studio-project",
    };
  }

  const table = parseCsv(text);
  if (table.length < 2) throw new Error("CSV requires a header and at least one relationship");
  const headers = table[0].map((value) => normalize(value));
  const column = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";
  if (!headers.includes("source_label") || !headers.includes("target_label")) {
    throw new Error("CSV requires source_label and target_label columns");
  }
  const nodeById = new Map<string, StudioNode>();
  const edges: DemoEdge[] = [];
  table.slice(1).filter((row) => row.some(Boolean)).forEach((row, index) => {
    const sourceName = column(row, "source_label").trim();
    const targetName = column(row, "target_label").trim();
    if (!sourceName || !targetName) throw new Error("CSV row " + (index + 2) + " is missing an entity name");
    const source = column(row, "source_id").trim() || "N-" + stableHash(sourceName);
    const target = column(row, "target_id").trim() || "N-" + stableHash(targetName);
    [source, target].forEach((id, nodeIndex) => {
      if (!nodeById.has(id)) {
        const name = nodeIndex === 0 ? sourceName : targetName;
        const count = nodeById.size;
        nodeById.set(id, {
          id,
          name,
          kind: "company",
          subtitle: "CSV imported entity",
          x: Math.cos(count * 2.4) * (18 + count * 2),
          y: Math.sin(count * 2.4) * (18 + count * 2),
          z: ((count % 5) - 2) * 3,
          summary: "Generated from a local CSV relationship table.",
          metric: "LOCAL IMPORT",
          risk: "medium",
          status: "review",
          sources: ["LOCAL"],
        });
      }
    });
    const label = column(row, "relation").trim() || "Related to";
    edges.push({
      id: "E-" + stableHash(source + target + label + index),
      source,
      target,
      kind: inferEdgeKind(label),
      label,
      weight: 0.62,
      status: "review",
      evidenceId: "LOCAL-" + (index + 1),
      evidence: column(row, "evidence") || "No evidence excerpt was provided in the imported file.",
      sourceTitle: filename,
      location: "CSV row " + (index + 2),
      confidence: Math.max(0, Math.min(1, Number(column(row, "confidence") || 0.7))),
      directed: column(row, "directed").toLowerCase() !== "false",
    });
  });
  return { nodes: [...nodeById.values()], edges, scenes: [], activeState: null, isProject: false };
}

type CanvasProps = {
  nodes: StudioNode[];
  edges: DemoEdge[];
  mode: ViewMode;
  selectedId: string | null;
  selectedEdgeId: string | null;
  searchHits: Set<string>;
  resetKey: number;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onMoveNode: (id: string, position: Pick<DemoNode, "x" | "y" | "z">) => void;
};

const RelationshipCanvas = forwardRef<CanvasHandle, CanvasProps>(function RelationshipCanvas(
  {
    nodes,
    edges,
    mode,
    selectedId,
    selectedEdgeId,
    searchHits,
    resetKey,
    onSelectNode,
    onSelectEdge,
    onMoveNode,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({
    "2d": { zoom: 1, panX: 0, panY: 0, rx: 0, ry: 0 },
    "3d": { zoom: 1, panX: 0, panY: 0, rx: -0.2, ry: 0.38 },
  });
  const modeRef = useRef<ViewMode>(mode);
  const drawRef = useRef<() => void>(() => undefined);
  const projectionRef = useRef(new Map<string, { x: number; y: number; r: number; depth: number }>());
  const dimensionsRef = useRef({ width: 1200, height: 760 });
  const dataRef = useRef({ nodes, edges });

  useEffect(() => {
    modeRef.current = mode;
    drawRef.current();
  }, [mode]);

  useEffect(() => {
    dataRef.current = { nodes, edges };
  }, [nodes, edges]);

  useEffect(() => {
    viewRef.current[modeRef.current] = modeRef.current === "2d"
      ? { zoom: 1, panX: 0, panY: 0, rx: 0, ry: 0 }
      : { zoom: 1, panX: 0, panY: 0, rx: -0.2, ry: 0.38 };
    drawRef.current();
  }, [resetKey]);

  useImperativeHandle(ref, () => ({
    fit() {
      viewRef.current[modeRef.current] = modeRef.current === "2d"
        ? { zoom: 1, panX: 0, panY: 0, rx: 0, ry: 0 }
        : { zoom: 1, panX: 0, panY: 0, rx: -0.2, ry: 0.38 };
      drawRef.current();
    },
    exportPng() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, "donglan-relationship-scene.png");
      }, "image/png");
    },
    exportSvg() {
      const { width, height } = dimensionsRef.current;
      const points = projectionRef.current;
      const current = dataRef.current;
      const lines = current.edges.map((edge) => {
        const source = points.get(edge.source);
        const target = points.get(edge.target);
        if (!source || !target) return "";
        const color = EDGE_META[edge.kind]?.color ?? "#72808c";
        const dash = edge.status === "review" ? ' stroke-dasharray="6 5"' : "";
        return '<line x1="' + source.x.toFixed(1) + '" y1="' + source.y.toFixed(1) + '" x2="' + target.x.toFixed(1) + '" y2="' + target.y.toFixed(1) + '" stroke="' + color + '" stroke-opacity=".65" stroke-width="' + (1 + edge.weight * 2).toFixed(1) + '"' + dash + ' />';
      }).join("");
      const circles = current.nodes.map((node) => {
        const point = points.get(node.id);
        if (!point) return "";
        const color = NODE_META[node.kind]?.color ?? "#79a7c8";
        return '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + Math.max(5, point.r).toFixed(1) + '" fill="' + color + '" stroke="#e8f0ee" stroke-opacity=".7" /><text x="' + point.x.toFixed(1) + '" y="' + (point.y + point.r + 16).toFixed(1) + '" fill="#e8f0ee" text-anchor="middle" font-family="Arial, PingFang SC, sans-serif" font-size="11">' + escapeXml(node.name) + "</text>";
      }).join("");
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '"><rect width="100%" height="100%" fill="#05080c"/>' + lines + circles + '<text x="24" y="' + (height - 24) + '" fill="#5f6c72" font-family="monospace" font-size="10">SYNTHETIC DATA · DEMO ONLY</text></svg>';
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "donglan-relationship-scene.svg");
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let width = 0;
    let height = 0;
    let animation = 0;
    let hoverId: string | null = null;
    let hoverEdgeId: string | null = null;
    let interaction: {
      kind: "node" | "view";
      id?: string;
      edgeId?: string;
      px: number;
      py: number;
      shift: boolean;
      moved: boolean;
    } | null = null;
    let workingNodes = nodes.map((node) => ({ ...node }));
    const degree = new Map<string, number>();
    edges.forEach((edge) => {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    });

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      dimensionsRef.current = { width, height };
      invalidate();
    };

    const project = (node: StudioNode) => {
      const view = viewRef.current[mode];
      const worldScale = Math.max(3.25, Math.min(6.2, Math.min(width, height) / 118)) * view.zoom;
      if (mode === "2d") {
        return {
          x: width / 2 + view.panX + node.x * worldScale,
          y: height / 2 + view.panY + node.y * worldScale,
          depth: 0,
          scale: view.zoom,
        };
      }
      const cy = Math.cos(view.ry);
      const sy = Math.sin(view.ry);
      const cx = Math.cos(view.rx);
      const sx = Math.sin(view.rx);
      const x1 = node.x * cy - node.z * sy;
      const z1 = node.x * sy + node.z * cy;
      const y1 = node.y * cx - z1 * sx;
      const z2 = node.y * sx + z1 * cx;
      const perspective = 390 / Math.max(180, 390 + z2 * 2.1);
      return {
        x: width / 2 + view.panX + x1 * worldScale * perspective,
        y: height / 2 + view.panY + y1 * worldScale * perspective,
        depth: z2,
        scale: perspective * view.zoom,
      };
    };

    const pathNode = (node: StudioNode, x: number, y: number, radius: number) => {
      context.beginPath();
      if (node.kind === "capital") {
        context.moveTo(x, y - radius);
        context.lineTo(x + radius, y);
        context.lineTo(x, y + radius);
        context.lineTo(x - radius, y);
        context.closePath();
      } else if (node.kind === "institution") {
        context.rect(x - radius * 0.8, y - radius * 0.8, radius * 1.6, radius * 1.6);
      } else if (node.kind === "government") {
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI / 3 - Math.PI / 2;
          const px = x + Math.cos(angle) * radius;
          const py = y + Math.sin(angle) * radius;
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
      } else if (node.kind === "project") {
        context.roundRect(x - radius * 1.05, y - radius * 0.72, radius * 2.1, radius * 1.44, 4);
      } else {
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    };

    const drawArrow = (
      source: { x: number; y: number },
      target: { x: number; y: number; r: number },
      color: string,
    ) => {
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const tipX = target.x - Math.cos(angle) * (target.r + 4);
      const tipY = target.y - Math.sin(angle) * (target.r + 4);
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(tipX - Math.cos(angle - 0.55) * 6, tipY - Math.sin(angle - 0.55) * 6);
      context.lineTo(tipX - Math.cos(angle + 0.55) * 6, tipY - Math.sin(angle + 0.55) * 6);
      context.closePath();
      context.fillStyle = color;
      context.fill();
    };

    const draw = () => {
      animation = 0;
      context.clearRect(0, 0, width, height);
      const gradient = context.createRadialGradient(width * 0.52, height * 0.46, 10, width * 0.52, height * 0.46, Math.max(width, height) * 0.72);
      gradient.addColorStop(0, mode === "3d" ? "#101b25" : "#0c151d");
      gradient.addColorStop(0.58, "#070c12");
      gradient.addColorStop(1, "#030609");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      if (mode === "2d") {
        context.strokeStyle = "rgba(141,174,191,.055)";
        context.lineWidth = 1;
        const size = 34;
        for (let x = (viewRef.current["2d"].panX % size); x < width; x += size) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, height);
          context.stroke();
        }
        for (let y = (viewRef.current["2d"].panY % size); y < height; y += size) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
      } else {
        for (let index = 0; index < 95; index += 1) {
          const x = (index * 83.17) % width;
          const y = (index * index * 19.31) % height;
          context.fillStyle = "rgba(207,230,236," + (0.08 + (index % 7) * 0.018) + ")";
          context.fillRect(x, y, index % 9 === 0 ? 1.2 : 0.65, index % 9 === 0 ? 1.2 : 0.65);
        }
      }

      const points = new Map<string, { x: number; y: number; r: number; depth: number; scale: number }>();
      workingNodes.forEach((node) => {
        const point = project(node);
        const radius = Math.max(7, Math.min(17, 7.2 + Math.sqrt(degree.get(node.id) ?? 1) * 1.8)) * Math.max(0.72, point.scale);
        points.set(node.id, { ...point, r: radius });
      });
      projectionRef.current = points;
      dataRef.current = { nodes: workingNodes, edges };

      const drawnEdges = edges
        .map((edge) => ({ edge, source: points.get(edge.source), target: points.get(edge.target) }))
        .filter((item): item is { edge: DemoEdge; source: NonNullable<typeof item.source>; target: NonNullable<typeof item.target> } => Boolean(item.source && item.target))
        .sort((a, b) => ((b.source.depth + b.target.depth) / 2) - ((a.source.depth + a.target.depth) / 2));

      drawnEdges.forEach(({ edge, source, target }) => {
        const active = edge.id === selectedEdgeId || edge.id === hoverEdgeId || selectedId === edge.source || selectedId === edge.target;
        const color = EDGE_META[edge.kind].color;
        context.save();
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.strokeStyle = color;
        context.globalAlpha = active ? 0.92 : 0.34;
        context.lineWidth = (active ? 1.6 : 0.7) + edge.weight * 1.7;
        if (edge.status === "review") context.setLineDash([7, 6]);
        context.stroke();
        context.restore();
        if (edge.directed) drawArrow(source, target, color + (active ? "dd" : "77"));

        if (active) {
          const mx = (source.x + target.x) / 2;
          const my = (source.y + target.y) / 2;
          context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
          const labelWidth = context.measureText(edge.label).width;
          context.fillStyle = "rgba(4,8,12,.88)";
          context.fillRect(mx - labelWidth / 2 - 7, my - 9, labelWidth + 14, 18);
          context.strokeStyle = color + "66";
          context.strokeRect(mx - labelWidth / 2 - 7, my - 9, labelWidth + 14, 18);
          context.fillStyle = color;
          context.textAlign = "center";
          context.fillText(edge.label, mx, my + 3);
        }
      });

      [...workingNodes]
        .sort((a, b) => (points.get(b.id)?.depth ?? 0) - (points.get(a.id)?.depth ?? 0))
        .forEach((node) => {
          const point = points.get(node.id)!;
          const color = NODE_META[node.kind].color;
          const selected = selectedId === node.id;
          const hovered = hoverId === node.id;
          const found = searchHits.size === 0 || searchHits.has(node.id);
          const active = selected || hovered;
          context.save();
          context.globalAlpha = found ? 1 : 0.16;
          const glow = context.createRadialGradient(point.x, point.y, 1, point.x, point.y, point.r * (active ? 3.5 : 2.2));
          glow.addColorStop(0, color + (active ? "78" : "3b"));
          glow.addColorStop(1, color + "00");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, point.r * (active ? 3.5 : 2.2), 0, Math.PI * 2);
          context.fill();

          if (active) {
            context.strokeStyle = color + "aa";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(point.x, point.y, point.r + 6, 0, Math.PI * 2);
            context.stroke();
          }
          pathNode(node, point.x, point.y, point.r);
          context.fillStyle = color;
          context.fill();
          context.strokeStyle = "rgba(246,251,250,.78)";
          context.lineWidth = selected ? 1.6 : 0.8;
          context.stroke();

          if (node.status === "review" || node.status === "planned") {
            context.fillStyle = node.status === "review" ? "#f4c361" : "#8d9aa3";
            context.beginPath();
            context.arc(point.x + point.r * 0.72, point.y - point.r * 0.72, 3.2, 0, Math.PI * 2);
            context.fill();
          }
          if (node.pinned) {
            context.fillStyle = "#f5f8f7";
            context.fillRect(point.x - 1.5, point.y - point.r - 6, 3, 4);
          }

          if (workingNodes.length <= 28 || active || searchHits.has(node.id)) {
            context.fillStyle = "#eaf1ef";
            context.font = (selected ? "650 " : "550 ") + (active ? "12px" : "11px") + " system-ui, PingFang SC, sans-serif";
            context.textAlign = "center";
            context.fillText(node.name, point.x, point.y + point.r + 17);
            if (active) {
              context.fillStyle = "rgba(190,205,208,.58)";
              context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
              context.fillText(NODE_META[node.kind].label.toUpperCase() + " · " + node.id, point.x, point.y + point.r + 31);
            }
          }
          context.restore();
        });

      context.fillStyle = "rgba(127,144,151,.38)";
      context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "left";
      context.fillText("SYNTHETIC DATA · DEMO ONLY", 18, height - 18);
    };

    const invalidate = () => {
      if (!animation) animation = requestAnimationFrame(draw);
    };
    drawRef.current = invalidate;

    const localPoint = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const hitNode = (event: PointerEvent) => {
      const point = localPoint(event);
      return [...projectionRef.current.entries()]
        .sort((a, b) => a[1].depth - b[1].depth)
        .find(([, projected]) => Math.hypot(projected.x - point.x, projected.y - point.y) <= Math.max(14, projected.r + 4));
    };

    const hitEdge = (event: PointerEvent) => {
      const point = localPoint(event);
      const candidates = edges.flatMap((edge) => {
        const source = projectionRef.current.get(edge.source);
        const target = projectionRef.current.get(edge.target);
        return source && target
          ? [{ edge, source, target, depth: (source.depth + target.depth) / 2 }]
          : [];
      });
      return candidates
        .sort((a, b) => a.depth - b.depth)
        .find(({ source, target }) => edgeDistance(point.x, point.y, source.x, source.y, target.x, target.y) < 7)
        ?.edge;
    };

    const pointerDown = (event: PointerEvent) => {
      const nodeHit = hitNode(event);
      const edgeHit = !nodeHit ? hitEdge(event) : undefined;
      interaction = {
        kind: nodeHit ? "node" : "view",
        id: nodeHit?.[0],
        edgeId: edgeHit?.id,
        px: event.clientX,
        py: event.clientY,
        shift: event.shiftKey || event.button === 2,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = nodeHit ? "move" : "grabbing";
    };

    const pointerMove = (event: PointerEvent) => {
      if (!interaction) {
        hoverId = hitNode(event)?.[0] ?? null;
        hoverEdgeId = hoverId ? null : hitEdge(event)?.id ?? null;
        canvas.style.cursor = hoverId ? "pointer" : hoverEdgeId ? "crosshair" : "grab";
        invalidate();
        return;
      }
      const dx = event.clientX - interaction.px;
      const dy = event.clientY - interaction.py;
      if (Math.abs(dx) + Math.abs(dy) > 1) interaction.moved = true;
      const view = viewRef.current[mode];
      if (interaction.kind === "node" && interaction.id) {
        const worldScale = Math.max(3.25, Math.min(6.2, Math.min(width, height) / 118)) * view.zoom;
        workingNodes = workingNodes.map((node) => node.id === interaction?.id
          ? { ...node, x: node.x + dx / worldScale, y: node.y + dy / worldScale, pinned: true }
          : node);
      } else if (mode === "2d" || interaction.shift) {
        view.panX += dx;
        view.panY += dy;
      } else {
        view.ry += dx * 0.006;
        view.rx = Math.max(-1.1, Math.min(1.1, view.rx + dy * 0.006));
      }
      interaction.px = event.clientX;
      interaction.py = event.clientY;
      invalidate();
    };

    const pointerUp = () => {
      const completed = interaction;
      if (completed?.kind === "node" && completed.id) {
        if (completed.moved) {
          const node = workingNodes.find((item) => item.id === completed.id);
          if (node) onMoveNode(node.id, { x: node.x, y: node.y, z: node.z });
        } else {
          onSelectNode(completed.id);
        }
      } else if (completed?.edgeId && !completed.moved) {
        onSelectEdge(completed.edgeId);
      }
      interaction = null;
      canvas.style.cursor = hoverId ? "pointer" : hoverEdgeId ? "crosshair" : "grab";
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current[mode];
      view.zoom = Math.max(0.45, Math.min(3.2, view.zoom * (event.deltaY > 0 ? 0.91 : 1.1)));
      invalidate();
    };

    const preventContextMenu = (event: MouseEvent) => event.preventDefault();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("lostpointercapture", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", preventContextMenu);
    resize();

    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("lostpointercapture", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", preventContextMenu);
    };
  }, [nodes, edges, mode, selectedId, selectedEdgeId, searchHits, onMoveNode, onSelectEdge, onSelectNode]);

  return (
    <canvas
      ref={canvasRef}
      className="relationship-canvas"
      aria-label="Interactive relationship graph with 2D and 3D views, zoom, drag, and selection"
    />
  );
});

export default function Home() {
  const [nodes, setNodes] = useState<StudioNode[]>(() => applyLayout(DEMO_NODES.map((node) => ({ ...node })), DEMO_EDGES, "radial", "N01"));
  const [edges, setEdges] = useState<DemoEdge[]>(() => DEMO_EDGES.map((edge) => ({ ...edge })));
  const [scenes, setScenes] = useState<DemoScene[]>(() => DEMO_SCENES.map((scene) => ({ ...scene })));
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("radial");
  const [selectedId, setSelectedId] = useState<string | null>("N01");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>("E05");
  const [activeSceneId, setActiveSceneId] = useState("SC02");
  const [sceneNodeIds, setSceneNodeIds] = useState<string[] | null>(["N01", "N02", "N03", "N04", "N05", "N12"]);
  const [visibleNodeKinds, setVisibleNodeKinds] = useState<NodeKind[]>(ALL_NODE_KINDS);
  const [visibleEdgeKinds, setVisibleEdgeKinds] = useState<EdgeKind[]>(["supply", "research"]);
  const [query, setQuery] = useState("");
  const [aiPrompt, setAiPrompt] = useState("Identify the three most critical single-source dependencies");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatDraft, setChatDraft] = useState("Why is Lanxin Intelligent Controls a high-risk node?");
  const [agentBusy, setAgentBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null);
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>(["N02", "N03", "N05"]);
  const [visualHistory, setVisualHistory] = useState<VisualSnapshot[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence");
  const [accessRole, setAccessRole] = useState<AccessRole>("Analyst");
  const [notice, setNotice] = useState("18 ENTITIES · 32 RELATIONS · 100% EVIDENCE COVERAGE");
  const [resetKey, setResetKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const chatThreadRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const searchHits = useMemo(() => {
    const term = normalize(query);
    const hits = new Set(highlightNodeIds);
    if (!term) return hits;
    nodes.filter((node) => normalize([node.id, node.name, node.subtitle, node.summary, node.metric].join(" ")).includes(term)).forEach((node) => hits.add(node.id));
    return hits;
  }, [highlightNodeIds, nodes, query]);

  const visibleNodes = useMemo(() => {
    const allowedSceneIds = sceneNodeIds ? new Set(sceneNodeIds) : null;
    return nodes.filter((node) => visibleNodeKinds.includes(node.kind) && (!allowedSceneIds || allowedSceneIds.has(node.id)));
  }, [nodes, sceneNodeIds, visibleNodeKinds]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => edges.filter((edge) =>
    visibleEdgeKinds.includes(edge.kind)
    && visibleNodeIds.has(edge.source)
    && visibleNodeIds.has(edge.target)
  ), [edges, visibleEdgeKinds, visibleNodeIds]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const connectedEdges = useMemo(() => selectedId
    ? visibleEdges.filter((edge) => edge.source === selectedId || edge.target === selectedId)
    : [], [selectedId, visibleEdges]);
  const totalConnectedEdgeCount = useMemo(() => selectedId
    ? edges.filter((edge) => edge.source === selectedId || edge.target === selectedId).length
    : 0, [edges, selectedId]);
  const selectedEdge = selectedEdgeId
    ? edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  const isDemoDataset = useMemo(() =>
    nodes.length === DEMO_NODES.length
    && edges.length === DEMO_EDGES.length
    && DEMO_NODES.every((node) => nodes.some((item) => item.id === node.id))
    && DEMO_EDGES.every((edge) => edges.some((item) => item.id === edge.id)),
  [edges, nodes]);

  useEffect(() => {
    const sceneId = new URLSearchParams(window.location.hash.slice(1)).get("scene");
    const scene = DEMO_SCENES.find((item) => item.id === sceneId);
    if (!scene) return;

    const timer = window.setTimeout(() => {
      const allowedNodeIds = scene.visibleNodes ? new Set(scene.visibleNodes) : null;
      const allowedKinds = scene.visibleKinds ? new Set(scene.visibleKinds) : null;
      const edgeIsVisible = (edge: DemoEdge) =>
        (!allowedNodeIds || (allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target)))
        && (!allowedKinds || allowedKinds.has(edge.kind));
      const edge = scene.selectedEdgeId
        ? DEMO_EDGES.find((item) => item.id === scene.selectedEdgeId && edgeIsVisible(item))
        : DEMO_EDGES.find((item) => (item.source === scene.selectedId || item.target === scene.selectedId) && edgeIsVisible(item));

      setNodes(applyLayout(DEMO_NODES.map((node) => ({ ...node })), DEMO_EDGES, scene.layout, scene.selectedId));
      setEdges(DEMO_EDGES.map((item) => ({ ...item })));
      setScenes(DEMO_SCENES.map((item) => ({ ...item })));
      setViewMode(scene.viewMode ?? "3d");
      setLayoutMode(scene.layout);
      setSelectedId(scene.selectedId);
      setSelectedEdgeId(edge?.id ?? null);
      setActiveSceneId(scene.id);
      setSceneNodeIds(scene.visibleNodes ?? null);
      setVisibleNodeKinds(ALL_NODE_KINDS);
      setVisibleEdgeKinds(scene.visibleKinds ?? ALL_EDGE_KINDS);
      setResetKey((value) => value + 1);
      setNotice("SHARED DEMO SCENE RESTORED · " + scene.id);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    chatThreadRef.current?.scrollTo({ top: chatThreadRef.current.scrollHeight, behavior: "smooth" });
  }, [agentBusy, chatMessages]);

  const rememberVisual = (label: string) => {
    const snapshot: VisualSnapshot = {
      label,
      nodes: nodes.map((node) => ({ ...node })),
      viewMode,
      layoutMode,
      selectedId,
      selectedEdgeId,
      activeSceneId,
      sceneNodeIds: sceneNodeIds ? [...sceneNodeIds] : null,
      visibleNodeKinds: [...visibleNodeKinds],
      visibleEdgeKinds: [...visibleEdgeKinds],
      highlightNodeIds: [...highlightNodeIds],
    };
    setVisualHistory((current) => [...current.slice(-9), snapshot]);
  };

  const undoVisual = () => {
    const previous = visualHistory.at(-1);
    if (!previous) return;
    setNodes(previous.nodes.map((node) => ({ ...node })));
    setViewMode(previous.viewMode);
    setLayoutMode(previous.layoutMode);
    setSelectedId(previous.selectedId);
    setSelectedEdgeId(previous.selectedEdgeId);
    setActiveSceneId(previous.activeSceneId);
    setSceneNodeIds(previous.sceneNodeIds ? [...previous.sceneNodeIds] : null);
    setVisibleNodeKinds([...previous.visibleNodeKinds]);
    setVisibleEdgeKinds([...previous.visibleEdgeKinds]);
    setHighlightNodeIds([...previous.highlightNodeIds]);
    setVisualHistory((current) => current.slice(0, -1));
    setResetKey((value) => value + 1);
    setNotice("LAST VISUAL ACTION UNDONE");
  };

  const moveNode = useCallback((id: string, position: Pick<DemoNode, "x" | "y" | "z">) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...position, pinned: true } : node));
    setNotice("POSITION PINNED · SCENE STATE UPDATED");
  }, []);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    const edge = edges.find((item) => item.source === id || item.target === id);
    setSelectedEdgeId(edge?.id ?? null);
    setInspectorTab("entity");
    setPendingAction(null);
    setChatMessages((current) => {
      const name = nodes.find((node) => node.id === id)?.name ?? id;
      if (current.at(-1)?.role === "context" && current.at(-1)?.body.includes(id)) return current;
      return [...current, { id: "CTX-" + Date.now(), role: "context", body: `“${name}” is now the active context (${id}). Ask “Why does it matter?” or “Show its upstream network.”` }];
    });
  }, [edges, nodes]);

  const selectEdge = useCallback((id: string) => {
    const edge = edges.find((item) => item.id === id);
    setSelectedEdgeId(id);
    if (edge) setSelectedId(edge.source);
    setInspectorTab("evidence");
    setPendingAction(null);
    setChatMessages((current) => {
      if (current.at(-1)?.role === "context" && current.at(-1)?.body.includes(id)) return current;
      return [...current, { id: "CTX-" + Date.now(), role: "context", body: `Relationship ${id} is now selected. Your next question will use this relationship and its evidence as context.` }];
    });
  }, [edges]);

  const changeLayout = (next: LayoutMode, rootId = selectedId ?? "N01") => {
    setNodes((current) => applyLayout(current, edges, next, rootId));
    setLayoutMode(next);
    setActiveSceneId("");
    setResetKey((value) => value + 1);
    setNotice(next.toUpperCase() + " LAYOUT · DETERMINISTIC SEED APPLIED");
  };

  const clearPins = () => {
    setNodes((current) => applyLayout(current.map((node) => ({ ...node, pinned: false })), edges, layoutMode, selectedId ?? "N01"));
    setNotice("ALL PINNED POSITIONS RELEASED");
  };

  const toggleNodeKind = (kind: NodeKind) => {
    setVisibleNodeKinds((current) => current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind]);
    setActiveSceneId("");
  };

  const toggleEdgeKind = (kind: EdgeKind) => {
    setVisibleEdgeKinds((current) => current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind]);
    setActiveSceneId("");
  };

  const applyScene = (scene: DemoScene) => {
    rememberVisual("Apply scene · " + scene.title);
    setActiveSceneId(scene.id);
    setSceneNodeIds(scene.visibleNodes ?? null);
    setVisibleEdgeKinds(scene.visibleKinds ?? ALL_EDGE_KINDS);
    setVisibleNodeKinds(ALL_NODE_KINDS);
    setLayoutMode(scene.layout);
    setNodes((current) => applyLayout(current.map((node) => ({ ...node, pinned: false })), edges, scene.layout, scene.selectedId));
    setSelectedId(scene.selectedId);
    const allowedNodeIds = scene.visibleNodes ? new Set(scene.visibleNodes) : null;
    const allowedKinds = scene.visibleKinds ? new Set(scene.visibleKinds) : null;
    const edgeIsVisible = (edge: DemoEdge) =>
      (!allowedNodeIds || (allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target)))
      && (!allowedKinds || allowedKinds.has(edge.kind));
    const edge = scene.selectedEdgeId
      ? edges.find((item) => item.id === scene.selectedEdgeId && edgeIsVisible(item))
      : edges.find((item) => (item.source === scene.selectedId || item.target === scene.selectedId) && edgeIsVisible(item));
    setSelectedEdgeId(edge?.id ?? null);
    setViewMode(scene.viewMode ?? "3d");
    setResetKey((value) => value + 1);
    setNotice("SCENE " + scene.id.replace("SC", "") + " APPLIED · " + scene.callout);
  };

  const runAiCommand = () => {
    const prompt = normalize(aiPrompt);
    const target = prompt.includes("资本") || prompt.includes("基金") || prompt.includes("capital") || prompt.includes("fund")
      ? scenes.find((scene) => scene.id === "SC03")
      : prompt.includes("项目") || prompt.includes("验收") || prompt.includes("兑现") || prompt.includes("project") || prompt.includes("acceptance")
        ? scenes.find((scene) => scene.id === "SC04")
        : prompt.includes("供应") || prompt.includes("依赖") || prompt.includes("上游") || prompt.includes("supply") || prompt.includes("depend") || prompt.includes("upstream")
          ? scenes.find((scene) => scene.id === "SC02")
          : scenes.find((scene) => scene.id === "SC01");
    if (target) applyScene(target);
    setNotice("AI VIEW COMMAND INTERPRETED · HUMAN REVIEW REQUIRED");
  };

  const submitAgentPrompt = (value = chatDraft) => {
    const prompt = value.trim();
    if (!prompt || agentBusy) return;
    const messageId = Date.now();
    setChatMessages((current) => [...current, { id: "U-" + messageId, role: "user", body: prompt }]);
    setChatDraft("");
    setPendingAction(null);
    setAgentBusy(true);

    window.setTimeout(() => {
      const term = normalize(prompt);
      const agentTurn = buildAgentTurn(prompt, {
        selectedNodeId: selectedId ?? undefined,
        selectedEdgeId: selectedEdgeId ?? undefined,
        graphRevision: `demo-r${visualHistory.length + 1}`,
      });
      const intent = agentTurn.plan.intent;
      const respond = (message: Omit<ChatMessage, "id" | "role">) => {
        setChatMessages((current) => [...current, { id: "A-" + Date.now(), role: "assistant", ...message }]);
      };

      const demoOnlyIntent = ["upstream", "risk-evidence", "capital-path", "blocked-control-change", "investment-scenes"].includes(intent);
      if (!isDemoDataset && demoOnlyIntent) {
        respond({
          body: "This imported graph remains unchanged. The guided Jichuan investigation macros are bound to the bundled synthetic project, so they cannot safely target imported IDs. You can still select an imported entity, inspect any relationship, search, filter, change layouts, and ask the chat to explain the currently selected edge.",
          plan: {
            id: "AP-IMPORTED-GRAPH-GUARD",
            title: "Imported graph safety boundary",
            risk: "R0",
            status: "blocked",
            steps: ["Detect imported project", "Reject demo-only IDs", "Preserve the current graph"],
            impact: "0 visual actions · 0 graph-data changes",
          },
        });
        setAgentBusy(false);
        return;
      }

      if (intent === "blocked-control-change") {
        const scene = scenes.find((item) => item.id === "SC03");
        if (scene) applyScene(scene);
        setSelectedId("N10");
        setSelectedEdgeId("E13");
        setHighlightNodeIds(["N10", "N05"]);
        setPendingAction({
          id: "PA-CONTROL",
          kind: "relation-change",
          title: "Jiaxu Capital → Lanxin Intelligent Controls: change to “de facto control”",
          description: "Current evidence supports only an 18% direct equity stake. It does not establish control, so the write has been blocked.",
        });
        respond({
          body: "I cannot change this relationship to “de facto control.” The current source proves only that Jiaxu Capital owns an 18% direct stake; it provides no voting arrangement, board rights, or concert-party agreement. I located the original relationship and evidence on the right.",
          plan: {
            id: "AP-04",
            title: "Relationship change preflight",
            risk: "R2",
            status: "blocked",
            steps: ["Locate E13", "Verify S08-C1", "Test control evidence", "Block unsupported write"],
            impact: "0 relationships changed",
            note: "Keep “18% direct equity,” or open a review task for “governance influence.”",
          },
          evidenceRefs: ["S08-C1"],
        });
      } else if (intent === "investment-scenes") {
        setPendingAction({
          id: "PA-SCENES",
          kind: "scene-save",
          title: "Save 3 investment committee scenes",
          description: "Upstream dependencies, capital pathways, and evidence gaps. Saving updates only the local demo project, not the graph data.",
          sceneDrafts: (agentTurn.sceneDrafts ?? []).map((draft) => ({
            title: draft.title,
            subtitle: draft.subtitle,
            viewMode: "2d",
            layout: draft.layout,
            selectedId: draft.selectedId,
            selectedEdgeId: draft.selectedEdgeId,
            visibleNodes: [...draft.scopeNodeIds],
            visibleKinds: [...draft.edgeKinds],
            callout: draft.callout,
          })),
        });
        respond({
          body: "I prepared three investment committee scene drafts. They reuse the same graph data and change only filters, layout, focus, and narrative. Confirm to save them to the scene strip.",
          plan: {
            id: "AP-05",
            title: "Investment committee narrative",
            risk: "R2",
            status: "preview",
            steps: ["Upstream dependency", "Capital path", "Evidence gap"],
            impact: "3 local scenes · 0 graph-data changes",
          },
          sceneDrafts: ["01 · Upstream dependency: concentration and substitution constraints", "02 · Capital path: fund-to-project routes", "03 · Evidence gap: equity does not equal control"],
        });
      } else if (intent === "capital-path") {
        const scene = scenes.find((item) => item.id === "SC03");
        if (scene) applyScene(scene);
        setViewMode("2d");
        setSelectedId("N11");
        setSelectedEdgeId("E12");
        setHighlightNodeIds(["N11", "N10", "N05", "N07", "N17", "N18"]);
        respond({
          body: "I generated the capital-path view. The Donglan Industrial Guidance Fund connects through Jiaxu Capital to Lanxin Intelligent Controls and Haiyu Energy Storage, then extends to the project layer. Fund commitments and equity stakes establish a capital path, not de facto control on their own.",
          plan: {
            id: "AP-03",
            title: "Fund-to-project path analysis",
            risk: "R1",
            status: "applied",
            steps: ["Locate the fund", "Calculate shortest paths", "Find shared capital nodes", "Switch to layered 2D"],
            impact: "8 entities · capital / governance / R&D · Undo available",
          },
          evidenceRefs: ["S08-C1", "S08-C2", "S08-C3", "S12-C2", "S12-C4", "S13-C1", "S13-C2", "S13-C3"],
        });
      } else if (intent === "relationship-evidence") {
        const edgeId = agentTurn.plan.edgeIds[0] ?? selectedEdgeId;
        const relationship = edges.find((edge) => edge.id === edgeId);
        if (relationship) {
          const sourceName = nodeById.get(relationship.source)?.name ?? relationship.source;
          const targetName = nodeById.get(relationship.target)?.name ?? relationship.target;
          setSelectedId(relationship.source);
          setSelectedEdgeId(relationship.id);
          setHighlightNodeIds([relationship.source, relationship.target]);
          setInspectorTab("evidence");
          respond({
            body: `${relationship.id} is ${sourceName} → ${targetName}: “${relationship.label}.” The cited source states: “${relationship.evidence}” It is ${relationship.status === "verified" ? "verified" : "in review"} with ${Math.round(relationship.confidence * 100)}% extraction confidence. This supports the edge as shown, but does not independently prove broader control or causality.`,
            plan: {
              id: "AP-RELATIONSHIP-EVIDENCE",
              title: "Relationship evidence explanation",
              risk: "R0",
              status: "applied",
              steps: ["Read selected edge", "Open source excerpt", "Explain graph role", "Preserve evidence boundary"],
              impact: "1 relationship · 1 evidence reference · 0 graph-data changes",
            },
            evidenceRefs: [relationship.evidenceId],
          });
        } else {
          respond({
            body: "The selected relationship is no longer available in the current graph revision. Select a relationship and try again; no visual action was applied.",
            plan: { id: "AP-RELATIONSHIP-MISSING", title: "Relationship unavailable", risk: "R0", status: "blocked", steps: ["Resolve selected edge", "Stop on missing reference"], impact: "0 visual actions" },
          });
        }
      } else if (intent === "risk-evidence") {
        const scene = scenes.find((item) => item.id === "SC02");
        if (scene) applyScene(scene);
        setSelectedId("N05");
        setSelectedEdgeId("E05");
        setHighlightNodeIds(["N02", "N03", "N05"]);
        setInspectorTab("evidence");
        respond({
          body: "Lanxin Intelligent Controls is risky because of concentrated coverage and limited substitutability—not centrality alone. Its controllers cover 62% of Jichuan Power's battery packs, while the S14 substitutability assessment flags slow replacement across critical suppliers. Two separate material dependencies are 44% for cathode material and 36% for direct lithium supply; these category-specific ratios must not be added together.",
          plan: {
            id: "AP-02",
            title: "Evidence-first risk explanation",
            risk: "R0",
            status: "applied",
            steps: ["Read high-dependency edges", "Open source excerpts", "Compare replacement cycles", "Preserve metric caveats"],
            impact: "4 evidence references · 0 graph-data changes",
          },
          evidenceRefs: ["S01-C2", "S03-C1", "S03-C2", "S04-C1", "S14"],
        });
      } else if (intent === "upstream") {
        const scene = scenes.find((item) => item.id === "SC02");
        if (scene) applyScene(scene);
        setHighlightNodeIds(["N02", "N03", "N05"]);
        respond({
          body: "I expanded two hops upstream from Jichuan Power and retained only supply and R&D relationships. The highlighted nodes—Xingyu Lithium, Chengyue Advanced Materials, and Lanxin Intelligent Controls—combine high concentration with limited substitution speed in the S14 assessment.",
          plan: {
            id: "AP-01B",
            title: "Upstream dependency investigation",
            risk: "R1",
            status: "applied",
            steps: ["Locate the focal entity", "Expand two hops", "Filter relationships", "Highlight high dependencies"],
            impact: "6 entities · 8 relationships · Undo available",
          },
          evidenceRefs: ["S01-C2", "S03-C1", "S03-C2", "S14"],
        });
      } else if (term.includes("显示全部") || term.includes("重置") || term.includes("show all") || term.includes("reset")) {
        const scene = scenes.find((item) => item.id === "SC01");
        if (scene) applyScene(scene);
        setHighlightNodeIds([]);
        respond({
          body: "The full ecosystem view is restored. All entities and relationships are visible again, with focus returned to Jichuan Power.",
          plan: { id: "AP-RESET", title: "Restore full graph", risk: "R1", status: "applied", steps: ["Clear local filters", "Restore the full graph", "Reset focus"], impact: "18 entities · 32 relationships · Undo available" },
        });
      } else {
        const mentioned = nodes.find((node) => term.includes(normalize(node.name)) || term.includes(normalize(node.id)));
        if (mentioned) {
          setSelectedId(mentioned.id);
          setSelectedEdgeId(edges.find((edge) => edge.source === mentioned.id || edge.target === mentioned.id)?.id ?? null);
          setHighlightNodeIds([mentioned.id]);
          respond({
            body: `${mentioned.name}: ${mentioned.summary} I located this entity on the right. You can now ask about its upstream network, capital paths, or evidence.`,
            plan: { id: "AP-FOCUS", title: "Locate and inspect entity", risk: "R0", status: "applied", steps: ["Resolve entity", "Focus node", "Read authorized fields"], impact: "Read only · 0 graph-data changes" },
            evidenceRefs: mentioned.sources,
          });
        } else {
          respond({
            body: "I cannot yet determine which part of the view you want to change. Try “Show Jichuan Power's two-hop upstream network,” “Trace the industrial fund,” or “Create investment committee scenes.” To avoid a wrong action, the graph has not changed.",
            plan: { id: "AP-CLARIFY", title: "Clarification required", risk: "R0", status: "blocked", steps: ["No unique target found", "No command executed"], impact: "0 visual actions" },
          });
        }
      }

      setAgentBusy(false);
    }, 520);
  };

  const confirmPendingAgentAction = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === "relation-change") {
      setPendingAction(null);
      setChatMessages((current) => [...current, { id: "A-" + Date.now(), role: "assistant", body: "The original “18% direct equity” relationship has been preserved, and the control-evidence gap remains in the analysis record. No fact was rewritten." }]);
      setNotice("UNSUPPORTED RELATION CHANGE DISCARDED");
      return;
    }

    const drafts = pendingAction.sceneDrafts ?? [];
    if (!drafts.length) {
      setPendingAction(null);
      setNotice("SCENE SAVE CANCELLED · NO VALID DRAFTS");
      return;
    }
    const ids = nextSceneIds(scenes, drafts.length);
    const additions: DemoScene[] = drafts.map((draft, index) => ({ ...draft, id: ids[index] }));
    setScenes((current) => [...current, ...additions]);
    setPendingAction(null);
    setChatMessages((current) => [...current, { id: "A-" + Date.now(), role: "assistant", body: "Three investment committee scenes were saved to the strip below. They record only the view and narrative; no entity, relationship, or evidence was changed.", plan: { id: "AP-05C", title: "Investment committee scenes saved", risk: "R2", status: "saved", steps: ["Save upstream dependency", "Save capital pathways", "Save evidence gaps"], impact: "3 local scenes added" } }]);
    setNotice("3 LOCAL INVESTMENT COMMITTEE SCENES SAVED");
  };

  const saveScene = () => {
    const [sceneId] = nextSceneIds(scenes, 1);
    const number = Number(sceneId.slice(2));
    const scene: DemoScene = {
      id: sceneId,
      title: "Custom analysis scene " + number,
      subtitle: visibleNodes.length + " entities · " + visibleEdges.length + " relationships",
      viewMode,
      layout: layoutMode,
      selectedId: selectedId ?? visibleNodes[0]?.id ?? nodes[0]?.id ?? "",
      selectedEdgeId: selectedEdgeId ?? undefined,
      visibleNodes: sceneNodeIds ?? visibleNodes.map((node) => node.id),
      visibleKinds: visibleEdgeKinds,
      callout: "Current filters, layout, and focus saved.",
    };
    setScenes((current) => [...current, scene]);
    setActiveSceneId(scene.id);
    setNotice("SCENE " + scene.id.replace("SC", "") + " SAVED · LOCAL REPLAY READY");
  };

  const exportProject = () => {
    const project = {
      schemaVersion: 1,
      kind: "relationship-studio-project",
      synthetic: true,
      title: "Donglan New Energy Ecosystem Review",
      asOf: "2026-03-31",
      graph: { nodes, edges },
      scenes,
      activeState: {
        viewMode,
        layoutMode,
        selectedId,
        selectedEdgeId,
        activeSceneId,
        sceneNodeIds,
        visibleNodeKinds,
        visibleEdgeKinds,
        query,
      },
    };
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), "donglan-relationship-project.json");
    setNotice("COMPLETE PROJECT EXPORTED · JSON");
    setExportOpen(false);
  };

  const shareScene = async () => {
    const shareableScene = DEMO_SCENES.find((scene) => scene.id === activeSceneId);
    if (!shareableScene) {
      setNotice("CUSTOM SCENE IS LOCAL · EXPORT THE PROJECT JSON TO SHARE IT");
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.hash = "scene=" + shareableScene.id;
      await navigator.clipboard.writeText(url.toString());
      setNotice("REPLAYABLE DEMO SCENE LINK COPIED");
    } catch {
      setNotice("SCENE READY · COPY THE CURRENT URL");
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setNotice("IMPORT BLOCKED · FILE LIMIT IS 10 MB");
      return;
    }
    try {
      const result = parseImportedGraph(file.name, await file.text());
      if (!result.nodes.length || !result.edges.length) throw new Error("The file contains no displayable relationships");
      const importedState = result.activeState;
      const importedLayout = importedState?.layoutMode ?? "force";
      const importedSelectedId = importedState?.selectedId ?? result.nodes[0].id;
      const importedSelectedEdgeId = importedState?.selectedEdgeId ?? result.edges[0].id;
      setNodes(result.isProject ? result.nodes : applyLayout(result.nodes, result.edges, importedLayout, importedSelectedId));
      setEdges(result.edges);
      setSelectedId(importedSelectedId);
      setSelectedEdgeId(importedSelectedEdgeId);
      setScenes(result.scenes);
      setActiveSceneId(importedState?.activeSceneId ?? "");
      setSceneNodeIds(importedState?.sceneNodeIds ?? null);
      setVisibleNodeKinds(importedState?.visibleNodeKinds ?? ALL_NODE_KINDS);
      setVisibleEdgeKinds(importedState?.visibleEdgeKinds ?? ALL_EDGE_KINDS);
      setHighlightNodeIds([]);
      setVisualHistory([]);
      setViewMode(importedState?.viewMode ?? "3d");
      setLayoutMode(importedLayout);
      setQuery(importedState?.query ?? "");
      setResetKey((value) => value + 1);
      setImportOpen(false);
      setChatMessages((current) => [...current, {
        id: "A-IMPORT-" + Date.now(),
        role: "assistant",
        body: result.isProject
          ? `Restored ${result.nodes.length} entities, ${result.edges.length} relationships, ${result.scenes.length} scenes, and the saved view state locally in your browser.`
          : `Imported ${result.nodes.length} entities and ${result.edges.length} relationships locally in your browser. The content remains unverified. You can focus imported entities and ask the chat to explain a selected relationship; guided Jichuan macros remain disabled for imported IDs.`,
        plan: { id: "AP-IMPORT", title: result.isProject ? "Local project restore" : "Local data import", risk: "R1", status: "applied", steps: ["Parse file", "Validate endpoints", result.isProject ? "Restore scenes and view state" : "Generate stable layout"], impact: `${result.nodes.length} entities · ${result.edges.length} relationships · ${result.scenes.length} scenes` },
      }]);
      setNotice("LOCAL IMPORT COMPLETE · " + result.nodes.length + " ENTITIES · " + result.edges.length + " RELATIONS");
    } catch (error) {
      setNotice("IMPORT FAILED · " + (error instanceof Error ? error.message : "Unable to parse file"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const approveSelectedEdge = () => {
    if (!selectedEdge) return;
    setEdges((current) => current.map((edge) => edge.id === selectedEdge.id
      ? { ...edge, status: "verified", confidence: Math.max(edge.confidence, 0.9) }
      : edge));
    setNotice("RELATION " + selectedEdge.id + " VERIFIED · AUDIT TRAIL UPDATED");
  };

  const displayedSources = sourceExpanded ? DEMO_SOURCES : DEMO_SOURCES.slice(0, 4);

  return (
    <main className="studio-app">
      <header className="studio-topbar">
        <div className="studio-brand">
          <span className="brand-symbol">VA</span>
          <span className="brand-copy"><strong>RELOSCOPE</strong><small>CHAT × VISUAL INTELLIGENCE</small></span>
        </div>
        <div className="project-identity">
          <span className="project-dot" />
          <div><strong>Donglan New Energy Ecosystem Review</strong><small>PROJECT / DL-NE-2026-03 · AS OF 2026-03-31</small></div>
        </div>
        <nav className="studio-tabs" aria-label="Workspace navigation">
          <button type="button" className="active">Agent Workspace</button>
          <button type="button" onClick={() => {
            setInspectorTab("evidence");
            if (!selectedEdgeId) setSelectedEdgeId(connectedEdges[0]?.id ?? null);
          }}>Evidence</button>
          <button type="button" onClick={() => document.querySelector(".scene-strip")?.scrollIntoView({ behavior: "smooth" })}>Scenes</button>
        </nav>
        <div className="top-actions">
          <span className="demo-badge">SYNTHETIC DATA · DEMO ONLY</span>
          <select value={accessRole} onChange={(event) => {
            setAccessRole(event.target.value as AccessRole);
            setNotice("ACCESS VIEW CHANGED · " + event.target.value);
          }} aria-label="Switch demo access role">
            <option>Analyst</option>
            <option>External Counsel</option>
            <option>Executive Viewer</option>
          </select>
          <button type="button" className="quiet-action" onClick={() => submitAgentPrompt("Turn this analysis into investment committee scenes")}>Generate Scenes</button>
          <button type="button" className="quiet-action" onClick={shareScene}>Copy Scene Link</button>
          <div className="export-wrap">
            <button type="button" className="primary-action" onClick={() => setExportOpen((value) => !value)}>Export <span>⌄</span></button>
            {exportOpen && (
              <div className="export-menu">
                <button type="button" onClick={() => { canvasRef.current?.exportPng(); setNotice("CURRENT SCENE EXPORTED · PNG"); setExportOpen(false); }}><span>PNG</span><small>High-resolution current scene</small></button>
                <button type="button" onClick={() => { canvasRef.current?.exportSvg(); setNotice("CURRENT PROJECTION EXPORTED · SVG"); setExportOpen(false); }}><span>SVG</span><small>Editable vector projection</small></button>
                <button type="button" onClick={exportProject}><span>JSON</span><small>Complete project and scenes</small></button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="studio-workspace">
        <aside className="left-panel agent-panel">
          <section className="agent-preview">
            <header>
              <div><span className="agent-orb">VA</span><span><strong>Visual Analyst</strong><small>DEMO AGENT · LOCAL ORCHESTRATION</small></span></div>
              <div className="agent-header-actions">
                {visualHistory.length > 0 && <button type="button" onClick={undoVisual} title={visualHistory.at(-1)?.label}>↶ Undo</button>}
                <button type="button" aria-label="Start a new conversation" onClick={() => {
                  setChatMessages([INITIAL_CHAT[0]]);
                  setPendingAction(null);
                  setChatDraft("");
                }}>＋</button>
              </div>
            </header>
            <div className="agent-preview-thread" ref={chatThreadRef}>
              <div className="agent-thread-label"><span>INVESTIGATION / DL-NE-2026-03</span><em>{chatMessages.length} MESSAGES</em></div>
              {chatMessages.map((message) => (
                message.role === "context" ? (
                  <div className="context-event" key={message.id}><span>◎</span><p>{message.body}</p></div>
                ) : (
                  <article className={cx("chat-message", message.role)} key={message.id}>
                    <span>{message.role === "user" ? "YOU" : "VA"}</span>
                    <div className="message-body">
                      <p>{message.body}</p>
                      {message.plan && (
                        <div className={cx("mini-plan", message.plan.status)}>
                          <header><small>ACTION PLAN · {message.plan.risk}</small><span>{message.plan.status === "applied" ? "APPLIED" : message.plan.status === "preview" ? "AWAITING APPROVAL" : message.plan.status === "saved" ? "SAVED" : "BLOCKED"}</span></header>
                          <strong>{message.plan.title}</strong>
                          <div className="plan-steps">
                            {message.plan.steps.map((step, index) => <span key={step}><i>{index + 1}</i>{step}</span>)}
                          </div>
                          <em>{message.plan.impact}</em>
                          {message.plan.note && <p className="plan-note">{message.plan.note}</p>}
                        </div>
                      )}
                      {message.evidenceRefs && (
                        <div className="evidence-chips">
                          {message.evidenceRefs.map((ref) => (
                            <button type="button" key={ref} onClick={() => {
                              const source = DEMO_SOURCES.find((item) => item.id === ref);
                              const edge = edges.find((item) => item.evidenceId === ref)
                                ?? edges.find((item) => item.evidenceId.startsWith(ref + "-") && (item.source === selectedId || item.target === selectedId))
                                ?? edges.find((item) => item.evidenceId.startsWith(ref + "-"));
                              if (edge) selectEdge(edge.id);
                              setNotice(source ? `SOURCE LOCATED · ${source.id} · ${source.title}` : "EVIDENCE LOCATED · " + ref);
                            }}>{ref} ↗</button>
                          ))}
                        </div>
                      )}
                      {message.sceneDrafts && (
                        <div className="scene-draft-list">
                          {message.sceneDrafts.map((draft) => <span key={draft}>{draft}</span>)}
                        </div>
                      )}
                    </div>
                  </article>
                )
              ))}
              {agentBusy && <div className="agent-thinking"><span>VA</span><div><i /><i /><i /></div><p>Reading the current graph and evidence…</p></div>}
              {pendingAction && (
                <section className={cx("approval-card", pendingAction.kind === "relation-change" && "blocked")}>
                  <header><span>{pendingAction.kind === "relation-change" ? "WRITE BLOCKED" : "APPROVAL REQUIRED"}</span><em>{pendingAction.kind === "relation-change" ? "R2 · INSUFFICIENT EVIDENCE" : "R2 · LOCAL PERSISTENCE"}</em></header>
                  <strong>{pendingAction.title}</strong>
                  <p>{pendingAction.description}</p>
                  <footer>
                    <button type="button" onClick={() => setPendingAction(null)}>Cancel</button>
                    <button type="button" className="approve-action" onClick={confirmPendingAgentAction}>{pendingAction.kind === "relation-change" ? "Keep Original" : "Save 3 Scenes"}</button>
                  </footer>
                </section>
              )}
            </div>
            <footer>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => submitAgentPrompt(prompt)} disabled={agentBusy}>{prompt}</button>)}
              </div>
              <div className="context-chip">◎ ACTIVE CONTEXT: {selectedEdge ? `${selectedEdge.id} · ${selectedEdge.label}` : selectedNode ? `${selectedNode.id} · ${selectedNode.name}` : "FULL GRAPH"}</div>
              <div className="agent-composer">
                <button type="button" aria-label="Import data" onClick={() => setImportOpen(true)}>＋</button>
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitAgentPrompt();
                    }
                  }}
                  placeholder="Investigate, explain, or modify this graph…"
                  aria-label="Ask Visual Analyst"
                />
                <button type="button" className="send-command" onClick={() => submitAgentPrompt()} disabled={!chatDraft.trim() || agentBusy}>↗</button>
              </div>
              <small>Enter to send · Shift + Enter for a new line · Read-only actions auto-run; writes are previewed first</small>
            </footer>
          </section>
          <section className="ai-command-card">
            <div className="section-heading"><span>AI Visual Command</span><em>HUMAN IN CONTROL</em></div>
            <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} aria-label="AI visual command" />
            <button type="button" onClick={runAiCommand}><span>Generate View</span><b>↗</b></button>
            <div className="suggestion-list">
              {AI_SUGGESTIONS.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => setAiPrompt(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>Search & Locate</span><em>{searchHits.size || "ALL"}</em></div>
            <label className="search-box">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Entity, relationship, or field…" />
              {query && <button type="button" onClick={() => setQuery("")}>×</button>}
            </label>
            {query && (
              <div className="search-results">
                {[...searchHits].slice(0, 4).map((id) => {
                  const node = nodeById.get(id);
                  return node ? <button type="button" key={id} onClick={() => selectNode(id)}><i style={{ background: NODE_META[node.kind].color }} /><span>{node.name}</span><em>{node.id}</em></button> : null;
                })}
                {searchHits.size === 0 && <p>No matching entities</p>}
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>Sources</span><em>{DEMO_SOURCES.length} FILES</em></div>
            <div className="source-stack">
              {displayedSources.map((source) => (
                <button type="button" key={source.id} onClick={() => setNotice(source.id + " · " + source.summary)}>
                  <i>{source.type === "Agreement" ? "C" : source.type === "Project File" ? "P" : "D"}</i>
                  <span><strong>{source.title.replaceAll("《", "").replaceAll("》", "")}</strong><small>{source.date} · {source.type}</small></span>
                  <em>↗</em>
                </button>
              ))}
            </div>
            <button type="button" className="panel-link" onClick={() => setSourceExpanded((value) => !value)}>{sourceExpanded ? "Collapse Sources" : "View All 15 Sources"} <span>→</span></button>
            <button type="button" className="import-button" onClick={() => setImportOpen(true)}>＋ Import Local Data</button>
          </section>

          <section className="panel-section filter-section">
            <div className="section-heading"><span>Entity Types</span><em>{visibleNodeKinds.length}/{ALL_NODE_KINDS.length}</em></div>
            <div className="filter-grid">
              {ALL_NODE_KINDS.map((kind) => (
                <button type="button" key={kind} className={cx(visibleNodeKinds.includes(kind) && "active")} onClick={() => toggleNodeKind(kind)}>
                  <i style={{ background: NODE_META[kind].color }} /><span>{NODE_META[kind].label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section relation-filter-section">
            <div className="section-heading"><span>Relationship Layers</span><em>{visibleEdgeKinds.length}/{ALL_EDGE_KINDS.length}</em></div>
            <div className="relation-filter-list">
              {ALL_EDGE_KINDS.map((kind) => {
                const count = edges.filter((edge) => edge.kind === kind).length;
                return (
                  <button type="button" key={kind} className={cx(visibleEdgeKinds.includes(kind) && "active")} onClick={() => toggleEdgeKind(kind)}>
                    <span className="check-mark">{visibleEdgeKinds.includes(kind) ? "✓" : ""}</span>
                    <i style={{ background: EDGE_META[kind].color }} />
                    <span>{EDGE_META[kind].label}</span>
                    <em>{String(count).padStart(2, "0")}</em>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="graph-stage">
          <div className="graph-controlbar">
            <div className="control-group view-switch" role="group" aria-label="View mode">
              <button type="button" className={cx(viewMode === "3d" && "active")} onClick={() => setViewMode("3d")}><span>◈</span> Analyze 3D</button>
              <button type="button" className={cx(viewMode === "2d" && "active")} onClick={() => setViewMode("2d")}><span>◇</span> Present 2D</button>
            </div>
            <div className="control-divider" />
            <div className="control-group layout-switch" role="group" aria-label="Layout mode">
              {(["force", "radial", "layered"] as LayoutMode[]).map((layout) => (
                <button type="button" key={layout} className={cx(layoutMode === layout && "active")} onClick={() => changeLayout(layout)}>
                  {layout === "force" ? "Force" : layout === "radial" ? "Radial" : "Layered"}
                </button>
              ))}
            </div>
            <div className="graph-status"><span className="live-dot" /> LIVE GRAPH <em>{visibleNodes.length}N / {visibleEdges.length}E</em></div>
            <button type="button" className="icon-button" onClick={clearPins} title="Release all pinned nodes">PIN ×</button>
            <button type="button" className="icon-button" onClick={() => canvasRef.current?.fit()} title="Fit graph to view">FIT</button>
          </div>

          <RelationshipCanvas
            ref={canvasRef}
            nodes={visibleNodes}
            edges={visibleEdges}
            mode={viewMode}
            selectedId={selectedId}
            selectedEdgeId={selectedEdgeId}
            searchHits={searchHits}
            resetKey={resetKey}
            onSelectNode={selectNode}
            onSelectEdge={selectEdge}
            onMoveNode={moveNode}
          />

          {selectedEdge && (
            <aside className="graph-evidence-drawer" aria-label="Selected relationship evidence">
              <header>
                <span>RELATION EVIDENCE</span>
                <em className={selectedEdge.status}>{selectedEdge.status === "verified" ? "VERIFIED" : "IN REVIEW"}</em>
              </header>
              <div className="drawer-relation">
                <small>{EDGE_META[selectedEdge.kind].label} · {selectedEdge.id}</small>
                <strong>{nodeById.get(selectedEdge.source)?.name}<b>→</b>{nodeById.get(selectedEdge.target)?.name}</strong>
              </div>
              <blockquote>“{accessRole === "External Counsel" ? "This evidence inherits a restricted source policy; your current role can see only that the relationship exists." : selectedEdge.evidence}”</blockquote>
              <dl>
                <div><dt>Source</dt><dd>{selectedEdge.sourceTitle}</dd></div>
                <div><dt>Location</dt><dd>{selectedEdge.location}</dd></div>
                <div><dt>Evidence</dt><dd>{selectedEdge.evidenceId}</dd></div>
              </dl>
              <footer>
                <button type="button" onClick={() => submitAgentPrompt(`Explain relationship ${selectedEdge.id}. Why does it matter?`)}>Explain in Chat</button>
                <button type="button" onClick={() => setSelectedEdgeId(null)} aria-label="Collapse evidence drawer">Collapse</button>
              </footer>
            </aside>
          )}

          <div className="canvas-guide">
            <span>{viewMode === "3d" ? "Drag background to orbit" : "Drag background to pan"}</span>
            <span>Scroll to zoom</span>
            <span>Drag entities to pin</span>
            <span>Shift + drag to pan</span>
          </div>
          <div className="canvas-legend">
            <span><i className="solid-line" />Verified</span>
            <span><i className="dashed-line" />In review</span>
            <span><b>◆</b>Capital</span>
            <span><b>▣</b>Project</span>
          </div>
          <div className="notice-toast"><span />{notice}</div>

          <div className="scene-strip">
            <div className="scene-strip-heading">
              <span>Analysis Scenes</span>
              <em>{scenes.length} SCENES · LOCAL VIEW PRESETS</em>
            </div>
            <div className="scene-list">
              {scenes.map((scene, index) => (
                <button type="button" key={scene.id} className={cx(scene.id === activeSceneId && "active")} onClick={() => applyScene(scene)}>
                  <span className="scene-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="scene-thumbnail"><i /><i /><i /><b /></span>
                  <span className="scene-copy"><strong>{scene.title}</strong><small>{scene.subtitle}</small></span>
                  <em>{scene.id === activeSceneId ? "PLAYING" : "PLAY"}</em>
                </button>
              ))}
              <button type="button" className="add-scene" onClick={saveScene}><span>＋</span><strong>Save Current Scene</strong><small>Capture layout, filters, and focus</small></button>
            </div>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist">
            <button type="button" className={cx(inspectorTab === "entity" && "active")} onClick={() => setInspectorTab("entity")}>Entity Profile</button>
            <button type="button" className={cx(inspectorTab === "evidence" && "active")} onClick={() => setInspectorTab("evidence")}>Evidence</button>
            <button type="button" className={cx(inspectorTab === "analysis" && "active")} onClick={() => setInspectorTab("analysis")}>Risk & Inference</button>
          </div>

          {selectedNode ? (
            <>
              <section className="entity-hero">
                <div className="entity-icon" style={{ color: NODE_META[selectedNode.kind].color }}>{NODE_META[selectedNode.kind].short}</div>
                <div><span>{NODE_META[selectedNode.kind].label} · {selectedNode.id}</span><h2>{selectedNode.name}</h2><p>{selectedNode.subtitle}</p></div>
                <button type="button" onClick={() => setNotice("ENTITY " + selectedNode.id + " BOOKMARKED")}>☆</button>
              </section>

              {inspectorTab === "entity" && (
                <div className="inspector-content">
                  <div className="verification-row">
                    <span className={cx("status-pill", selectedNode.status)}>{selectedNode.status === "verified" ? "SOURCE VERIFIED" : selectedNode.status === "planned" ? "PLANNED" : "IN REVIEW"}</span>
                    <em>{selectedNode.sources.length} sources</em>
                  </div>
                  <p className="entity-summary">{selectedNode.summary}</p>
                  <dl className="property-grid">
                    <div><dt>Key Metric</dt><dd>{selectedNode.metric}</dd></div>
                    <div><dt>Dependency</dt><dd className={cx("risk-text", selectedNode.risk)}>{selectedNode.risk === "high" ? "High" : selectedNode.risk === "medium" ? "Medium" : "Low"}</dd></div>
                    <div><dt>Information As Of</dt><dd>2026-03-31</dd></div>
                    <div><dt>Visible To</dt><dd>{accessRole}</dd></div>
                  </dl>
                  <div className="subheading"><span>Direct Connections</span><em>{connectedEdges.length}</em></div>
                  <div className="connection-list">
                    {connectedEdges.map((edge) => {
                      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
                      const other = nodeById.get(otherId);
                      return (
                        <button type="button" key={edge.id} onClick={() => { setSelectedEdgeId(edge.id); setInspectorTab("evidence"); }}>
                          <i style={{ background: EDGE_META[edge.kind].color }} />
                          <span><small>{edge.label}</small><strong>{other?.name ?? otherId}</strong></span>
                          <em>{edge.directed && edge.source === selectedNode.id ? "→" : edge.directed ? "←" : "↔"}</em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {inspectorTab === "evidence" && (
                <div className="inspector-content evidence-content">
                  {selectedEdge ? (
                    <>
                      <div className="relation-head">
                        <span style={{ color: EDGE_META[selectedEdge.kind].color }}>{EDGE_META[selectedEdge.kind].label}</span>
                        <strong>{nodeById.get(selectedEdge.source)?.name} <b>→</b> {nodeById.get(selectedEdge.target)?.name}</strong>
                        <div><span className={cx("status-pill", selectedEdge.status)}>{selectedEdge.status === "verified" ? "SOURCE VERIFIED" : "MODEL SUGGESTION · REVIEW"}</span><em>Evidence strength {Math.round(selectedEdge.confidence * 100)}%</em></div>
                      </div>
                      <section className="evidence-card">
                        <header><span>Relationship Evidence</span><em>{selectedEdge.evidenceId}</em></header>
                        <h3>{selectedEdge.sourceTitle}</h3>
                        <p className={cx(accessRole === "External Counsel" && "masked-evidence")}>
                          {accessRole === "External Counsel"
                            ? "This evidence inherits a restricted source policy. Contract fields and source excerpts are masked for External Counsel."
                            : "“" + selectedEdge.evidence + "”"}
                        </p>
                        <dl>
                          <div><dt>Location</dt><dd>{selectedEdge.location}</dd></div>
                          <div><dt>Extraction</dt><dd>Rules + model assistance</dd></div>
                          <div><dt>Access</dt><dd>{accessRole === "External Counsel" ? "Legally restricted · Masked" : "Project member"}</dd></div>
                          <div><dt>Demo Fingerprint</dt><dd>DEMO-{stableHash(selectedEdge.evidence).toUpperCase()}</dd></div>
                        </dl>
                        <footer>
                          <button type="button" onClick={() => setNotice("SOURCE CONTEXT OPENED · SYNTHETIC DOCUMENT")}>View Context</button>
                          <button type="button" onClick={() => setNotice("FIELD TRACE · " + selectedEdge.evidenceId)}>Trace Field</button>
                        </footer>
                      </section>
                      {selectedEdge.status === "review" && (
                        <div className="review-callout">
                          <span>!</span>
                          <div><strong>Human confirmation required</strong><p>Planned values and incomplete acceptance checks are preserved without being rewritten as observed facts.</p></div>
                          <button type="button" onClick={approveSelectedEdge}>Approve as Verified</button>
                        </div>
                      )}
                      <div className="audit-line"><span>MODEL</span><strong>Extractor v2.4</strong><em>Prompt 08 · Schema 1.0</em></div>
                      <div className="audit-line"><span>LAST REVIEW</span><strong>Data Governance Team</strong><em>2026-03-28 14:22</em></div>
                    </>
                  ) : <div className="empty-inspector">Select a relationship to inspect field-level evidence.</div>}
                </div>
              )}

              {inspectorTab === "analysis" && (
                <div className="inspector-content analysis-content">
                  <div className="analysis-score">
                    <span>Network Criticality</span><strong>{selectedNode.id === "N01" ? "4.9" : selectedNode.risk === "high" ? "4.4" : "2.8"}</strong><em>/ 5.0</em>
                    <div><i style={{ width: selectedNode.risk === "high" ? "92%" : "56%" }} /></div>
                  </div>
                  <div className="analysis-card">
                    <span>Derived Observation</span>
                    <h3>{selectedNode.id === "N01" ? "A central hub—and a potential single point" : "Requires human judgment across sources and alternatives"}</h3>
                    <p>{selectedNode.id === "N01" ? `${totalConnectedEdgeCount} direct relationships span materials, controls, capital, and project delivery. A delay in any critical capability may propagate through the network.` : selectedNode.summary}</p>
                    <em>This observation is derived from graph structure; it is not a factual conclusion.</em>
                  </div>
                  <button type="button" className="scenario-button" onClick={() => {
                    setNotice("HYPOTHETICAL SCENARIO · NODE UNAVAILABLE FOR 7 DAYS");
                    setVisibleEdgeKinds(["supply", "delivery", "certification"]);
                  }}>Run scenario: node unavailable for 7 days</button>
                  <p className="analysis-warning">Scenario results support discussion. They are not predictions and do not trigger business decisions.</p>
                </div>
              )}
            </>
          ) : <div className="empty-inspector">Select an entity on the canvas to inspect its profile and evidence.</div>}
        </aside>
      </section>

      {importOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setImportOpen(false);
        }}>
          <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <header><div><span>LOCAL DATA IMPORT</span><h2 id="import-title">Connect Your Relationship Data</h2><p>Files are parsed in this browser and are not uploaded to a server.</p></div><button type="button" onClick={() => setImportOpen(false)}>×</button></header>
            <div className="connector-grid">
              <button type="button" className="active" onClick={() => fileInputRef.current?.click()}><i>CSV</i><span><strong>CSV Relationship Table</strong><small>Edge list · 10MB maximum</small></span><em>SELECT FILE</em></button>
              <button type="button" className="active" onClick={() => fileInputRef.current?.click()}><i>{"{ }"}</i><span><strong>JSON Graph Project</strong><small>nodes + edges / relations</small></span><em>SELECT FILE</em></button>
              <button type="button" onClick={() => setNotice("NEO4J CONNECTOR · PRODUCT ROADMAP")}><i>●</i><span><strong>Neo4j</strong><small>Read-only connector</small></span><em>COMING</em></button>
              <button type="button" onClick={() => setNotice("REST ADAPTER SDK · PRODUCT ROADMAP")}><i>↔</i><span><strong>REST / JSON API</strong><small>Incremental data adapter</small></span><em>COMING</em></button>
            </div>
            <div className="import-schema">
              <span>Minimum CSV columns</span>
              <code>source_label, target_label, relation, evidence</code>
              <small>Optional: source_id, target_id, directed, confidence</small>
            </div>
            <footer><span>UTF-8 · Local validation · Failed imports do not replace the current graph</span><button type="button" onClick={() => setImportOpen(false)}>Cancel</button><button type="button" className="primary-action" onClick={() => fileInputRef.current?.click()}>Select File</button></footer>
          </section>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={(event) => handleImport(event.target.files?.[0])}
      />
    </main>
  );
}
