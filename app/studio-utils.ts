import type { DemoEdge, DemoNode, EdgeKind, NodeKind } from "./demo-data";

export type GraphFileResult = {
  nodes: DemoNode[];
  edges: DemoEdge[];
  warnings: string[];
};

export type StudioLayoutMode = "force" | "radial" | "layered";

const MAX_SOURCE_CHARS = 10_000_000;
const MAX_NODES = 5_000;
const MAX_EDGES = 20_000;
const MAX_FIELD_CHARS = 10_000;
const MAX_WARNINGS = 100;
const COORDINATE_LIMIT = 1_000_000;

const NODE_KINDS = new Set<NodeKind>([
  "company",
  "capital",
  "government",
  "institution",
  "person",
  "project",
]);

const EDGE_KINDS = new Set<EdgeKind>([
  "supply",
  "capital",
  "governance",
  "research",
  "certification",
  "support",
  "delivery",
  "circular",
]);

const NODE_COLORS: Record<NodeKind, string> = {
  company: "#63d8c6",
  capital: "#f1c98f",
  government: "#8bb9ff",
  institution: "#a998f4",
  person: "#ff9f8f",
  project: "#d9e47c",
};

const EDGE_COLORS: Record<EdgeKind, string> = {
  supply: "#63d8c6",
  capital: "#f1c98f",
  governance: "#ff9f8f",
  research: "#a998f4",
  certification: "#8bb9ff",
  support: "#d9e47c",
  delivery: "#7dc9ef",
  circular: "#75d29a",
};

type JsonRecord = Record<string, unknown>;
type CsvRow = { cells: string[]; line: number };
type Position = { x: number; y: number; z: number };
type WorkNode = Position & {
  id: string;
  pinned: boolean;
  vx: number;
  vy: number;
  vz: number;
};

function addWarning(warnings: string[], message: string) {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(message);
  } else if (warnings.length === MAX_WARNINGS) {
    warnings.push(`其余警告已省略（最多显示 ${MAX_WARNINGS} 条）。`);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stripUnsafeControls(value: string) {
  let cleaned = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint >= 0x20) {
      cleaned += character;
    }
  }
  return cleaned;
}

function cleanText(
  value: unknown,
  fallback: string,
  field: string,
  warnings: string[],
  maxLength = 512,
) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    addWarning(warnings, `${field} 不是文本，已使用默认值。`);
    return fallback;
  }
  const cleaned = stripUnsafeControls(String(value)).trim();
  if (!cleaned) return fallback;
  if (cleaned.length > maxLength) {
    addWarning(warnings, `${field} 超过 ${maxLength} 字，已截断。`);
    return cleaned.slice(0, maxLength);
  }
  return cleaned;
}

function cleanId(value: unknown, field: string, warnings: string[]) {
  const id = cleanText(value, "", field, warnings, 128).replace(/\s+/g, " ");
  if (!id) return "";
  return id;
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stablePosition(id: string, ordinal = 0): Position {
  const angle = ((stableHash(`${id}:angle`) / 0x1_0000_0000) * Math.PI * 2) + ordinal * 2.399963;
  const vertical = (stableHash(`${id}:vertical`) / 0x1_0000_0000) * 2 - 1;
  const radius = 72 + (stableHash(`${id}:radius`) % 45);
  const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical)) * radius;
  return {
    x: Math.cos(angle) * ring,
    y: vertical * radius,
    z: Math.sin(angle) * ring,
  };
}

function finiteNumber(
  value: unknown,
  fallback: number,
  field: string,
  warnings: string[],
  min = -COORDINATE_LIMIT,
  max = COORDINATE_LIMIT,
) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    addWarning(warnings, `${field} 不是有限数字，已使用默认值。`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    addWarning(warnings, `${field} 超出允许范围，已限制到 ${min}…${max}。`);
    return Math.max(min, Math.min(max, parsed));
  }
  return parsed;
}

function parseConfidence(value: unknown, fallback: number, field: string, warnings: string[]) {
  if (value === undefined || value === null || value === "") return fallback;
  let parsed: number;
  if (typeof value === "string" && value.trim().endsWith("%")) {
    parsed = Number(value.trim().slice(0, -1)) / 100;
  } else {
    parsed = typeof value === "number" ? value : Number(value);
  }
  if (!Number.isFinite(parsed)) {
    addWarning(warnings, `${field} 不是有效置信度，已使用 ${fallback}。`);
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    addWarning(warnings, `${field} 应在 0…1 之间，已自动限制。`);
    return Math.max(0, Math.min(1, parsed));
  }
  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean, field: string, warnings: string[]) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const normalized = String(value).trim().toLocaleLowerCase();
  if (["true", "1", "yes", "y", "是", "有向"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "否", "无向"].includes(normalized)) return false;
  addWarning(warnings, `${field} 不是有效布尔值，已使用 ${fallback ? "true" : "false"}。`);
  return fallback;
}

function parseNodeKind(value: unknown, field: string, warnings: string[]): NodeKind {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (NODE_KINDS.has(normalized as NodeKind)) return normalized as NodeKind;
  if (normalized) addWarning(warnings, `${field} 的节点类型“${normalized.slice(0, 40)}”未知，已归为 company。`);
  return "company";
}

