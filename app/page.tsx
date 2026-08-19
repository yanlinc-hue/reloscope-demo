"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type NodeGroup = "amber" | "teal" | "coral" | "violet";
type EdgeTone = "kin" | "ally" | "conflict" | "secret";

type GraphNode = {
  id: string;
  label: string;
  role: string;
  group: NodeGroup;
  x: number;
  y: number;
  z: number;
  pinned?: boolean;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: EdgeTone;
  evidence: string;
  confidence: number;
  directed: boolean;
};

type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

const EXAMPLES = {
  mystery: {
    label: "悬疑样例",
    text: "林默是苏晚的哥哥，也是调查记者。苏晚和周野是多年好友。周野曾是顾辰的下属，却在一次调查中背叛了顾辰。顾辰把林默视为敌人。沈岚暗中保护苏晚，同时也是顾辰的合作伙伴。林默怀疑沈岚隐瞒了真相。",
  },
  family: {
    label: "家族样例",
    text: "程砚是程夏的哥哥。程夏和陆川是恋人。陆川是许宁的学生。许宁暗中帮助程砚。陆川欺骗了程夏。程砚怀疑陆川。程夏把许宁视为朋友。",
  },
};

const INITIAL_NODES: GraphNode[] = [
  { id: "lin", label: "林默", role: "调查记者", group: "amber", x: -42, y: -5, z: 12 },
  { id: "su", label: "苏晚", role: "摄影师", group: "teal", x: 12, y: 18, z: 6 },
  { id: "zhou", label: "周野", role: "线人", group: "teal", x: 55, y: -12, z: -8 },
  { id: "gu", label: "顾辰", role: "集团负责人", group: "coral", x: 28, y: -55, z: 26 },
  { id: "shen", label: "沈岚", role: "律师", group: "violet", x: -24, y: 50, z: -24 },
];

const INITIAL_EDGES: GraphEdge[] = [
  { id: "lin-su", source: "lin", target: "su", label: "兄妹", tone: "kin", evidence: "林默是苏晚的哥哥，也是调查记者。", confidence: 0.98, directed: false },
  { id: "su-zhou", source: "su", target: "zhou", label: "好友", tone: "ally", evidence: "苏晚和周野是多年好友。", confidence: 0.96, directed: false },
  { id: "zhou-gu", source: "zhou", target: "gu", label: "背叛", tone: "conflict", evidence: "周野曾是顾辰的下属，却在一次调查中背叛了顾辰。", confidence: 0.91, directed: true },
  { id: "gu-lin", source: "gu", target: "lin", label: "敌对", tone: "conflict", evidence: "顾辰把林默视为敌人。", confidence: 0.97, directed: true },
  { id: "shen-su", source: "shen", target: "su", label: "保护", tone: "secret", evidence: "沈岚暗中保护苏晚，同时也是顾辰的合作伙伴。", confidence: 0.92, directed: true },
  { id: "shen-gu", source: "shen", target: "gu", label: "合作", tone: "ally", evidence: "沈岚暗中保护苏晚，同时也是顾辰的合作伙伴。", confidence: 0.89, directed: false },
  { id: "lin-shen", source: "lin", target: "shen", label: "怀疑", tone: "secret", evidence: "林默怀疑沈岚隐瞒了真相。", confidence: 0.88, directed: true },
];

const EDGE_COLORS: Record<EdgeTone, string> = {
  kin: "#f1c98f",
  ally: "#63d8c6",
  conflict: "#ff705f",
  secret: "#a998f4",
};

const NODE_COLORS: Record<NodeGroup, string> = {
  amber: "#f1c98f",
  teal: "#63d8c6",
  coral: "#ff705f",
  violet: "#a998f4",
};

const RELATION_TONE: Record<string, EdgeTone> = {
  哥哥: "kin", 妹妹: "kin", 姐姐: "kin", 弟弟: "kin", 父亲: "kin", 母亲: "kin", 丈夫: "kin", 妻子: "kin", 夫妻: "kin", 兄妹: "kin", 姐妹: "kin",
  朋友: "ally", 好友: "ally", 同事: "ally", 恋人: "ally", 盟友: "ally", 合作伙伴: "ally", 合作: "ally", 帮助: "ally", 支持: "ally", 收养: "kin", 救助: "ally",
  敌人: "conflict", 敌对: "conflict", 背叛: "conflict", 憎恨: "conflict", 欺骗: "conflict", 命令: "conflict",
  保护: "secret", 怀疑: "secret", 追随: "secret", 调查: "secret", 监视: "secret", 喜欢: "secret", 爱上: "secret",
};

