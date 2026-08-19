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
type AccessRole = "分析成员" | "外部顾问" | "管理层只读";
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
  company: { label: "企业", color: "#69a7ff", short: "CO" },
  capital: { label: "资本机构", color: "#b99cff", short: "CA" },
  government: { label: "政府机构", color: "#f4bb5f", short: "GV" },
  institution: { label: "专业机构", color: "#5bd8db", short: "IN" },
  person: { label: "关键角色", color: "#ff9266", short: "PE" },
  project: { label: "战略项目", color: "#59d7a0", short: "PR" },
};

const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  supply: { label: "供应", color: "#62a8ff" },
  capital: { label: "投资 / 持股", color: "#b39af8" },
  governance: { label: "任职 / 治理", color: "#ff956b" },
  research: { label: "联合研发", color: "#51d2d9" },
  certification: { label: "认证 / 验收", color: "#efcd61" },
  support: { label: "政策支持", color: "#e7a84f" },
  delivery: { label: "项目交付", color: "#58d694" },
  circular: { label: "回收闭环", color: "#55cdbc" },
};

const ALL_NODE_KINDS = Object.keys(NODE_META) as NodeKind[];
const ALL_EDGE_KINDS = Object.keys(EDGE_META) as EdgeKind[];

const AI_SUGGESTIONS = [
  "识别最关键的三条单点依赖",
  "穿透产业基金到两个项目的影响路径",
  "只看待复核关系及其证据",
];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: "M00",
    role: "assistant",
    body: "我可以调查这张关系图、回到证据，并把分析过程整理成镜头。只读分析会直接作用到右侧；关系修改会先给你预览。",
  },
  {
    id: "M01",
    role: "user",
    body: "以霁川动力为中心，展开两层上游，只看供应和研发关系。",
  },
  {
    id: "M02",
    role: "assistant",
    body: "已聚焦霁川动力的两层上游。当前视图保留 6 个实体、8 条供应与研发关系；三条高依赖边已高亮。",
    plan: {
      id: "AP-01",
      title: "上游依赖调查",
      risk: "R1",
      status: "applied",
      steps: ["定位霁川动力", "展开两层邻域", "筛选供应 / 研发", "径向布局并高亮"],
      impact: "6 个实体 · 8 条关系 · 可撤销",
    },
    evidenceRefs: ["S01-C2", "S03-C1", "S03-C2", "S04-C1"],
  },
];

const QUICK_PROMPTS = [
  "为什么岚芯智控是高风险节点？",
  "穿透产业基金到两个项目的路径",
  "把当前分析整理成投委会镜头",
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().trim();
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
  if (/投资|持股|基金/.test(value)) return "capital";
  if (/任职|治理|董事|管理/.test(value)) return "governance";
  if (/研发|专利|联合开发/.test(value)) return "research";
  if (/认证|验收|检测/.test(value)) return "certification";
  if (/政策|专项|支持/.test(value)) return "support";
  if (/交付|项目|配套/.test(value)) return "delivery";
  if (/回收|再生|循环/.test(value)) return "circular";
  return "supply";
}