function inferEdgeKind(label: string): EdgeKind {
  if (/(投资|持股|股权|资本|融资|基金|可转债)/i.test(label)) return "capital";
  if (/(研发|研究|联合开发|专利|技术合作)/i.test(label)) return "research";
  if (/(认证|检测|检验|验收|审计)/i.test(label)) return "certification";
  if (/(支持|补贴|拨款|资助|扶持)/i.test(label)) return "support";
  if (/(交付|运输|物流|配送|承运|运营)/i.test(label)) return "delivery";
  if (/(回收|循环|再生|返供|闭环)/i.test(label)) return "circular";
  if (/(任职|治理|控制|管理|董事|监事|负责人)/i.test(label)) return "governance";
  return "supply";
}

function parseEdgeKind(value: unknown, label: string, field: string, warnings: string[]): EdgeKind {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (EDGE_KINDS.has(normalized as EdgeKind)) return normalized as EdgeKind;
  const inferred = inferEdgeKind(label);
  if (normalized) addWarning(warnings, `${field} 的关系类型“${normalized.slice(0, 40)}”未知，已归为 ${inferred}。`);
  return inferred;
}

function parseRisk(value: unknown): DemoNode["risk"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function parseNodeStatus(value: unknown): DemoNode["status"] {
  return value === "verified" || value === "review" || value === "planned" ? value : "review";
}

function parseEdgeStatus(value: unknown): DemoEdge["status"] {
  return value === "verified" || value === "review" ? value : "review";
}

function parseSources(value: unknown, field: string, warnings: string[]) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  const sources: string[] = [];
  for (const item of values.slice(0, 50)) {
    const source = cleanId(item, field, warnings);
    if (source && !sources.includes(source)) sources.push(source);
  }
  if (values.length > 50) addWarning(warnings, `${field} 最多保留 50 个来源引用。`);
  return sources;
}

function nodeFromJson(value: unknown, index: number, warnings: string[]): DemoNode | null {
  const record = asRecord(value);
  const field = `JSON 节点 ${index + 1}`;
  if (!record) {
    addWarning(warnings, `${field} 不是对象，已跳过。`);
    return null;
  }
  const name = cleanText(record.name ?? record.label, "", `${field}.name`, warnings, 256);
  if (!name) {
    addWarning(warnings, `${field} 缺少 name/label，已跳过。`);
    return null;
  }
  let id = cleanId(record.id, `${field}.id`, warnings);
  if (!id) {
    id = `node-${stableHash(name.normalize("NFKC").toLocaleLowerCase()).toString(36)}`;
    addWarning(warnings, `${field} 缺少 id，已生成稳定 ID“${id}”。`);
  }
  const initial = stablePosition(id, index);
  return {
    id,
    name,
    kind: parseNodeKind(record.kind ?? record.type ?? record.group, `${field}.kind`, warnings),
    subtitle: cleanText(record.subtitle ?? record.role, "导入实体", `${field}.subtitle`, warnings, 512),
    x: finiteNumber(record.x, initial.x, `${field}.x`, warnings),
    y: finiteNumber(record.y, initial.y, `${field}.y`, warnings),
    z: finiteNumber(record.z, initial.z, `${field}.z`, warnings),
    summary: cleanText(record.summary, "由本地文件导入。", `${field}.summary`, warnings, 2_000),
    metric: cleanText(record.metric, "本地导入", `${field}.metric`, warnings, 512),
    risk: parseRisk(record.risk),
    status: parseNodeStatus(record.status),
    sources: parseSources(record.sources, `${field}.sources`, warnings),
  };
}

function edgeFromJson(
  value: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
  sourceName: string,
  warnings: string[],
): DemoEdge | null {
  const record = asRecord(value);
  const field = `JSON 关系 ${index + 1}`;
  if (!record) {
    addWarning(warnings, `${field} 不是对象，已跳过。`);
    return null;
  }
  const source = cleanId(record.source, `${field}.source`, warnings);
  const target = cleanId(record.target, `${field}.target`, warnings);
  if (!source || !target) {
    addWarning(warnings, `${field} 缺少 source/target，已跳过。`);
    return null;
  }
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    addWarning(warnings, `${field} 引用了不存在的端点，已跳过。`);
    return null;
  }
  const label = cleanText(record.label ?? record.relation, "关联", `${field}.label`, warnings, 256);
  const evidence = cleanText(record.evidence, "", `${field}.evidence`, warnings, MAX_FIELD_CHARS);
  let id = cleanId(record.id, `${field}.id`, warnings);
  if (!id) {
    id = `edge-${stableHash(`${source}\u0000${target}\u0000${label}\u0000${evidence}`).toString(36)}`;
  }
  const confidence = parseConfidence(record.confidence, 0.8, `${field}.confidence`, warnings);
  return {
    id,
    source,
    target,
    kind: parseEdgeKind(record.kind ?? record.type, label, `${field}.kind`, warnings),
    label,
    weight: finiteNumber(record.weight, confidence, `${field}.weight`, warnings, 0, 1),
    status: parseEdgeStatus(record.status),
    evidenceId: cleanId(record.evidenceId ?? record.evidence_id, `${field}.evidenceId`, warnings)
      || `IMPORT-${stableHash(`${id}:evidence`).toString(36).toUpperCase()}`,
    evidence,
    sourceTitle: cleanText(record.sourceTitle ?? record.source_title, sourceName, `${field}.sourceTitle`, warnings, 512),
    location: cleanText(record.location, `${field}`, `${field}.location`, warnings, 512),
    confidence,
    directed: parseBoolean(record.directed, false, `${field}.directed`, warnings),
  };
}