const NAME = "(?:(?:欧阳|司马|上官|诸葛|慕容|公孙)[\\u4e00-\\u9fff]{1,2}|[\\u4e00-\\u9fff]{2})";
const RELATIONS = "哥哥|妹妹|姐姐|弟弟|父亲|母亲|丈夫|妻子|老师|学生|上司|下属|朋友|好友|恋人|盟友|敌人|合作伙伴";
const VERBS = "帮助|保护|背叛|喜欢|爱上|憎恨|怀疑|追随|命令|欺骗|收养|支持|监视|救助";
const OCCUPATIONS = ["调查记者", "集团负责人", "摄影师", "研究员", "负责人", "记者", "律师", "医生", "警察", "侦探", "老师", "学生", "导演", "演员", "作家", "画家", "秘书", "经理", "总裁", "线人"];

function relationLabel(raw: string) {
  const pairs: Record<string, string> = { 哥哥: "兄妹", 妹妹: "兄妹", 姐姐: "姐妹", 弟弟: "兄弟", 父亲: "父女/父子", 母亲: "母女/母子", 丈夫: "夫妻", 妻子: "夫妻", 敌人: "敌对", 合作伙伴: "合作", 救助: "救助" };
  return pairs[raw] ?? raw;
}

function hashName(name: string) {
  return [...name].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
}

function layoutNodes(names: string[], roles: Map<string, string>): GraphNode[] {
  const groups: NodeGroup[] = ["amber", "teal", "coral", "violet"];
  return names.slice(0, 20).map((label, index, list) => {
    const spread = list.length === 1 ? 0 : index / (list.length - 1);
    const y = (spread * 2 - 1) * 52;
    const ring = Math.sqrt(Math.max(0, 1 - Math.pow(spread * 2 - 1, 2))) * 72;
    const angle = index * 2.399963;
    return {
      id: `n-${hashName(label)}-${index}`,
      label,
      role: roles.get(label) ?? "人物",
      group: groups[hashName(label) % groups.length],
      x: Math.cos(angle) * ring,
      y,
      z: Math.sin(angle) * ring,
    };
  });
}