function parseImportedGraph(filename: string, text: string) {
  if (filename.toLowerCase().endsWith(".json")) {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const graph = payload.graph && typeof payload.graph === "object" ? payload.graph as Record<string, unknown> : payload;
    if (!Array.isArray(graph.nodes)) throw new Error("JSON 缺少 nodes 数组");
    const rawEdges = Array.isArray(graph.edges)
      ? graph.edges
      : Array.isArray(graph.relations)
        ? graph.relations
        : null;
    if (!rawEdges) throw new Error("JSON 缺少 edges 或 relations 数组");
    const nodes: StudioNode[] = graph.nodes.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const name = String(item.name ?? item.label ?? "").trim();
      if (!name) throw new Error("第 " + (index + 1) + " 个节点缺少 name/label");
      const kind = ALL_NODE_KINDS.includes(item.kind as NodeKind) ? item.kind as NodeKind : "company";
      return {
        id: String(item.id ?? "N-" + stableHash(name)),
        name,
        kind,
        subtitle: String(item.subtitle ?? item.role ?? "导入实体"),
        x: Number.isFinite(Number(item.x)) ? Number(item.x) : Math.cos(index * 2.4) * (18 + index * 1.5),
        y: Number.isFinite(Number(item.y)) ? Number(item.y) : Math.sin(index * 2.4) * (18 + index * 1.5),
        z: Number.isFinite(Number(item.z)) ? Number(item.z) : (index % 5) * 2,
        summary: String(item.summary ?? "由本地文件导入的实体。"),
        metric: String(item.metric ?? "LOCAL IMPORT"),
        risk: ["high", "medium", "low"].includes(String(item.risk)) ? item.risk as DemoNode["risk"] : "medium",
        status: ["verified", "review", "planned"].includes(String(item.status)) ? item.status as DemoNode["status"] : "review",
        sources: Array.isArray(item.sources) ? item.sources.map(String) : ["LOCAL"],
      };
    });
    const ids = new Set(nodes.map((node) => node.id));
    const edges: DemoEdge[] = rawEdges.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const source = String(item.source ?? "");
      const target = String(item.target ?? "");
      if (!ids.has(source) || !ids.has(target)) {
        throw new Error("第 " + (index + 1) + " 条关系指向不存在的节点");
      }
      const label = String(item.label ?? item.relation ?? "关联");
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
        evidence: String(item.evidence ?? "导入文件未提供证据片段。"),
        sourceTitle: String(item.sourceTitle ?? filename),
        location: String(item.location ?? "本地导入"),
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
        directed: item.directed !== false && item.directed !== "false",
      };
    });
    return { nodes, edges };
  }

  const table = parseCsv(text);
  if (table.length < 2) throw new Error("CSV 至少需要表头和一条关系");
  const headers = table[0].map((value) => normalize(value));
  const column = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";
  if (!headers.includes("source_label") || !headers.includes("target_label")) {
    throw new Error("CSV 需要 source_label 与 target_label 字段");
  }
  const nodeById = new Map<string, StudioNode>();
  const edges: DemoEdge[] = [];
  table.slice(1).filter((row) => row.some(Boolean)).forEach((row, index) => {
    const sourceName = column(row, "source_label").trim();
    const targetName = column(row, "target_label").trim();
    if (!sourceName || !targetName) throw new Error("CSV 第 " + (index + 2) + " 行缺少实体名称");
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
          subtitle: "CSV 导入实体",
          x: Math.cos(count * 2.4) * (18 + count * 2),
          y: Math.sin(count * 2.4) * (18 + count * 2),
          z: ((count % 5) - 2) * 3,
          summary: "由本地 CSV 关系表生成。",
          metric: "LOCAL IMPORT",
          risk: "medium",
          status: "review",
          sources: ["LOCAL"],
        });
      }
    });
    const label = column(row, "relation").trim() || "关联";
    edges.push({
      id: "E-" + stableHash(source + target + label + index),
      source,
      target,
      kind: inferEdgeKind(label),
      label,
      weight: 0.62,
      status: "review",
      evidenceId: "LOCAL-" + (index + 1),
      evidence: column(row, "evidence") || "导入文件未提供证据片段。",
      sourceTitle: filename,
      location: "CSV 第 " + (index + 2) + " 行",
      confidence: Math.max(0, Math.min(1, Number(column(row, "confidence") || 0.7))),
      directed: column(row, "directed").toLowerCase() !== "false",
    });
  });
  return { nodes: [...nodeById.values()], edges };
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
      aria-label="可切换二维与三维、支持缩放、拖动与选择的企业关系图"
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
  const [aiPrompt, setAiPrompt] = useState("识别最关键的三条单点依赖");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatDraft, setChatDraft] = useState("为什么岚芯智控是高风险节点？");
  const [agentBusy, setAgentBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAgentAction | null>(null);
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>(["N02", "N03", "N05"]);
  const [visualHistory, setVisualHistory] = useState<VisualSnapshot[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence");
  const [accessRole, setAccessRole] = useState<AccessRole>("分析成员");
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
  const selectedEdge = selectedEdgeId
    ? edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  const reviewCount = edges.filter((edge) => edge.status === "review").length;
  const verifiedCount = edges.length - reviewCount;

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
      return [...current, { id: "CTX-" + Date.now(), role: "context", body: `已将「${name}」设为当前上下文（${id}）。可以继续问“为什么它重要？”或“看它的上游”。` }];
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
      return [...current, { id: "CTX-" + Date.now(), role: "context", body: `已选择关系 ${id}。下一条问题会优先使用这条关系及其证据。` }];
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
    rememberVisual("应用镜头 · " + scene.title);
    setActiveSceneId(scene.id);
    setSceneNodeIds(scene.visibleNodes ?? null);
    setVisibleEdgeKinds(scene.visibleKinds ?? ALL_EDGE_KINDS);
    setVisibleNodeKinds(ALL_NODE_KINDS);
    setLayoutMode(scene.layout);
    setNodes((current) => applyLayout(current.map((node) => ({ ...node, pinned: false })), edges, scene.layout, scene.selectedId));
    setSelectedId(scene.selectedId);
    const edge = edges.find((item) => item.source === scene.selectedId || item.target === scene.selectedId);
    setSelectedEdgeId(edge?.id ?? null);
    setViewMode(scene.id === "SC03" || scene.id === "SC04" ? "2d" : "3d");
    setResetKey((value) => value + 1);
    setNotice("SCENE " + scene.id.replace("SC", "") + " APPLIED · " + scene.callout);
  };

  const runAiCommand = () => {
    const prompt = normalize(aiPrompt);
    const target = prompt.includes("资本") || prompt.includes("基金")
      ? scenes.find((scene) => scene.id === "SC03")
      : prompt.includes("项目") || prompt.includes("验收") || prompt.includes("兑现")
        ? scenes.find((scene) => scene.id === "SC04")
        : prompt.includes("供应") || prompt.includes("依赖") || prompt.includes("上游")
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

      if (intent === "blocked-control-change") {
        const scene = scenes.find((item) => item.id === "SC03");
        if (scene) applyScene(scene);
        setSelectedId("N10");
        setSelectedEdgeId("E13");
        setHighlightNodeIds(["N10", "N05"]);
        setPendingAction({
          id: "PA-CONTROL",
          kind: "relation-change",
          title: "嘉序资本 → 岚芯智控：改为“实际控制”",
          description: "现有证据只支持 18% 直接持股，不能推出实际控制。系统已阻止写入。",
        });
        respond({
          body: "我不能把这条关系直接改成“实际控制”。现有来源只证明嘉序资本直接持股 18%，没有表决权安排、董事席位或一致行动协议作为支撑。右侧已定位到原关系与证据。",
          plan: {
            id: "AP-04",
            title: "关系修改预检",
            risk: "R2",
            status: "blocked",
            steps: ["定位 E13", "核对来源 S08-C1", "检查控制权证据", "阻止不充分写入"],
            impact: "0 条关系被修改",
            note: "可保留“直接持股 18%”，或新增“治理影响 · 待复核”任务。",
          },
          evidenceRefs: ["S08-C1"],
        });
      } else if (intent === "investment-scenes") {
        setPendingAction({
          id: "PA-SCENES",
          kind: "scene-save",
          title: "保存 3 个投委会镜头",
          description: "上游依赖、资本穿透、证据缺口。保存只会写入本地演示项目，不修改图数据。",
        });
        respond({
          body: "我已整理出 3 个投委会镜头草案。它们复用同一份图数据，只改变筛选、布局、焦点与说明；确认后保存到下方镜头条。",
          plan: {
            id: "AP-05",
            title: "投委会叙事编排",
            risk: "R2",
            status: "preview",
            steps: ["上游依赖", "资本穿透", "证据缺口"],
            impact: "新增 3 个本地镜头 · 图数据 0 改动",
          },
          sceneDrafts: ["01 · 上游依赖：三条长替代周期", "02 · 资本穿透：基金到项目路径", "03 · 证据缺口：持股不等同控制"],
        });
      } else if (intent === "capital-path") {
        const scene = scenes.find((item) => item.id === "SC03");
        if (scene) applyScene(scene);
        setViewMode("2d");
        setSelectedId("N11");
        setSelectedEdgeId("E12");
        setHighlightNodeIds(["N11", "N10", "N05", "N07", "N17", "N18"]);
        respond({
          body: "已生成资本穿透视图：东澜产业引导基金经嘉序资本连接岚芯智控与海隅储能，再延伸到项目端。注意：基金出资与持股关系只能证明资本路径，不能单独证明实际控制。",
          plan: {
            id: "AP-03",
            title: "基金到项目的穿透路径",
            risk: "R1",
            status: "applied",
            steps: ["定位产业基金", "计算最短路径", "识别共同资本节点", "切换层级 2D"],
            impact: "8 个实体 · 资本 / 治理 / 研发关系 · 可撤销",
          },
          evidenceRefs: ["S08-C1", "S08-C2", "S08-C3"],
        });
      } else if (intent === "risk-evidence") {
        const scene = scenes.find((item) => item.id === "SC02");
        if (scene) applyScene(scene);
        setSelectedId("N05");
        setSelectedEdgeId("E05");
        setHighlightNodeIds(["N02", "N03", "N05"]);
        setInspectorTab("evidence");
        respond({
          body: "岚芯智控的风险来自“覆盖集中 + 替代慢”，不是只看中心性：它覆盖霁川动力 62% 的在产电池包，替代验证周期超过 7 个月。另两条材料依赖分别是 44% 正极材料和 36% 直接锂盐；这些比例属于不同品类，不能相加。",
          plan: {
            id: "AP-02",
            title: "证据优先的风险解释",
            risk: "R0",
            status: "applied",
            steps: ["读取高依赖边", "回到原始摘录", "比较替代周期", "保留口径限制"],
            impact: "4 条证据已引用 · 图数据 0 改动",
          },
          evidenceRefs: ["S01-C2", "S03-C1", "S03-C2", "S04-C1"],
        });
      } else if (intent === "upstream") {
        const scene = scenes.find((item) => item.id === "SC02");
        if (scene) applyScene(scene);
        setHighlightNodeIds(["N02", "N03", "N05"]);
        respond({
          body: "已从霁川动力展开两层上游，并只保留供应与研发关系。高亮的星峪锂源、澄岳新材和岚芯智控都有较长替代周期。",
          plan: {
            id: "AP-01B",
            title: "上游依赖调查",
            risk: "R1",
            status: "applied",
            steps: ["定位中心实体", "展开两层", "筛选关系", "高亮高依赖节点"],
            impact: "6 个实体 · 8 条关系 · 可撤销",
          },
          evidenceRefs: ["S01-C2", "S03-C1", "S03-C2"],
        });
      } else if (term.includes("显示全部") || term.includes("重置")) {
        const scene = scenes.find((item) => item.id === "SC01");
        if (scene) applyScene(scene);
        setHighlightNodeIds([]);
        respond({
          body: "已恢复完整生态视图。所有实体与关系重新可见，右侧焦点回到霁川动力。",
          plan: { id: "AP-RESET", title: "恢复完整视图", risk: "R1", status: "applied", steps: ["清除局部筛选", "恢复完整图", "重设焦点"], impact: "18 个实体 · 32 条关系 · 可撤销" },
        });
      } else {
        const mentioned = nodes.find((node) => term.includes(normalize(node.name)) || term.includes(normalize(node.id)));
        if (mentioned) {
          setSelectedId(mentioned.id);
          setSelectedEdgeId(edges.find((edge) => edge.source === mentioned.id || edge.target === mentioned.id)?.id ?? null);
          setHighlightNodeIds([mentioned.id]);
          respond({
            body: `${mentioned.name}：${mentioned.summary} 右侧已定位该实体；你可以继续问它的上游、资本路径或证据。`,
            plan: { id: "AP-FOCUS", title: "定位并读取实体", risk: "R0", status: "applied", steps: ["解析实体", "定位节点", "读取授权字段"], impact: "只读 · 图数据 0 改动" },
            evidenceRefs: mentioned.sources,
          });
        } else {
          respond({
            body: "我还不能确定你希望改变哪一部分视图。可以具体说“看霁川动力上游两层”“穿透产业基金路径”或“整理成投委会镜头”。为避免误操作，右侧图没有变化。",
            plan: { id: "AP-CLARIFY", title: "需要澄清", risk: "R0", status: "blocked", steps: ["未识别唯一目标", "未执行任何命令"], impact: "0 个视觉动作" },
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
      setChatMessages((current) => [...current, { id: "A-" + Date.now(), role: "assistant", body: "已保留原始“直接持股 18%”关系，并把“控制权证据不足”留在分析记录中；没有改写事实。" }]);
      setNotice("UNSUPPORTED RELATION CHANGE DISCARDED");
      return;
    }

    const additions: DemoScene[] = [
      { id: "SC05", title: "投委会 01 · 上游依赖", subtitle: "三条长替代周期与对应证据", layout: "radial", selectedId: "N01", visibleNodes: ["N01", "N02", "N03", "N04", "N05", "N12"], visibleKinds: ["supply", "research"], callout: "集中度与替代周期共同构成供应韧性风险。" },
      { id: "SC06", title: "投委会 02 · 资本穿透", subtitle: "引导基金经嘉序资本连接关键能力", layout: "layered", selectedId: "N11", visibleNodes: ["N01", "N05", "N07", "N10", "N11", "N17", "N18"], visibleKinds: ["capital", "governance", "delivery"], callout: "资本路径不自动等同于实际控制。" },
      { id: "SC07", title: "投委会 03 · 证据缺口", subtitle: "区分已核验事实与待复核推断", layout: "layered", selectedId: "N10", visibleNodes: ["N05", "N10", "N11", "N16"], visibleKinds: ["capital", "governance"], callout: "18% 直接持股不足以单独支持实际控制结论。" },
    ];
    setScenes((current) => [...current.filter((scene) => !additions.some((item) => item.id === scene.id)), ...additions]);
    setPendingAction(null);
    setChatMessages((current) => [...current, { id: "A-" + Date.now(), role: "assistant", body: "3 个投委会镜头已保存到右侧底部。它们只记录视图与叙事，不修改任何实体、关系或证据。", plan: { id: "AP-05C", title: "投委会镜头已保存", risk: "R2", status: "saved", steps: ["保存上游依赖", "保存资本穿透", "保存证据缺口"], impact: "新增 3 个本地镜头" } }]);
    setNotice("3 LOCAL INVESTMENT COMMITTEE SCENES SAVED");
  };

  const saveScene = () => {
    const number = scenes.length + 1;
    const scene: DemoScene = {
      id: "SC" + String(number).padStart(2, "0"),
      title: "自定义研判镜头 " + number,
      subtitle: visibleNodes.length + " 个实体 · " + visibleEdges.length + " 条关系",
      layout: layoutMode,
      selectedId: selectedId ?? visibleNodes[0]?.id ?? nodes[0]?.id ?? "",
      visibleNodes: sceneNodeIds ?? visibleNodes.map((node) => node.id),
      visibleKinds: visibleEdgeKinds,
      callout: "已保存当前筛选、布局与焦点。",
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
      title: "东澜新能源产业生态研判",
      asOf: "2026-03-31",
      graph: { nodes, edges },
      scenes,
      activeState: {
        viewMode,
        layoutMode,
        selectedId,
        visibleNodeKinds,
        visibleEdgeKinds,
      },
    };
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), "donglan-relationship-project.json");
    setNotice("COMPLETE PROJECT EXPORTED · JSON");
    setExportOpen(false);
  };

  const shareScene = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href + "#scene=" + (activeSceneId || "custom"));
      setNotice("LOCAL DEMO SCENE LINK COPIED");
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
      if (!result.nodes.length || !result.edges.length) throw new Error("文件中没有可显示的关系");
      setNodes(applyLayout(result.nodes, result.edges, "force", result.nodes[0].id));
      setEdges(result.edges);
      setSelectedId(result.nodes[0].id);
      setSelectedEdgeId(result.edges[0].id);
      setScenes([]);
      setSceneNodeIds(null);
      setVisibleNodeKinds(ALL_NODE_KINDS);
      setVisibleEdgeKinds(ALL_EDGE_KINDS);
      setHighlightNodeIds([]);
      setVisualHistory([]);
      setLayoutMode("force");
      setResetKey((value) => value + 1);
      setImportOpen(false);
      setChatMessages((current) => [...current, {
        id: "A-IMPORT-" + Date.now(),
        role: "assistant",
        body: `已在浏览器本地导入 ${result.nodes.length} 个实体和 ${result.edges.length} 条关系。导入内容尚未核验，我不会把它自动标记为事实；你现在可以用对话继续探索。`,
        plan: { id: "AP-IMPORT", title: "本地数据导入", risk: "R1", status: "applied", steps: ["解析文件", "校验端点", "生成稳定布局"], impact: `${result.nodes.length} 个实体 · ${result.edges.length} 条关系` },
      }]);
      setNotice("LOCAL IMPORT COMPLETE · " + result.nodes.length + " ENTITIES · " + result.edges.length + " RELATIONS");
    } catch (error) {
      setNotice("IMPORT FAILED · " + (error instanceof Error ? error.message : "无法解析文件"));
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
          <span className="brand-copy"><strong>关系洞察 Agent</strong><small>CHAT × VISUAL INTELLIGENCE</small></span>
        </div>
        <div className="project-identity">
          <span className="project-dot" />
          <div><strong>东澜新能源产业生态研判</strong><small>PROJECT / DL-NE-2026-03 · 信息截止 2026-03-31</small></div>
        </div>
        <nav className="studio-tabs" aria-label="工作区导航">
          <button type="button" className="active">Agent 工作台</button>
          <button type="button" onClick={() => {
            setInspectorTab("evidence");
            if (!selectedEdgeId) setSelectedEdgeId(connectedEdges[0]?.id ?? null);
          }}>证据链</button>
          <button type="button" onClick={() => document.querySelector(".scene-strip")?.scrollIntoView({ behavior: "smooth" })}>叙事镜头</button>
        </nav>
        <div className="top-actions">
          <span className="demo-badge">完全虚构数据 · 演示环境</span>
          <select value={accessRole} onChange={(event) => {
            setAccessRole(event.target.value as AccessRole);
            setNotice("ACCESS VIEW CHANGED · " + event.target.value);
          }} aria-label="切换演示权限">
            <option>分析成员</option>
            <option>外部顾问</option>
            <option>管理层只读</option>
          </select>
          <button type="button" className="quiet-action" onClick={() => submitAgentPrompt("把当前分析整理成投委会镜头")}>生成镜头</button>
          <button type="button" className="quiet-action" onClick={shareScene}>复制镜头链接</button>
          <div className="export-wrap">
            <button type="button" className="primary-action" onClick={() => setExportOpen((value) => !value)}>导出 <span>⌄</span></button>
            {exportOpen && (
              <div className="export-menu">
                <button type="button" onClick={() => { canvasRef.current?.exportPng(); setNotice("CURRENT SCENE EXPORTED · PNG"); setExportOpen(false); }}><span>PNG</span><small>当前镜头高清图</small></button>
                <button type="button" onClick={() => { canvasRef.current?.exportSvg(); setNotice("CURRENT PROJECTION EXPORTED · SVG"); setExportOpen(false); }}><span>SVG</span><small>可编辑矢量投影</small></button>
                <button type="button" onClick={exportProject}><span>JSON</span><small>完整项目与镜头</small></button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="kpi-rail" aria-label="项目摘要">
        <div><span>生态主体</span><strong>{nodes.length}</strong><em>ENTITIES</em></div>
        <div><span>关系断言</span><strong>{edges.length}</strong><em>RELATIONS</em></div>
        <div><span>已核验</span><strong>{verifiedCount}</strong><em>VERIFIED</em></div>
        <div><span>待复核</span><strong className="warning-value">{reviewCount}</strong><em>REVIEW</em></div>
        <p>每条关系，都能回到证据。<small>模型建议不等于已核实事实，发布前须由授权人员复核。</small></p>
      </section>

      <section className="studio-workspace">
        <aside className="left-panel agent-panel">
          <section className="agent-preview">
            <header>
              <div><span className="agent-orb">VA</span><span><strong>Visual Analyst</strong><small>DEMO AGENT · LOCAL ORCHESTRATION</small></span></div>
              <div className="agent-header-actions">
                {visualHistory.length > 0 && <button type="button" onClick={undoVisual} title={visualHistory.at(-1)?.label}>↶ 撤销</button>}
                <button type="button" aria-label="新建对话" onClick={() => {
                  setChatMessages([INITIAL_CHAT[0]]);
                  setPendingAction(null);
                  setChatDraft("");
                }}>＋</button>
              </div>
            </header>
            <div className="agent-preview-thread" ref={chatThreadRef}>
              <div className="agent-thread-label"><span>调查会话 / DL-NE-2026-03</span><em>{chatMessages.length} MESSAGES</em></div>
              {chatMessages.map((message) => (
                message.role === "context" ? (
                  <div className="context-event" key={message.id}><span>◎</span><p>{message.body}</p></div>
                ) : (
                  <article className={cx("chat-message", message.role)} key={message.id}>
                    <span>{message.role === "user" ? "你" : "VA"}</span>
                    <div className="message-body">
                      <p>{message.body}</p>
                      {message.plan && (
                        <div className={cx("mini-plan", message.plan.status)}>
                          <header><small>ACTION PLAN · {message.plan.risk}</small><span>{message.plan.status === "applied" ? "已执行" : message.plan.status === "preview" ? "待确认" : message.plan.status === "saved" ? "已保存" : "已阻止"}</span></header>
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
                              const edge = edges.find((item) => item.evidenceId === ref);
                              if (edge) selectEdge(edge.id);
                              setNotice("EVIDENCE LOCATED · " + ref);
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
              {agentBusy && <div className="agent-thinking"><span>VA</span><div><i /><i /><i /></div><p>正在读取当前图与证据…</p></div>}
              {pendingAction && (
                <section className={cx("approval-card", pendingAction.kind === "relation-change" && "blocked")}>
                  <header><span>{pendingAction.kind === "relation-change" ? "WRITE BLOCKED" : "APPROVAL REQUIRED"}</span><em>{pendingAction.kind === "relation-change" ? "R2 · 证据不足" : "R2 · 本地持久化"}</em></header>
                  <strong>{pendingAction.title}</strong>
                  <p>{pendingAction.description}</p>
                  <footer>
                    <button type="button" onClick={() => setPendingAction(null)}>取消</button>
                    <button type="button" className="approve-action" onClick={confirmPendingAgentAction}>{pendingAction.kind === "relation-change" ? "保留原关系" : "确认保存 3 个镜头"}</button>
                  </footer>
                </section>
              )}
            </div>
            <footer>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => submitAgentPrompt(prompt)} disabled={agentBusy}>{prompt}</button>)}
              </div>
              <div className="context-chip">◎ 当前上下文：{selectedEdge ? `${selectedEdge.id} · ${selectedEdge.label}` : selectedNode ? `${selectedNode.id} · ${selectedNode.name}` : "完整图谱"}</div>
              <div className="agent-composer">
                <button type="button" aria-label="导入数据" onClick={() => setImportOpen(true)}>＋</button>
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitAgentPrompt();
                    }
                  }}
                  placeholder="调查、解释或修改这张关系图…"
                  aria-label="向 Visual Analyst 提问"
                />
                <button type="button" className="send-command" onClick={() => submitAgentPrompt()} disabled={!chatDraft.trim() || agentBusy}>↗</button>
              </div>
              <small>Enter 发送 · Shift + Enter 换行 · 只读分析自动执行，写入先预览</small>
            </footer>
          </section>
          <section className="ai-command-card">
            <div className="section-heading"><span>AI 视觉指令</span><em>HUMAN IN CONTROL</em></div>
            <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} aria-label="AI 视觉指令" />
            <button type="button" onClick={runAiCommand}><span>生成视图</span><b>↗</b></button>
            <div className="suggestion-list">
              {AI_SUGGESTIONS.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => setAiPrompt(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>搜索与定位</span><em>{searchHits.size || "ALL"}</em></div>
            <label className="search-box">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="实体、关系或字段…" />
              {query && <button type="button" onClick={() => setQuery("")}>×</button>}
            </label>
            {query && (
              <div className="search-results">
                {[...searchHits].slice(0, 4).map((id) => {
                  const node = nodeById.get(id);
                  return node ? <button type="button" key={id} onClick={() => selectNode(id)}><i style={{ background: NODE_META[node.kind].color }} /><span>{node.name}</span><em>{node.id}</em></button> : null;
                })}
                {searchHits.size === 0 && <p>没有匹配的实体</p>}
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>数据源</span><em>{DEMO_SOURCES.length} FILES</em></div>
            <div className="source-stack">
              {displayedSources.map((source) => (
                <button type="button" key={source.id} onClick={() => setNotice(source.id + " · " + source.summary)}>
                  <i>{source.type === "协议" ? "C" : source.type === "项目文件" ? "P" : "D"}</i>
                  <span><strong>{source.title.replaceAll("《", "").replaceAll("》", "")}</strong><small>{source.date} · {source.type}</small></span>
                  <em>↗</em>
                </button>
              ))}
            </div>
            <button type="button" className="panel-link" onClick={() => setSourceExpanded((value) => !value)}>{sourceExpanded ? "收起来源" : "查看全部 15 份来源"} <span>→</span></button>
            <button type="button" className="import-button" onClick={() => setImportOpen(true)}>＋ 导入本地数据</button>
          </section>

          <section className="panel-section filter-section">
            <div className="section-heading"><span>主体类型</span><em>{visibleNodeKinds.length}/{ALL_NODE_KINDS.length}</em></div>
            <div className="filter-grid">
              {ALL_NODE_KINDS.map((kind) => (
                <button type="button" key={kind} className={cx(visibleNodeKinds.includes(kind) && "active")} onClick={() => toggleNodeKind(kind)}>
                  <i style={{ background: NODE_META[kind].color }} /><span>{NODE_META[kind].label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section relation-filter-section">
            <div className="section-heading"><span>关系图层</span><em>{visibleEdgeKinds.length}/{ALL_EDGE_KINDS.length}</em></div>
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
            <div className="control-group view-switch" role="group" aria-label="视图模式">
              <button type="button" className={cx(viewMode === "3d" && "active")} onClick={() => setViewMode("3d")}><span>◈</span> 分析 3D</button>
              <button type="button" className={cx(viewMode === "2d" && "active")} onClick={() => setViewMode("2d")}><span>◇</span> 汇报 2D</button>
            </div>
            <div className="control-divider" />
            <div className="control-group layout-switch" role="group" aria-label="布局模式">
              {(["force", "radial", "layered"] as LayoutMode[]).map((layout) => (
                <button type="button" key={layout} className={cx(layoutMode === layout && "active")} onClick={() => changeLayout(layout)}>
                  {layout === "force" ? "力导向" : layout === "radial" ? "径向" : "层级"}
                </button>
              ))}
            </div>
            <div className="graph-status"><span className="live-dot" /> LIVE GRAPH <em>{visibleNodes.length}N / {visibleEdges.length}E</em></div>
            <button type="button" className="icon-button" onClick={clearPins} title="取消固定节点">PIN ×</button>
            <button type="button" className="icon-button" onClick={() => canvasRef.current?.fit()} title="适配视图">FIT</button>
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
            <aside className="graph-evidence-drawer" aria-label="当前关系证据">
              <header>
                <span>RELATION EVIDENCE</span>
                <em className={selectedEdge.status}>{selectedEdge.status === "verified" ? "已核验" : "待复核"}</em>
              </header>
              <div className="drawer-relation">
                <small>{EDGE_META[selectedEdge.kind].label} · {selectedEdge.id}</small>
                <strong>{nodeById.get(selectedEdge.source)?.name}<b>→</b>{nodeById.get(selectedEdge.target)?.name}</strong>
              </div>
              <blockquote>“{accessRole === "外部顾问" ? "该证据继承自受限来源；当前角色只显示关系存在。" : selectedEdge.evidence}”</blockquote>
              <dl>
                <div><dt>来源</dt><dd>{selectedEdge.sourceTitle}</dd></div>
                <div><dt>定位</dt><dd>{selectedEdge.location}</dd></div>
                <div><dt>证据</dt><dd>{selectedEdge.evidenceId}</dd></div>
              </dl>
              <footer>
                <button type="button" onClick={() => submitAgentPrompt(`解释关系 ${selectedEdge.id}，为什么它重要？`)}>在对话中解释</button>
                <button type="button" onClick={() => setSelectedEdgeId(null)} aria-label="收起证据">收起</button>
              </footer>
            </aside>
          )}

          <div className="canvas-guide">
            <span>{viewMode === "3d" ? "拖动空白旋转" : "拖动空白平移"}</span>
            <span>滚轮缩放</span>
            <span>拖动实体固定位置</span>
            <span>Shift + 拖动平移</span>
          </div>
          <div className="canvas-legend">
            <span><i className="solid-line" />已核验</span>
            <span><i className="dashed-line" />待复核</span>
            <span><b>◆</b>资本机构</span>
            <span><b>▣</b>战略项目</span>
          </div>
          <div className="notice-toast"><span />{notice}</div>

          <div className="scene-strip">
            <div className="scene-strip-heading">
              <span>叙事镜头</span>
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
              <button type="button" className="add-scene" onClick={saveScene}><span>＋</span><strong>保存当前镜头</strong><small>记录布局、筛选与焦点</small></button>
            </div>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist">
            <button type="button" className={cx(inspectorTab === "entity" && "active")} onClick={() => setInspectorTab("entity")}>实体档案</button>
            <button type="button" className={cx(inspectorTab === "evidence" && "active")} onClick={() => setInspectorTab("evidence")}>关系证据</button>
            <button type="button" className={cx(inspectorTab === "analysis" && "active")} onClick={() => setInspectorTab("analysis")}>风险与推断</button>
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
                    <span className={cx("status-pill", selectedNode.status)}>{selectedNode.status === "verified" ? "来源已核验" : selectedNode.status === "planned" ? "规划中" : "待复核"}</span>
                    <em>{selectedNode.sources.length} 个来源</em>
                  </div>
                  <p className="entity-summary">{selectedNode.summary}</p>
                  <dl className="property-grid">
                    <div><dt>关键指标</dt><dd>{selectedNode.metric}</dd></div>
                    <div><dt>依赖等级</dt><dd className={cx("risk-text", selectedNode.risk)}>{selectedNode.risk === "high" ? "高" : selectedNode.risk === "medium" ? "中" : "低"}</dd></div>
                    <div><dt>信息截止</dt><dd>2026-03-31</dd></div>
                    <div><dt>可见范围</dt><dd>{accessRole}</dd></div>
                  </dl>
                  <div className="subheading"><span>直接连接</span><em>{connectedEdges.length}</em></div>
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
                        <div><span className={cx("status-pill", selectedEdge.status)}>{selectedEdge.status === "verified" ? "来源已核对" : "模型建议 · 待复核"}</span><em>证据充分度 {Math.round(selectedEdge.confidence * 100)}%</em></div>
                      </div>
                      <section className="evidence-card">
                        <header><span>关系依据</span><em>{selectedEdge.evidenceId}</em></header>
                        <h3>{selectedEdge.sourceTitle}</h3>
                        <p className={cx(accessRole === "外部顾问" && "masked-evidence")}>
                          {accessRole === "外部顾问"
                            ? "该证据继承自受限来源；外部顾问视图已遮罩合同字段与原文片段。"
                            : "“" + selectedEdge.evidence + "”"}
                        </p>
                        <dl>
                          <div><dt>定位</dt><dd>{selectedEdge.location}</dd></div>
                          <div><dt>提取方式</dt><dd>规则提取 + 模型辅助</dd></div>
                          <div><dt>权限</dt><dd>{accessRole === "外部顾问" ? "法务受限 · 已遮罩" : "项目成员"}</dd></div>
                          <div><dt>内容哈希</dt><dd>DEMO-{stableHash(selectedEdge.evidence).toUpperCase()}</dd></div>
                        </dl>
                        <footer>
                          <button type="button" onClick={() => setNotice("SOURCE CONTEXT OPENED · SYNTHETIC DOCUMENT")}>查看上下文</button>
                          <button type="button" onClick={() => setNotice("FIELD TRACE · " + selectedEdge.evidenceId)}>字段溯源</button>
                        </footer>
                      </section>
                      {selectedEdge.status === "review" && (
                        <div className="review-callout">
                          <span>!</span>
                          <div><strong>此关系需要人工确认</strong><p>系统保留规划值与未完成验收，不自动写成已发生事实。</p></div>
                          <button type="button" onClick={approveSelectedEdge}>批准为已核验</button>
                        </div>
                      )}
                      <div className="audit-line"><span>MODEL</span><strong>Extractor v2.4</strong><em>Prompt 08 · Schema 1.0</em></div>
                      <div className="audit-line"><span>LAST REVIEW</span><strong>数据治理组</strong><em>2026-03-28 14:22</em></div>
                    </>
                  ) : <div className="empty-inspector">选择一条关系查看字段级证据。</div>}
                </div>
              )}

              {inspectorTab === "analysis" && (
                <div className="inspector-content analysis-content">
                  <div className="analysis-score">
                    <span>网络关键性</span><strong>{selectedNode.id === "N01" ? "4.9" : selectedNode.risk === "high" ? "4.4" : "2.8"}</strong><em>/ 5.0</em>
                    <div><i style={{ width: selectedNode.risk === "high" ? "92%" : "56%" }} /></div>
                  </div>
                  <div className="analysis-card">
                    <span>派生观察</span>
                    <h3>{selectedNode.id === "N01" ? "单核枢纽，也是潜在单点" : "需结合来源与替代路径人工判断"}</h3>
                    <p>{selectedNode.id === "N01" ? "14 条直接关系跨越材料、控制系统、资本与项目交付；任一关键能力延期可能沿网络传导。" : selectedNode.summary}</p>
                    <em>这是图结构派生观察，不代表事实结论。</em>
                  </div>
                  <button type="button" className="scenario-button" onClick={() => {
                    setNotice("HYPOTHETICAL SCENARIO · NODE UNAVAILABLE FOR 7 DAYS");
                    setVisibleEdgeKinds(["supply", "delivery", "certification"]);
                  }}>运行假设情景：节点不可用 7 天</button>
                  <p className="analysis-warning">情景结果用于辅助讨论，不是预测，也不会自动触发业务决策。</p>
                </div>
              )}
            </>
          ) : <div className="empty-inspector">在画布中选择实体，查看档案与证据。</div>}
        </aside>
      </section>

      {importOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setImportOpen(false);
        }}>
          <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <header><div><span>LOCAL DATA IMPORT</span><h2 id="import-title">连接你的关系数据</h2><p>文件只在当前浏览器解析，不会上传到服务器。</p></div><button type="button" onClick={() => setImportOpen(false)}>×</button></header>
            <div className="connector-grid">
              <button type="button" className="active" onClick={() => fileInputRef.current?.click()}><i>CSV</i><span><strong>CSV 关系表</strong><small>边列表 · 最大 10MB</small></span><em>选择文件</em></button>
              <button type="button" className="active" onClick={() => fileInputRef.current?.click()}><i>{"{ }"}</i><span><strong>JSON 图项目</strong><small>nodes + edges / relations</small></span><em>选择文件</em></button>
              <button type="button" onClick={() => setNotice("NEO4J CONNECTOR · PRODUCT ROADMAP")}><i>●</i><span><strong>Neo4j</strong><small>只读连接器</small></span><em>COMING</em></button>
              <button type="button" onClick={() => setNotice("REST ADAPTER SDK · PRODUCT ROADMAP")}><i>↔</i><span><strong>REST / JSON API</strong><small>增量数据适配器</small></span><em>COMING</em></button>
            </div>
            <div className="import-schema">
              <span>CSV 最小字段</span>
              <code>source_label, target_label, relation, evidence</code>
              <small>可选：source_id, target_id, directed, confidence</small>
            </div>
            <footer><span>UTF-8 · 本地校验 · 导入失败不会覆盖当前图</span><button type="button" onClick={() => setImportOpen(false)}>取消</button><button type="button" className="primary-action" onClick={() => fileInputRef.current?.click()}>选择文件</button></footer>
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