function parseJsonGraph(sourceName: string, text: string): GraphFileResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof SyntaxError ? error.message : "未知错误";
    throw new Error(`JSON 解析失败：${message}`);
  }
  const root = asRecord(parsed);
  if (!root) throw new Error("JSON 顶层必须是包含 nodes 与 edges/relations 的对象。");
  if (!Array.isArray(root.nodes)) throw new Error("JSON 缺少 nodes 数组。");
  const rawEdges = Array.isArray(root.edges) ? root.edges : root.relations;
  if (!Array.isArray(rawEdges)) throw new Error("JSON 缺少 edges 或 relations 数组。");
  if (root.nodes.length > MAX_NODES) throw new Error(`节点数超过安全上限 ${MAX_NODES}。`);
  if (rawEdges.length > MAX_EDGES) throw new Error(`关系数超过安全上限 ${MAX_EDGES}。`);

  const nodes: DemoNode[] = [];
  const nodeIds = new Set<string>();
  root.nodes.forEach((value, index) => {
    const node = nodeFromJson(value, index, warnings);
    if (!node) return;
    if (nodeIds.has(node.id)) {
      addWarning(warnings, `节点 ID“${node.id.slice(0, 80)}”重复，后续记录已跳过。`);
      return;
    }
    nodeIds.add(node.id);
    nodes.push(node);
  });
  if (nodes.length === 0) throw new Error("文件中没有有效节点。");

  const edges: DemoEdge[] = [];
  const edgeIds = new Set<string>();
  rawEdges.forEach((value, index) => {
    const edge = edgeFromJson(value, index, nodeIds, sourceName, warnings);
    if (!edge) return;
    if (edgeIds.has(edge.id)) {
      addWarning(warnings, `关系 ID“${edge.id.slice(0, 80)}”重复，后续记录已跳过。`);
      return;
    }
    edgeIds.add(edge.id);
    edges.push(edge);
  });
  if (edges.length === 0) addWarning(warnings, "文件中没有有效关系，仅导入节点。");
  return { nodes, edges, warnings };
}

function parseCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let line = 1;
  let rowLine = 1;
  let inQuotes = false;
  let quoteClosed = false;

  const pushField = () => {
    if (row.length >= 64) throw new Error(`CSV 第 ${rowLine} 行列数超过安全上限 64。`);
    row.push(field);
    field = "";
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== "")) rows.push({ cells: row, line: rowLine });
    if (rows.length > MAX_EDGES + 1) throw new Error(`CSV 数据行超过安全上限 ${MAX_EDGES}。`);
    row = [];
    rowLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        field += "\n";
        line += 1;
      } else {
        field += char;
      }
    } else if (quoteClosed) {
      if (char === ",") {
        pushField();
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        pushRow();
        line += 1;
        rowLine = line;
      } else if (!/\s/.test(char)) {
        throw new Error(`CSV 第 ${line} 行的闭合引号后存在无效字符。`);
      }
    } else if (char === '"') {
      if (field.trim() !== "") throw new Error(`CSV 第 ${line} 行的引号格式无效。`);
      field = "";
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
    if (field.length > MAX_FIELD_CHARS) throw new Error(`CSV 第 ${rowLine} 行字段超过 ${MAX_FIELD_CHARS} 字。`);
  }
  if (inQuotes) throw new Error(`CSV 第 ${rowLine} 行存在未闭合引号。`);
  if (field !== "" || row.length > 0 || quoteClosed) pushRow();
  return rows;
}