function extractGraph(input: string): GraphData {
  const sentences = input.split(/[。！？!?\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 80);
  const relationDrafts: Array<{ source: string; target: string; raw: string; evidence: string; directed: boolean; confidence: number }> = [];
  const people = new Set<string>();
  const roles = new Map<string, string>();

  const add = (source: string, target: string, raw: string, evidence: string, directed: boolean, confidence: number) => {
    if (!source || !target || source === target) return;
    const cleanSource = source.replace(/^(同时|后来|原来|其实)/, "");
    const cleanTarget = target.replace(/(之间|二人|两人)$/, "");
    if (cleanSource.length < 2 || cleanTarget.length < 2) return;
    people.add(cleanSource);
    people.add(cleanTarget);
    const label = relationLabel(raw);
    if (relationDrafts.some((item) => item.source === cleanSource && item.target === cleanTarget && relationLabel(item.raw) === label)) return;
    relationDrafts.push({ source: cleanSource, target: cleanTarget, raw, evidence: `${evidence}。`, directed, confidence });
  };

  sentences.forEach((sentence) => {
    const clauses = sentence.split(/[，,；;]/).map((item) => item.trim()).filter(Boolean);
    let subject = "";
    clauses.forEach((clause) => {
      const leading = clause.match(new RegExp(`^(${NAME})(?=曾经|曾|暗中|公开|一直|正在|后来|是|和|与|把|将|${VERBS})`));
      if (leading) subject = leading[1];

      const possessive = new RegExp(`(${NAME})(?:曾经|曾)?是(${NAME})的(${RELATIONS})`, "g");
      for (const match of clause.matchAll(possessive)) {
        subject = match[1];
        add(match[1], match[2], match[3], sentence, !["哥哥", "妹妹", "姐姐", "弟弟", "父亲", "母亲", "丈夫", "妻子", "朋友", "好友"].includes(match[3]), 0.96);
      }

      const paired = new RegExp(`(${NAME})(?:和|与)(${NAME})是(?:多年|曾经|一直)?(${RELATIONS}|夫妻|兄妹|姐妹)`, "g");
      for (const match of clause.matchAll(paired)) {
        subject = match[1];
        add(match[1], match[2], match[3], sentence, false, 0.95);
      }

      const viewed = new RegExp(`(${NAME})(?:把|将)(${NAME})视为(${RELATIONS}|朋友)`);
      const viewedMatch = clause.match(viewed);
      if (viewedMatch) {
        subject = viewedMatch[1];
        add(viewedMatch[1], viewedMatch[2], viewedMatch[3], sentence, true, 0.94);
      }

      const explicitVerb = new RegExp(`^(${NAME})(?:曾经|曾|暗中|公开|一直|正在|后来|也)?(?:[^\\u4e00-\\u9fff]{0,2})?(${VERBS})(?:了)?(${NAME})`);
      const explicitMatch = clause.match(explicitVerb);
      if (explicitMatch) {
        subject = explicitMatch[1];
        add(explicitMatch[1], explicitMatch[3], explicitMatch[2], sentence, true, 0.9);
      } else if (subject) {
        const carriedVerb = clause.match(new RegExp(`(${VERBS})(?:了)?(${NAME})`));
        if (carriedVerb) add(subject, carriedVerb[2], carriedVerb[1], sentence, true, 0.86);
      }

      if (subject) {
        const carriedRelation = clause.match(new RegExp(`(?:也是|仍是|成为|是)(${NAME})的(${RELATIONS})`));
        if (carriedRelation) add(subject, carriedRelation[1], carriedRelation[2], sentence, carriedRelation[2] !== "合作伙伴", 0.87);
        const occupation = OCCUPATIONS.find((item) => new RegExp(`(?:也是|职业是|担任|是)${item}`).test(clause));
        if (occupation) roles.set(subject, occupation);
      }
    });
  });

  const names = [...people];
  const nodes = layoutNodes(names, roles);
  const idByName = new Map(nodes.map((node) => [node.label, node.id]));
  const edges = relationDrafts
    .filter((item) => idByName.has(item.source) && idByName.has(item.target))
    .slice(0, 32)
    .map((item, index) => {
      const label = relationLabel(item.raw);
      return {
        id: `e-${index}-${hashName(item.source + item.target + label)}`,
        source: idByName.get(item.source)!,
        target: idByName.get(item.target)!,
        label,
        tone: RELATION_TONE[item.raw] ?? RELATION_TONE[label] ?? "secret",
        evidence: item.evidence,
        confidence: item.confidence,
        directed: item.directed,
      };
    });
  return { nodes, edges };
}

function RelationshipCanvas({ nodes, edges, selectedId, resetKey, onSelect, onNodeMove }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  resetKey: number;
  onSelect: (id: string | null) => void;
  onNodeMove: (id: string, position: Pick<GraphNode, "x" | "y" | "z">) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const selectedRef = useRef(selectedId);
  const viewRef = useRef({ rx: -0.18, ry: 0.42, zoom: 1.75 });
  const callbacksRef = useRef({ onSelect, onNodeMove });

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { callbacksRef.current = { onSelect, onNodeMove }; }, [onSelect, onNodeMove]);
  useEffect(() => { viewRef.current = { rx: -0.18, ry: 0.42, zoom: 1.75 }; }, [resetKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let projected: Array<{ id: string; x: number; y: number; r: number; depth: number; scale: number }> = [];
    let hoverId: string | null = null;
    let interaction: { kind: "view" | "node"; id?: string; px: number; py: number; moved: boolean } | null = null;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const project = (node: GraphNode) => {
      const { rx, ry, zoom } = viewRef.current;
      const cy = Math.cos(ry);
      const sy = Math.sin(ry);
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const x1 = node.x * cy - node.z * sy;
      const z1 = node.x * sy + node.z * cy;
      const y1 = node.y * cx - z1 * sx;
      const z2 = node.y * sx + z1 * cx;
      const scale = (360 / (430 + z2)) * zoom;
      return { x: width / 2 + x1 * scale, y: height / 2 + y1 * scale, depth: z2, scale, x1, y1 };
    };

    const moveOnCameraPlane = (node: GraphNode, dx: number, dy: number) => {
      const point = project(node);
      const { rx, ry } = viewRef.current;
      const nextX1 = point.x1 + dx / point.scale;
      const nextY1 = point.y1 + dy / point.scale;
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const cy = Math.cos(ry);
      const sy = Math.sin(ry);
      const y = nextY1 * cx + point.depth * sx;
      const z1 = -nextY1 * sx + point.depth * cx;
      return { x: nextX1 * cy + z1 * sy, y, z: -nextX1 * sy + z1 * cy };
    };

    const drawArrow = (source: { x: number; y: number }, target: { x: number; y: number }, radius: number, color: string) => {
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const tipX = target.x - Math.cos(angle) * Math.max(13, radius + 3);
      const tipY = target.y - Math.sin(angle) * Math.max(13, radius + 3);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.55) * 7, tipY - Math.sin(angle - 0.55) * 7);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle + 0.55) * 7, tipY - Math.sin(angle + 0.55) * 7);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createRadialGradient(width * 0.54, height * 0.46, 20, width * 0.54, height * 0.46, width * 0.72);
      background.addColorStop(0, "#131c22");
      background.addColorStop(0.55, "#091016");
      background.addColorStop(1, "#04080b");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      for (let index = 0; index < 86; index += 1) {
        const x = (index * 83.17) % Math.max(width, 1);
        const y = (index * index * 19.31) % Math.max(height, 1);
        const alpha = 0.1 + ((index * 17) % 30) / 100;
        ctx.fillStyle = `rgba(220,235,238,${alpha})`;
        const size = index % 7 === 0 ? 1.4 : 0.8;
        ctx.fillRect(x, y, size, size);
      }

      const points = new Map(nodesRef.current.map((node) => [node.id, project(node)]));
      edgesRef.current.forEach((edge) => {
        const source = points.get(edge.source);
        const target = points.get(edge.target);
        if (!source || !target) return;
        const active = selectedRef.current === edge.source || selectedRef.current === edge.target;
        const color = EDGE_COLORS[edge.tone];
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = `${color}${active ? "dd" : "76"}`;
        ctx.lineWidth = active ? 2 : 1.15;
        ctx.stroke();
        if (edge.directed) drawArrow(source, target, 13 * target.scale, `${color}${active ? "ee" : "99"}`);
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        const textWidth = ctx.measureText(edge.label).width;
        ctx.fillStyle = "rgba(4,8,11,.84)";
        ctx.fillRect(mx - textWidth / 2 - 5, my - 8, textWidth + 10, 16);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(edge.label, mx, my + 3);
      });

      projected = nodesRef.current.map((node) => {
        const point = points.get(node.id)!;
        return { id: node.id, x: point.x, y: point.y, r: 14 * point.scale, depth: point.depth, scale: point.scale };
      }).sort((a, b) => a.depth - b.depth);

      projected.forEach((point) => {
        const node = nodesRef.current.find((item) => item.id === point.id)!;
        const palette = NODE_COLORS[node.group];
        const active = selectedRef.current === node.id || hoverId === node.id;
        const glow = ctx.createRadialGradient(point.x, point.y, 1, point.x, point.y, point.r * (active ? 3.2 : 2.4));
        glow.addColorStop(0, `${palette}${active ? "88" : "55"}`);
        glow.addColorStop(1, `${palette}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.r * (active ? 3.2 : 2.4), 0, Math.PI * 2);
        ctx.fill();
        if (active) {
          ctx.strokeStyle = `${palette}aa`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, Math.max(11, point.r + 6), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = palette;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(7, point.r), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.72)";
        ctx.stroke();
        if (node.pinned) {
          ctx.fillStyle = "#eaf5f2";
          ctx.fillRect(point.x + point.r * 0.55, point.y - point.r * 0.8, 4, 4);
        }
        if (nodesRef.current.length <= 14 || active) {
          ctx.fillStyle = "#eef5f3";
          ctx.font = "600 13px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(node.label, point.x, point.y + point.r + 19);
          ctx.fillStyle = "rgba(214,225,225,.58)";
          ctx.font = "10px system-ui, sans-serif";
          ctx.fillText(node.role, point.x, point.y + point.r + 34);
        }
      });

      if (nodesRef.current.length === 0) {
        ctx.fillStyle = "rgba(214,225,225,.5)";
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("在左侧输入文本，生成第一张关系星图", width / 2, height / 2);
      }
      frame = requestAnimationFrame(draw);
    };

    const hitAt = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      return [...projected].reverse().find((point) => Math.hypot(point.x - x, point.y - y) < Math.max(18, point.r * 1.45));
    };

    const pointerDown = (event: PointerEvent) => {
      const hit = hitAt(event);
      interaction = { kind: hit ? "node" : "view", id: hit?.id, px: event.clientX, py: event.clientY, moved: false };
      if (hit) callbacksRef.current.onSelect(hit.id);
      else callbacksRef.current.onSelect(null);
      canvas.style.cursor = hit ? "move" : "grabbing";
      canvas.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      if (!interaction) {
        hoverId = hitAt(event)?.id ?? null;
        canvas.style.cursor = hoverId ? "pointer" : "grab";
        return;
      }
      const dx = event.clientX - interaction.px;
      const dy = event.clientY - interaction.py;
      if (Math.abs(dx) + Math.abs(dy) > 1) interaction.moved = true;
      if (interaction.kind === "node" && interaction.id) {
        const node = nodesRef.current.find((item) => item.id === interaction?.id);
        if (node) {
          const position = moveOnCameraPlane(node, dx, dy);
          nodesRef.current = nodesRef.current.map((item) => item.id === node.id ? { ...item, ...position, pinned: true } : item);
        }
      } else {
        viewRef.current.ry += dx * 0.006;
        viewRef.current.rx = Math.max(-1.05, Math.min(1.05, viewRef.current.rx + dy * 0.006));
      }
      interaction.px = event.clientX;
      interaction.py = event.clientY;
    };

    const pointerUp = () => {
      if (interaction?.kind === "node" && interaction.id && interaction.moved) {
        const node = nodesRef.current.find((item) => item.id === interaction?.id);
        if (node) callbacksRef.current.onNodeMove(node.id, { x: node.x, y: node.y, z: node.z });
      }
      interaction = null;
      canvas.style.cursor = hoverId ? "pointer" : "grab";
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      viewRef.current.zoom = Math.max(0.78, Math.min(3.25, viewRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  return <canvas id="relationship-canvas" ref={canvasRef} className="relationship-canvas" aria-label="可旋转、缩放并拖动人物节点的三维关系图" />;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [text, setText] = useState(EXAMPLES.mystery.text);
  const [mode, setMode] = useState<"小说" | "剧本">("小说");
  const [nodes, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<GraphEdge[]>(INITIAL_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>("lin");
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState("示例已就绪 · 点击人物查看原文证据");
  const [resetKey, setResetKey] = useState(0);
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedEdges = selectedId ? edges.filter((edge) => edge.source === selectedId || edge.target === selectedId) : [];

  const moveNode = useCallback((id: string, position: Pick<GraphNode, "x" | "y" | "z">) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...position, pinned: true } : node));
    setNotice("已固定人物位置 · 重新生成可恢复自动布局");
  }, []);

  const generate = () => {
    if (!text.trim()) {
      setNotice("请先输入一段人物关系文字");
      return;
    }
    setIsGenerating(true);
    setNotice("正在识别人名、关系与原文证据…");
    window.setTimeout(() => {
      const result = extractGraph(text);
      if (result.edges.length === 0) {
        setNotice("还没识别到明确关系 · 试试“程砚是程夏的哥哥”");
      } else {
        setNodes(result.nodes);
        setEdges(result.edges);
        setSelectedId(result.nodes[0]?.id ?? null);
        setResetKey((value) => value + 1);
        setNotice(`已从 ${text.length} 字中识别 ${result.nodes.length} 人、${result.edges.length} 条关系`);
      }
      setIsGenerating(false);
    }, 620);
  };

  const loadExample = (key: keyof typeof EXAMPLES) => {
    setText(EXAMPLES[key].text);
    setNotice(`已载入${EXAMPLES[key].label} · 点击生成查看结果`);
  };

  const exportJson = () => {
    downloadBlob(new Blob([JSON.stringify({ sourceText: text, nodes, relations: edges }, null, 2)], { type: "application/json" }), "relationship-map.json");
    setNotice("关系数据已导出为 JSON");
  };

  const exportPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("#relationship-canvas");
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "relationship-map.png");
    }, "image/png");
    setNotice("高清关系图已导出为 PNG");
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">R</span><span>关系星图</span><small>LIVE PROTOTYPE</small></div>
        <div className="topbar-meta"><span className="status-dot" /> 本地解析 · 内容不会上传</div>
      </header>

      <section className="workspace">
        <aside className="composer-panel">
          <div className="eyebrow">NARRATIVE TO NETWORK</div>
          <h1>一句故事，展开整个人物宇宙。</h1>
          <p className="lede">粘贴人物描述、小说梗概或剧本片段，生成一张可以探索、拖动和核对原文的 3D 关系图。</p>
          <div className="example-row" aria-label="示例文本">
            {(Object.keys(EXAMPLES) as Array<keyof typeof EXAMPLES>).map((key) => <button type="button" key={key} onClick={() => loadExample(key)}>{EXAMPLES[key].label}</button>)}
          </div>
          <div className="mode-row">
            {(["小说", "剧本"] as const).map((item) => <button type="button" key={item} className={`mode-pill ${mode === item ? "active" : ""}`} onClick={() => setMode(item)}>{item}</button>)}
            <span>{text.length.toLocaleString("zh-CN")} 字</span>
          </div>
          <label className="text-label" htmlFor="story-input">故事文本</label>
          <textarea id="story-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="例：林默是苏晚的哥哥。苏晚和周野是好友……" />
          <button type="button" className="generate-button" onClick={generate} disabled={isGenerating}>
            <span>{isGenerating ? "正在绘制关系…" : "生成关系星图"}</span><span className={isGenerating ? "spinner" : ""}>{isGenerating ? "◌" : "↗"}</span>
          </button>
          <p className="input-hint">演示版使用本地规则解析，无需 API Key；支持常见亲属、合作、情感与冲突关系。</p>
          <div className="notice-line"><span className={isGenerating ? "pulse" : ""} />{notice}</div>
        </aside>

        <section className="graph-stage">
          <div className="graph-toolbar">
            <div className="graph-title"><span className="live-dot" /> 当前图谱</div>
            <div className="graph-stats"><span>{nodes.length} 人物</span><span>{edges.length} 关系</span><span>{new Set(nodes.map((node) => node.group)).size} 分组</span></div>
            <div className="toolbar-actions">
              <button type="button" onClick={() => setResetKey((value) => value + 1)} title="复位视角">复位</button>
              <button type="button" onClick={exportJson}>JSON</button>
              <button type="button" onClick={exportPng}>PNG</button>
            </div>
          </div>
          <RelationshipCanvas nodes={nodes} edges={edges} selectedId={selectedId} resetKey={resetKey} onSelect={setSelectedId} onNodeMove={moveNode} />
          <div className="legend" aria-label="关系颜色图例">
            <span><i style={{ background: EDGE_COLORS.kin }} />亲属</span>
            <span><i style={{ background: EDGE_COLORS.ally }} />友好</span>
            <span><i style={{ background: EDGE_COLORS.conflict }} />冲突</span>
            <span><i style={{ background: EDGE_COLORS.secret }} />隐性</span>
          </div>
          <div className="graph-help"><span>空白处拖动旋转</span><span>滚轮缩放</span><span>拖动人物固定位置</span></div>

          {selected && (
            <aside className="inspector-card">
              <button type="button" className="close-card" onClick={() => setSelectedId(null)} aria-label="关闭人物详情">×</button>
              <div className="inspector-kicker">人物档案 · {selectedEdges.length} 条连接 {selected.pinned ? "· 已固定" : ""}</div>
              <h2>{selected.label}</h2>
              <p>{selected.role}</p>
              <div className="relation-list">
                {selectedEdges.map((edge) => {
                  const otherId = edge.source === selectedId ? edge.target : edge.source;
                  const other = nodes.find((node) => node.id === otherId);
                  return (
                    <button type="button" key={edge.id} onClick={() => setSelectedId(otherId)}>
                      <i style={{ background: EDGE_COLORS[edge.tone] }} />
                      <span>{edge.label}</span>
                      <strong>{other?.label}</strong>
                      <b>{edge.directed && edge.source === selectedId ? "→" : "↔"}</b>
                    </button>
                  );
                })}
              </div>
              {selectedEdges[0] && (
                <div className="evidence-note">
                  <div><span>原文证据</span><em>{Math.round(selectedEdges[0].confidence * 100)}% 置信</em></div>
                  “{selectedEdges[0].evidence}”
                </div>
              )}
            </aside>
          )}
        </section>
      </section>
    </main>
  );
}