function parseCsvGraph(sourceName: string, text: string): GraphFileResult {
  const warnings: string[] = [];
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error("CSV 为空。");

  const headers = rows[0].cells.map((cell) => cell.trim().toLocaleLowerCase());
  const columns = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!header) return;
    if (columns.has(header)) addWarning(warnings, `CSV 表头“${header.slice(0, 80)}”重复，仅使用第一列。`);
    else columns.set(header, index);
  });
  if (!columns.has("source_id") && !columns.has("source_label")) {
    throw new Error("CSV 缺少 source_id/source_label 端点列。");
  }
  if (!columns.has("target_id") && !columns.has("target_label")) {
    throw new Error("CSV 缺少 target_id/target_label 端点列。");
  }
  if (!columns.has("relation")) throw new Error("CSV 缺少 relation 列。");

  const nodes: DemoNode[] = [];
  const nodeById = new Map<string, DemoNode>();
  const edges: DemoEdge[] = [];
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  let generatedEndpointIds = false;

  const cell = (row: CsvRow, column: string) => {
    const index = columns.get(column);
    return index === undefined ? "" : (row.cells[index] ?? "");
  };

  const addNode = (rawId: string, rawLabel: string, lineNumber: number) => {
    const label = cleanText(rawLabel || rawId, "", `CSV 第 ${lineNumber} 行节点名称`, warnings, 256);
    if (!label) return "";
    let id = cleanId(rawId, `CSV 第 ${lineNumber} 行节点 ID`, warnings);
    if (!id) {
      generatedEndpointIds = true;
      const base = `node-${stableHash(label.normalize("NFKC").toLocaleLowerCase()).toString(36)}`;
      id = base;
      let suffix = 2;
      while (nodeById.has(id) && nodeById.get(id)?.name !== label) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
    }
    const existing = nodeById.get(id);
    if (existing) {
      if (existing.name !== label) {
        addWarning(warnings, `CSV 第 ${lineNumber} 行的 ID“${id.slice(0, 80)}”与既有名称冲突，沿用“${existing.name.slice(0, 80)}”。`);
      }
      return id;
    }
    if (nodes.length >= MAX_NODES) throw new Error(`节点数超过安全上限 ${MAX_NODES}。`);
    const position = stablePosition(id, nodes.length);
    const node: DemoNode = {
      id,
      name: label,
      kind: "company",
      subtitle: "CSV 导入实体",
      ...position,
      summary: `由 ${sourceName} 第 ${lineNumber} 行导入。`,
      metric: "本地导入",
      risk: "low",
      status: "review",
      sources: [],
    };
    nodeById.set(id, node);
    nodes.push(node);
    return id;
  };

  for (const row of rows.slice(1)) {
    if (row.cells.length > headers.length) {
      addWarning(warnings, `CSV 第 ${row.line} 行多出的列已忽略。`);
    }
    const source = addNode(cell(row, "source_id"), cell(row, "source_label"), row.line);
    const target = addNode(cell(row, "target_id"), cell(row, "target_label"), row.line);
    const label = cleanText(cell(row, "relation"), "", `CSV 第 ${row.line} 行 relation`, warnings, 256);
    if (!source || !target || !label) {
      addWarning(warnings, `CSV 第 ${row.line} 行缺少有效端点或 relation，已跳过关系。`);
      continue;
    }
    const evidence = cleanText(cell(row, "evidence"), "", `CSV 第 ${row.line} 行 evidence`, warnings, MAX_FIELD_CHARS);
    const directed = parseBoolean(cell(row, "directed"), false, `CSV 第 ${row.line} 行 directed`, warnings);
    const confidence = parseConfidence(cell(row, "confidence"), 0.8, `CSV 第 ${row.line} 行 confidence`, warnings);
    const edgeKey = `${source}\u0000${target}\u0000${label}\u0000${directed}\u0000${evidence}`;
    if (edgeKeys.has(edgeKey)) {
      addWarning(warnings, `CSV 第 ${row.line} 行与既有关系重复，已跳过。`);
      continue;
    }
    edgeKeys.add(edgeKey);
    const baseId = `edge-${stableHash(edgeKey).toString(36)}`;
    let id = baseId;
    let suffix = 2;
    while (edgeIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    edgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      kind: inferEdgeKind(label),
      label,
      weight: confidence,
      status: "review",
      evidenceId: `IMPORT-${stableHash(`${id}:evidence`).toString(36).toUpperCase()}`,
      evidence,
      sourceTitle: sourceName,
      location: `CSV 第 ${row.line} 行`,
      confidence,
      directed,
    });
  }
  if (generatedEndpointIds) addWarning(warnings, "部分端点未提供 ID，已根据规范化名称生成稳定 ID；同名实体会合并。");
  if (nodes.length === 0) throw new Error("CSV 中没有有效节点。");
  if (edges.length === 0) addWarning(warnings, "CSV 中没有有效关系，仅导入节点。");
  return { nodes, edges, warnings };
}

/** Parse a local JSON graph or RFC-4180-style UTF-8 CSV edge list. */
export function parseGraphFile(name: string, text: string): GraphFileResult {
  if (typeof name !== "string" || typeof text !== "string") throw new TypeError("文件名和内容必须是文本。");
  if (text.length > MAX_SOURCE_CHARS) throw new Error("文件超过 10 MB 安全上限。");
  const normalizedText = text.replace(/^\uFEFF/, "");
  if (!normalizedText.trim()) throw new Error("文件为空。");
  const sourceName = cleanText(name, "本地导入", "文件名", [], 256);
  const extension = sourceName.toLocaleLowerCase().split(".").pop();
  if (extension === "json") return parseJsonGraph(sourceName, normalizedText);
  if (extension === "csv") return parseCsvGraph(sourceName, normalizedText);
  const first = normalizedText.trimStart()[0];
  if (first === "{") return parseJsonGraph(sourceName, normalizedText);
  throw new Error("仅支持 .json 或 .csv 图数据文件。");
}

function isPinned(node: DemoNode) {
  return (node as DemoNode & { pinned?: unknown }).pinned === true;
}

function safePosition(node: DemoNode, ordinal: number): Position {
  const fallback = stablePosition(node.id, ordinal);
  return {
    x: Number.isFinite(node.x) ? node.x : fallback.x,
    y: Number.isFinite(node.y) ? node.y : fallback.y,
    z: Number.isFinite(node.z) ? node.z : fallback.z,
  };
}

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function applyPositions<T extends DemoNode>(nodes: readonly T[], positions: ReadonlyMap<string, Position>) {
  return nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || isPinned(node)) return { ...node };
    return {
      ...node,
      x: rounded(position.x),
      y: rounded(position.y),
      z: rounded(position.z),
    };
  });
}

function validEdges(nodes: readonly DemoNode[], edges: readonly DemoEdge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  return edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

function forceLayout<T extends DemoNode>(nodes: readonly T[], edges: readonly DemoEdge[]): T[] {
  const ordered = nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const work: WorkNode[] = ordered.map((node, index) => {
    const position = isPinned(node) ? safePosition(node, index) : stablePosition(node.id, index);
    return { id: node.id, ...position, pinned: isPinned(node), vx: 0, vy: 0, vz: 0 };
  });
  const indexById = new Map(work.map((node, index) => [node.id, index]));
  const links = validEdges(ordered, edges)
    .map((edge) => [indexById.get(edge.source), indexById.get(edge.target)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);
  const count = work.length;
  const iterations = count <= 80 ? 180 : count <= 500 ? 120 : 70;
  const sampleCount = 32;

  for (let tick = 0; tick < iterations; tick += 1) {
    const alpha = Math.max(0.035, 1 - tick / iterations);
    const fx = new Float64Array(count);
    const fy = new Float64Array(count);
    const fz = new Float64Array(count);

    if (count <= 500) {
      for (let left = 0; left < count; left += 1) {
        for (let right = left + 1; right < count; right += 1) {
          let dx = work[left].x - work[right].x;
          let dy = work[left].y - work[right].y;
          let dz = work[left].z - work[right].z;
          let distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared < 0.01) {
            const angle = (stableHash(`${work[left].id}:${work[right].id}`) / 0x1_0000_0000) * Math.PI * 2;
            dx = Math.cos(angle) * 0.1;
            dy = Math.sin(angle) * 0.1;
            dz = 0.05;
            distanceSquared = 0.0225;
          }
          const strength = (2_900 * alpha) / distanceSquared;
          fx[left] += dx * strength;
          fy[left] += dy * strength;
          fz[left] += dz * strength;
          fx[right] -= dx * strength;
          fy[right] -= dy * strength;
          fz[right] -= dz * strength;
        }
      }
    } else {
      for (let left = 0; left < count; left += 1) {
        let seed = (stableHash(work[left].id) ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0;
        for (let sample = 0; sample < sampleCount; sample += 1) {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          const right = seed % count;
          if (right === left) continue;
          const dx = work[left].x - work[right].x;
          const dy = work[left].y - work[right].y;
          const dz = work[left].z - work[right].z;
          const distanceSquared = Math.max(0.01, dx * dx + dy * dy + dz * dz);
          const strength = (2_900 * alpha * count) / (sampleCount * distanceSquared);
          fx[left] += dx * strength;
          fy[left] += dy * strength;
          fz[left] += dz * strength;
        }
      }
    }

    for (const [sourceIndex, targetIndex] of links) {
      const source = work[sourceIndex];
      const target = work[targetIndex];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
      const strength = (distance - 88) * 0.018 * alpha;
      const sx = (dx / distance) * strength;
      const sy = (dy / distance) * strength;
      const sz = (dz / distance) * strength;
      fx[sourceIndex] += sx;
      fy[sourceIndex] += sy;
      fz[sourceIndex] += sz;
      fx[targetIndex] -= sx;
      fy[targetIndex] -= sy;
      fz[targetIndex] -= sz;
    }

    for (let index = 0; index < count; index += 1) {
      const node = work[index];
      if (node.pinned) continue;
      fx[index] -= node.x * 0.006 * alpha;
      fy[index] -= node.y * 0.006 * alpha;
      fz[index] -= node.z * 0.009 * alpha;
      node.vx = (node.vx + fx[index]) * 0.76;
      node.vy = (node.vy + fy[index]) * 0.76;
      node.vz = (node.vz + fz[index]) * 0.76;
      const speed = Math.hypot(node.vx, node.vy, node.vz);
      const limiter = speed > 12 ? 12 / speed : 1;
      node.x += node.vx * limiter;
      node.y += node.vy * limiter;
      node.z += node.vz * limiter;
    }
  }

  if (!work.some((node) => node.pinned) && work.length > 0) {
    const center = work.reduce(
      (sum, node) => ({ x: sum.x + node.x, y: sum.y + node.y, z: sum.z + node.z }),
      { x: 0, y: 0, z: 0 },
    );
    center.x /= work.length;
    center.y /= work.length;
    center.z /= work.length;
    work.forEach((node) => {
      node.x -= center.x;
      node.y -= center.y;
      node.z -= center.z;
    });
  }
  return applyPositions(nodes, new Map(work.map((node) => [node.id, node])));
}

function buildAdjacency(nodes: readonly DemoNode[], edges: readonly DemoEdge[]) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of validEdges(nodes, edges)) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  return adjacency;
}

function chooseRoot(ids: readonly string[], adjacency: ReadonlyMap<string, ReadonlySet<string>>, preferred?: string) {
  if (preferred && ids.includes(preferred)) return preferred;
  return ids.slice().sort((left, right) => {
    const degreeDifference = (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0);
    return degreeDifference || left.localeCompare(right);
  })[0];
}

function radialLayout<T extends DemoNode>(nodes: readonly T[], edges: readonly DemoEdge[], rootId?: string): T[] {
  if (nodes.length === 0) return [];
  const ordered = nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(ordered.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(ordered, edges);
  const remaining = new Set(ordered.map((node) => node.id));
  const componentSeeds = rootId && remaining.has(rootId)
    ? [rootId, ...ordered.map((node) => node.id).filter((id) => id !== rootId)]
    : ordered.map((node) => node.id);
  const positions = new Map<string, Position>();
  let componentIndex = 0;

  for (const seed of componentSeeds) {
    if (!remaining.has(seed)) continue;
    const component: string[] = [];
    const discover = [seed];
    remaining.delete(seed);
    for (let cursor = 0; cursor < discover.length; cursor += 1) {
      const id = discover[cursor];
      component.push(id);
      const neighbors = [...(adjacency.get(id) ?? [])].sort();
      for (const neighbor of neighbors) {
        if (!remaining.has(neighbor)) continue;
        remaining.delete(neighbor);
        discover.push(neighbor);
      }
    }

    const componentRoot = chooseRoot(component, adjacency, componentIndex === 0 ? rootId : undefined);
    const componentIds = new Set(component);
    const levels = new Map<string, number>([[componentRoot, 0]]);
    const queue = [componentRoot];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      for (const neighbor of [...(adjacency.get(id) ?? [])].sort()) {
        if (!componentIds.has(neighbor) || levels.has(neighbor)) continue;
        levels.set(neighbor, (levels.get(id) ?? 0) + 1);
        queue.push(neighbor);
      }
    }

    const componentAngle = componentIndex * 2.399963;
    const componentRadius = componentIndex === 0 ? 0 : 260 + Math.floor((componentIndex - 1) / 6) * 180;
    let centerX = Math.cos(componentAngle) * componentRadius;
    let centerY = Math.sin(componentAngle) * componentRadius;
    let centerZ = 0;
    const rootNode = nodeById.get(componentRoot);
    if (rootNode && isPinned(rootNode)) {
      const pinned = safePosition(rootNode, 0);
      centerX = pinned.x;
      centerY = pinned.y;
      centerZ = pinned.z;
    }

    const byLevel = new Map<number, string[]>();
    for (const id of component) {
      const level = levels.get(id) ?? 0;
      const bucket = byLevel.get(level) ?? [];
      bucket.push(id);
      byLevel.set(level, bucket);
    }
    for (const [level, ids] of [...byLevel.entries()].sort((left, right) => left[0] - right[0])) {
      ids.sort((left, right) => {
        const kindOrder = nodeById.get(left)?.kind.localeCompare(nodeById.get(right)?.kind ?? "") ?? 0;
        return kindOrder || left.localeCompare(right);
      });
      ids.forEach((id, index) => {
        const node = nodeById.get(id)!;
        if (isPinned(node)) {
          positions.set(id, safePosition(node, index));
          return;
        }
        if (level === 0) {
          positions.set(id, { x: centerX, y: centerY, z: centerZ });
          return;
        }
        const offset = (stableHash(`${componentRoot}:${level}`) / 0x1_0000_0000) * Math.PI * 2;
        const angle = offset + (index / ids.length) * Math.PI * 2;
        const radius = level * 78;
        const lane = (stableHash(node.kind) % 5) - 2;
        positions.set(id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          z: centerZ + lane * 14,
        });
      });
    }
    componentIndex += 1;
  }
  return applyPositions(nodes, positions);
}

function layeredLayout<T extends DemoNode>(nodes: readonly T[], edges: readonly DemoEdge[], rootId?: string): T[] {
  if (nodes.length === 0) return [];
  const ordered = nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set(ordered.map((node) => node.id));
  const outgoing = new Map(ordered.map((node) => [node.id, new Set<string>()]));
  const indegree = new Map(ordered.map((node) => [node.id, 0]));
  for (const edge of validEdges(ordered, edges)) {
    let source = edge.source;
    let target = edge.target;
    if (!edge.directed && source.localeCompare(target) > 0) [source, target] = [target, source];
    if (outgoing.get(source)?.has(target)) continue;
    outgoing.get(source)?.add(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const seeds: string[] = [];
  if (rootId && ids.has(rootId)) seeds.push(rootId);
  for (const node of ordered) {
    if ((indegree.get(node.id) ?? 0) === 0 && !seeds.includes(node.id)) seeds.push(node.id);
  }
  const visitFrom = (seed: string) => {
    if (!levels.has(seed)) levels.set(seed, 0);
    const queue = [seed];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      const level = levels.get(id) ?? 0;
      for (const target of [...(outgoing.get(id) ?? [])].sort()) {
        if (levels.has(target)) continue;
        levels.set(target, level + 1);
        queue.push(target);
      }
    }
  };
  seeds.forEach(visitFrom);
  while (levels.size < ordered.length) {
    const next = ordered
      .filter((node) => !levels.has(node.id))
      .sort((left, right) => {
        const degreeDifference = (outgoing.get(right.id)?.size ?? 0) - (outgoing.get(left.id)?.size ?? 0);
        return degreeDifference || left.id.localeCompare(right.id);
      })[0];
    visitFrom(next.id);
  }

  const byLevel = new Map<number, T[]>();
  for (const node of ordered) {
    const level = levels.get(node.id) ?? 0;
    const bucket = byLevel.get(level) ?? [];
    bucket.push(node);
    byLevel.set(level, bucket);
  }
  const maxLevel = Math.max(...byLevel.keys(), 0);
  const positions = new Map<string, Position>();
  for (const [level, levelNodes] of [...byLevel.entries()].sort((left, right) => left[0] - right[0])) {
    levelNodes.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    levelNodes.forEach((node, index) => {
      if (isPinned(node)) {
        positions.set(node.id, safePosition(node, index));
        return;
      }
      positions.set(node.id, {
        x: (level - maxLevel / 2) * 155,
        y: (index - (levelNodes.length - 1) / 2) * 72,
        z: ((stableHash(node.kind) % 5) - 2) * 18,
      });
    });
  }
  return applyPositions(nodes, positions);
}

/** Return a deterministic layout without mutating input; nodes carrying `pinned: true` keep their coordinates. */
export function layoutGraph<T extends DemoNode>(
  nodes: readonly T[],
  edges: readonly DemoEdge[],
  mode: StudioLayoutMode,
  rootId?: string,
): T[] {
  if (mode === "force") return forceLayout(nodes, edges);
  if (mode === "radial") return radialLayout(nodes, edges, rootId);
  if (mode === "layered") return layeredLayout(nodes, edges, rootId);
  const exhaustive: never = mode;
  throw new Error(`未知布局：${exhaustive}`);
}

/** Escape text for XML 1.0 while preserving valid Chinese and supplementary Unicode characters. */
export function escapeXml(value: string) {
  let valid = "";
  for (const character of String(value ?? "")) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      valid += character;
    }
  }
  return valid
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function svgNumber(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}

function nodeRadius(node: DemoNode) {
  if (node.risk === "high") return 13;
  if (node.risk === "medium") return 11.5;
  return 10;
}

/** Serialize the current orthographic x/y projection. All imported text is XML-escaped. */
export function projectToSvg(
  nodes: readonly DemoNode[],
  edges: readonly DemoEdge[],
  width: number,
  height: number,
  visibleNodeIds?: Iterable<string>,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("SVG 宽高必须是正的有限数字。");
  }
  const safeWidth = Math.min(16_384, Math.max(1, Math.round(width)));
  const safeHeight = Math.min(16_384, Math.max(1, Math.round(height)));
  const requested = visibleNodeIds ? new Set(visibleNodeIds) : null;
  const seen = new Set<string>();
  const visibleNodes = nodes
    .filter((node) => {
      if ((requested && !requested.has(node.id)) || seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    })
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));

  const margin = Math.max(24, Math.min(80, safeWidth * 0.1, safeHeight * 0.1));
  const xs = visibleNodes.map((node, index) => safePosition(node, index).x);
  const ys = visibleNodes.map((node, index) => safePosition(node, index).y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);
  const drawableWidth = Math.max(1, safeWidth - margin * 2);
  const drawableHeight = Math.max(1, safeHeight - margin * 2);
  const scale = Math.min(drawableWidth / rangeX, drawableHeight / rangeY);
  const offsetX = (safeWidth - rangeX * scale) / 2 - minX * scale;
  const offsetY = (safeHeight - rangeY * scale) / 2 - minY * scale;
  const points = new Map<string, Position>();
  visibleNodes.forEach((node, index) => {
    const position = safePosition(node, index);
    points.set(node.id, { x: position.x * scale + offsetX, y: position.y * scale + offsetY, z: position.z });
  });

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="关系网络导出">`,
    "<metadata>Relationship Studio local SVG export</metadata>",
    "<defs>",
    '<radialGradient id="background" cx="52%" cy="45%" r="75%"><stop offset="0" stop-color="#142029"/><stop offset="0.58" stop-color="#091116"/><stop offset="1" stop-color="#04080b"/></radialGradient>',
    '<filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
    "</defs>",
    `<rect width="${safeWidth}" height="${safeHeight}" fill="url(#background)"/>`,
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
  ];

  for (const edge of visibleEdges) {
    const source = points.get(edge.source);
    const target = points.get(edge.target);
    if (!source || !target) continue;
    const color = EDGE_COLORS[edge.kind] ?? EDGE_COLORS.supply;
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourceRadius = sourceNode ? nodeRadius(sourceNode) : 10;
    const targetRadius = targetNode ? nodeRadius(targetNode) : 10;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    const opacity = 0.35 + Math.max(0, Math.min(1, edge.confidence)) * 0.55;
    parts.push(`<g><title>${escapeXml(`${edge.label}${edge.evidence ? ` — ${edge.evidence}` : ""}`)}</title>`);
    if (distance < 0.01 || edge.source === edge.target) {
      const radius = sourceRadius + 12;
      parts.push(`<path d="M ${svgNumber(source.x + sourceRadius * 0.7)} ${svgNumber(source.y - sourceRadius * 0.7)} C ${svgNumber(source.x + radius * 2)} ${svgNumber(source.y - radius * 2)}, ${svgNumber(source.x - radius * 2)} ${svgNumber(source.y - radius * 2)}, ${svgNumber(source.x - sourceRadius * 0.7)} ${svgNumber(source.y - sourceRadius * 0.7)}" stroke="${color}" stroke-opacity="${svgNumber(opacity)}" stroke-width="1.5"/>`);
    } else {
      const ux = dx / distance;
      const uy = dy / distance;
      const startX = source.x + ux * (sourceRadius + 2);
      const startY = source.y + uy * (sourceRadius + 2);
      const tipX = target.x - ux * (targetRadius + 2);
      const tipY = target.y - uy * (targetRadius + 2);
      const baseX = edge.directed ? tipX - ux * 8 : tipX;
      const baseY = edge.directed ? tipY - uy * 8 : tipY;
      parts.push(`<line x1="${svgNumber(startX)}" y1="${svgNumber(startY)}" x2="${svgNumber(baseX)}" y2="${svgNumber(baseY)}" stroke="${color}" stroke-opacity="${svgNumber(opacity)}" stroke-width="${svgNumber(1 + edge.weight * 1.4)}"/>`);
      if (edge.directed) {
        const perpendicularX = -uy * 4;
        const perpendicularY = ux * 4;
        parts.push(`<path d="M ${svgNumber(tipX)} ${svgNumber(tipY)} L ${svgNumber(baseX + perpendicularX)} ${svgNumber(baseY + perpendicularY)} L ${svgNumber(baseX - perpendicularX)} ${svgNumber(baseY - perpendicularY)} Z" fill="${color}" fill-opacity="${svgNumber(opacity)}" stroke="none"/>`);
      }
    }
    parts.push("</g>");
  }
  parts.push("</g>");

  if (visibleEdges.length <= 100) {
    parts.push('<g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" text-anchor="middle">');
    for (const edge of visibleEdges) {
      const source = points.get(edge.source);
      const target = points.get(edge.target);
      if (!source || !target) continue;
      const x = edge.source === edge.target ? source.x : (source.x + target.x) / 2;
      const y = edge.source === edge.target ? source.y - 30 : (source.y + target.y) / 2;
      const label = escapeXml(edge.label);
      const labelWidth = Math.max(28, Math.min(160, [...edge.label].length * 9 + 12));
      parts.push(`<rect x="${svgNumber(x - labelWidth / 2)}" y="${svgNumber(y - 8)}" width="${svgNumber(labelWidth)}" height="16" rx="3" fill="#04080b" fill-opacity="0.82"/>`);
      parts.push(`<text x="${svgNumber(x)}" y="${svgNumber(y + 3)}" fill="${EDGE_COLORS[edge.kind] ?? EDGE_COLORS.supply}">${label}</text>`);
    }
    parts.push("</g>");
  }

  parts.push('<g font-family="Arial, Helvetica, PingFang SC, Microsoft YaHei, sans-serif" text-anchor="middle">');
  for (const node of visibleNodes) {
    const point = points.get(node.id)!;
    const radius = nodeRadius(node);
    const color = NODE_COLORS[node.kind] ?? NODE_COLORS.company;
    parts.push(`<g><title>${escapeXml(`${node.name}${node.subtitle ? ` — ${node.subtitle}` : ""}`)}</title>`);
    parts.push(`<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius + 5)}" fill="${color}" fill-opacity="0.12" filter="url(#node-glow)"/>`);
    parts.push(`<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${color}" stroke="#f1f6f5" stroke-opacity="0.72" stroke-width="1"/>`);
    if (visibleNodes.length <= 150) {
      parts.push(`<text x="${svgNumber(point.x)}" y="${svgNumber(point.y + radius + 18)}" fill="#eef5f3" font-size="12" font-weight="600">${escapeXml(node.name)}</text>`);
      if (visibleNodes.length <= 60 && node.subtitle) {
        parts.push(`<text x="${svgNumber(point.x)}" y="${svgNumber(point.y + radius + 33)}" fill="#93a19f" font-size="9">${escapeXml(node.subtitle)}</text>`);
      }
    }
    parts.push("</g>");
  }
  parts.push("</g>");

  if (visibleNodes.length === 0) {
    parts.push(`<text x="${safeWidth / 2}" y="${safeHeight / 2}" fill="#8d9a98" font-family="Arial, Helvetica, PingFang SC, Microsoft YaHei, sans-serif" font-size="14" text-anchor="middle">没有可见节点</text>`);
  }
  parts.push("</svg>");
  return parts.join("\n");
}
