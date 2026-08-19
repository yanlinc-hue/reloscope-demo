import type { EdgeKind } from "./demo-data";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type AgentIntent =
  | "welcome"
  | "upstream"
  | "risk-evidence"
  | "capital-path"
  | "blocked-control-change"
  | "investment-scenes"
  | "clarify";

export type PlanExecution =
  | "read-only-auto"
  | "preview-required"
  | "blocked-evidence-required";

export interface AgentPlan {
  id: string;
  intent: AgentIntent;
  title: string;
  summary: string;
  execution: PlanExecution;
  steps: string[];
  nodeIds: string[];
  edgeIds: string[];
  evidenceIds: string[];
  autoExecute: boolean;
  requiresConfirmation: boolean;
  blocked: boolean;
  policy: string;
  warning?: string;
}

export interface ViewIntent {
  mode: "2d" | "3d";
  layout: "force" | "radial" | "layered";
  scopeNodeIds: string[];
  edgeKinds: EdgeKind[];
  selectNodeId?: string;
  selectEdgeId?: string;
  highlightNodeIds?: string[];
}

export interface SceneDraft {
  id: string;
  title: string;
  subtitle: string;
  layout: ViewIntent["layout"];
  selectedId: string;
  selectedEdgeId?: string;
  scopeNodeIds: string[];
  edgeKinds: EdgeKind[];
  highlightNodeIds: string[];
  highlightEdgeIds: string[];
  callout: string;
  evidenceIds: string[];
  status: "draft";
}

export interface RelationSnapshot {
  edgeId: string;
  kind: EdgeKind;
  label: string;
  status: "verified" | "review";
}

export interface RelationChangePreview {
  before: RelationSnapshot;
  requested: RelationSnapshot;
  supportedAlternative: RelationSnapshot;
  evidenceIds: string[];
  conflict: string;
  requiredEvidence: string[];
}

export interface PendingAction {
  id: string;
  kind: "relation-change" | "save-scenes";
  status: "awaiting-confirmation" | "blocked";
  expectedGraphRevision: string;
  requiresConfirmation: true;
  preview: string;
  relationChange?: RelationChangePreview;
  scenes?: SceneDraft[];
}

export interface AgentContext {
  selectedNodeId?: string;
  selectedEdgeId?: string;
  graphRevision?: string;
  priorMessages?: ChatMessage[];
}

export interface AgentTurn {
  assistant: ChatMessage;
  plan: AgentPlan;
  viewIntent?: ViewIntent;
  pendingAction?: PendingAction;
  sceneDrafts?: SceneDraft[];
}

export const AGENT_EXECUTION_POLICY =
  "只读查询与视图动作自动执行；任何关系、项目或 Scene 写入都必须先预览，再由用户明确确认。";

const UPSTREAM_NODE_IDS = ["N01", "N02", "N03", "N04", "N05", "N12"];
const UPSTREAM_EDGE_IDS = ["E01", "E02", "E03", "E04", "E05", "E18", "E19", "E20"];
const UPSTREAM_EVIDENCE_IDS = ["S01-C2", "S03-C1", "S03-C2", "S03-C3", "S04-C1", "S09-C1", "S09-C2"];

const CAPITAL_NODE_IDS = ["N11", "N10", "N01", "N05", "N07", "N17", "N18"];
const CAPITAL_EDGE_IDS = ["E11", "E12", "E13", "E14", "E26", "E28", "E29", "E30", "E31"];
const CAPITAL_EVIDENCE_IDS = [
  "S02-C2",
  "S08-C1",
  "S08-C2",
  "S08-C3",
  "S12-C2",
  "S12-C4",
  "S13-C1",
  "S13-C2",
  "S13-C3",
];

const SCENE_DRAFTS: SceneDraft[] = [
  {
    id: "DRAFT-IC-01",
    title: "上游集中度与共享锂源",
    subtitle: "霁川动力的锂盐、正极材料与 BMS 三类关键依赖",
    layout: "radial",
    selectedId: "N01",
    scopeNodeIds: [...UPSTREAM_NODE_IDS],
    edgeKinds: ["supply", "research"],
    highlightNodeIds: ["N02", "N03", "N05"],
    highlightEdgeIds: ["E01", "E02", "E03", "E05"],
    callout: "岚芯 BMS 覆盖 62%，澄岳正极材料占 44%，星峪直接锂盐占 36%；星峪还供应澄岳 55% 的锂盐。不同口径比例不可相加。",
    evidenceIds: ["S01-C2", "S03-C1", "S03-C2", "S04-C1"],
    status: "draft",
  },
  {
    id: "DRAFT-IC-02",
    title: "引导基金到项目的影响路径",
    subtitle: "区分两跳关联路径与三跳有向资本—交付路径",
    layout: "layered",
    selectedId: "N11",
    scopeNodeIds: [...CAPITAL_NODE_IDS],
    edgeKinds: ["capital", "delivery"],
    highlightNodeIds: ["N11", "N10", "N01", "N05", "N17", "N18"],
    highlightEdgeIds: ["E11", "E12", "E13", "E26", "E28", "E30", "E31"],
    callout: "N11—N01—N17/N18 是最短关联路径；N11→N10→N05→N17/N18 是严格有向路径。资本关联与共同技术节点均不等于实际控制。",
    evidenceIds: ["S02-C2", "S08-C1", "S08-C2", "S12-C2", "S12-C4", "S13-C2", "S13-C3"],
    status: "draft",
  },
  {
    id: "DRAFT-IC-03",
    title: "事实、推断与待补证边界",
    subtitle: "把已核验持股、规划目标和未完成验收分开呈现",
    layout: "force",
    selectedId: "N10",
    selectedEdgeId: "E13",
    scopeNodeIds: ["N10", "N05", "N08", "N01", "N12", "N03", "N13", "N18"],
    edgeKinds: ["capital", "circular", "research", "certification"],
    highlightNodeIds: ["N10", "N05", "N08", "N03", "N18"],
    highlightEdgeIds: ["E13", "E09", "E20", "E32"],
    callout: "E13 仅证明嘉序资本持有岚芯智控 18%；E09、E20、E32 分别是回收目标、中试计划和未完成验收，均不得表述为已发生事实。",
    evidenceIds: ["S08-C1", "S07-C2", "S09-C2", "S13-C4"],
    status: "draft",
  },
];

function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function assistant(content: string): ChatMessage {
  return { role: "assistant", content };
}

function plan(
  value: Omit<AgentPlan, "policy">,
): AgentPlan {
  return { ...value, policy: AGENT_EXECUTION_POLICY };
}

function buildWelcomeTurn(): AgentTurn {
  return {
    assistant: assistant(
      "我可以直接执行只读图探索：展开霁川动力上游、解释风险证据、穿透东澜产业引导基金路径，或生成三个投委会 Scene 草案。关系和 Scene 写入都会先给你预览并等待确认。",
    ),
    plan: plan({
      id: "AP-WELCOME",
      intent: "welcome",
      title: "等待分析目标",
      summary: "展示当前 Demo 支持的五类确定性任务。",
      execution: "read-only-auto",
      steps: ["等待用户选择任务"],
      nodeIds: [],
      edgeIds: [],
      evidenceIds: [],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
    }),
  };
}

function buildUpstreamTurn(): AgentTurn {
  return {
    assistant: assistant(
      "已展开霁川动力 N01 的两层上游：6 个实体、8 条供应或研发关系。星峪锂源 N02 既通过 E02 直接供货，也经 E01→E03 形成间接依赖。",
    ),
    plan: plan({
      id: "AP-UPSTREAM",
      intent: "upstream",
      title: "展开霁川动力两层上游",
      summary: "聚焦供应与研发网络，并以径向布局突出共同上游。",
      execution: "read-only-auto",
      steps: [
        "以 N01 为根节点展开两层关系",
        "仅保留 supply 与 research",
        "高亮 N02、N03、N05",
        "应用 radial 布局",
      ],
      nodeIds: [...UPSTREAM_NODE_IDS],
      edgeIds: [...UPSTREAM_EDGE_IDS],
      evidenceIds: [...UPSTREAM_EVIDENCE_IDS],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
    }),
    viewIntent: {
      mode: "3d",
      layout: "radial",
      scopeNodeIds: [...UPSTREAM_NODE_IDS],
      edgeKinds: ["supply", "research"],
      selectNodeId: "N01",
      highlightNodeIds: ["N02", "N03", "N05"],
    },
  };
}

function buildRiskEvidenceTurn(): AgentTurn {
  return {
    assistant: assistant(
      "高风险不是因为度数高，而是集中度与共享上游叠加：E05 显示岚芯 BMS 覆盖 62%，E03 显示澄岳正极材料占 44%，E02 显示星峪直接锂盐占 36%；E01 又显示星峪供应澄岳 55% 的锂盐。四个比例口径不同，不能相加。",
    ),
    plan: plan({
      id: "AP-RISK-EVIDENCE",
      intent: "risk-evidence",
      title: "用字段级证据解释上游风险",
      summary: "对照集中度、共享上游和待复核状态，不把结构观察写成事实。",
      execution: "read-only-auto",
      steps: [
        "聚焦 E01、E02、E03、E05",
        "打开 S01-C2、S03-C1、S03-C2、S04-C1",
        "标注 N02、N03、N05 的依赖角色",
      ],
      nodeIds: [...UPSTREAM_NODE_IDS],
      edgeIds: ["E01", "E02", "E03", "E05"],
      evidenceIds: ["S01-C2", "S03-C1", "S03-C2", "S04-C1", "S14"],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
      warning: "36%、44%、55% 与 62% 分属不同采购或覆盖口径，禁止求和。",
    }),
    viewIntent: {
      mode: "3d",
      layout: "radial",
      scopeNodeIds: [...UPSTREAM_NODE_IDS],
      edgeKinds: ["supply", "research"],
      selectNodeId: "N01",
      selectEdgeId: "E05",
      highlightNodeIds: ["N02", "N03", "N05"],
    },
  };
}

function buildCapitalPathTurn(): AgentTurn {
  return {
    assistant: assistant(
      "已找到两类路径：最短关联路径为 N11—N01—N17/N18；严格有向路径为 N11→N10→N05→N17/N18，N11→N10→N07→N18 是储能补充分支。N05 是共同技术节点，但现有证据不支持称为共同控制。",
    ),
    plan: plan({
      id: "AP-CAPITAL-PATH",
      intent: "capital-path",
      title: "穿透产业基金到两个项目",
      summary: "并列展示无向最短关联路径和严格有向资本—交付路径。",
      execution: "read-only-auto",
      steps: [
        "以 N11 为起点查找 N17、N18",
        "比较无向最短路径与有向语义路径",
        "标记 N10 为资本平台、N05 为共同技术节点",
        "应用 layered 布局",
      ],
      nodeIds: [...CAPITAL_NODE_IDS],
      edgeIds: [...CAPITAL_EDGE_IDS],
      evidenceIds: [...CAPITAL_EVIDENCE_IDS],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
      warning: "持股、供应与项目交付关系只能证明关联或影响路径，不能自动推出实际控制。",
    }),
    viewIntent: {
      mode: "2d",
      layout: "layered",
      scopeNodeIds: [...CAPITAL_NODE_IDS],
      edgeKinds: ["capital", "delivery"],
      selectNodeId: "N11",
      highlightNodeIds: ["N11", "N10", "N01", "N05", "N17", "N18"],
    },
  };
}

function buildBlockedControlChangeTurn(context: AgentContext): AgentTurn {
  const relationChange: RelationChangePreview = {
    before: {
      edgeId: "E13",
      kind: "capital",
      label: "直接持股 18%",
      status: "verified",
    },
    requested: {
      edgeId: "E13",
      kind: "governance",
      label: "实际控制",
      status: "verified",
    },
    supportedAlternative: {
      edgeId: "E13",
      kind: "governance",
      label: "治理影响 · 待复核",
      status: "review",
    },
    evidenceIds: ["S08-C1"],
    conflict: "S08-C1 仅证明嘉序资本 N10 持有岚芯智控 N05 18% 股权，未证明控制权。",
    requiredEvidence: ["表决权安排", "董事席位或任免权", "一致行动协议", "正式控制权认定"],
  };

  return {
    assistant: assistant(
      "修改已被阻止，正式图没有变化。S08-C1 只支持 E13“直接持股 18%”，不足以改成“实际控制”或继续标为已核验。请补充表决权、董事席位、一致行动安排或正式控制权认定；也可预览“治理影响·待复核”的合规替代方案。",
    ),
    plan: plan({
      id: "AP-BLOCK-CONTROL",
      intent: "blocked-control-change",
      title: "审查 E13 实际控制修改请求",
      summary: "展示差异，但在证据充分前阻止关系类型和核验状态写入。",
      execution: "blocked-evidence-required",
      steps: [
        "读取 E13 当前关系与 S08-C1",
        "预览 capital→governance 与标签变更",
        "执行证据充分性检查",
        "阻止正式写入并列出补证要求",
      ],
      nodeIds: ["N10", "N05"],
      edgeIds: ["E13"],
      evidenceIds: ["S08-C1"],
      autoExecute: false,
      requiresConfirmation: true,
      blocked: true,
      warning: "普通确认不能绕过证据要求。补证通过后仍须重新预览并确认。",
    }),
    viewIntent: {
      mode: "2d",
      layout: "layered",
      scopeNodeIds: ["N10", "N05"],
      edgeKinds: ["capital", "governance"],
      selectNodeId: "N10",
      selectEdgeId: "E13",
      highlightNodeIds: ["N10", "N05"],
    },
    pendingAction: {
      id: "PA-E13-CONTROL",
      kind: "relation-change",
      status: "blocked",
      expectedGraphRevision: context.graphRevision ?? "demo-r1",
      requiresConfirmation: true,
      preview: "E13：直接持股 18% / verified → 实际控制 / verified（因证据不足已阻止）",
      relationChange,
    },
  };
}

function buildInvestmentScenesTurn(context: AgentContext): AgentTurn {
  const drafts = SCENE_DRAFTS.map((scene) => ({
    ...scene,
    scopeNodeIds: [...scene.scopeNodeIds],
    edgeKinds: [...scene.edgeKinds],
    highlightNodeIds: [...scene.highlightNodeIds],
    highlightEdgeIds: [...scene.highlightEdgeIds],
    evidenceIds: [...scene.evidenceIds],
  }));

  return {
    assistant: assistant(
      "已生成三个投委会 Scene 草案：上游集中度、基金到项目的影响路径、事实与待补证边界。关系数据没有变化；当前仅预览，确认后才会把三个 Scene 保存到项目。",
    ),
    plan: plan({
      id: "AP-INVESTMENT-SCENES",
      intent: "investment-scenes",
      title: "生成三个投委会 Scene 草案",
      summary: "把前述只读分析编排为可编辑、可连续播放的叙事镜头。",
      execution: "preview-required",
      steps: [
        "创建上游依赖 Scene 草案",
        "创建资本穿透 Scene 草案",
        "创建证据边界 Scene 草案",
        "预览后等待用户确认保存",
      ],
      nodeIds: Array.from(new Set(drafts.flatMap((scene) => scene.scopeNodeIds))),
      edgeIds: Array.from(new Set(drafts.flatMap((scene) => scene.highlightEdgeIds))),
      evidenceIds: Array.from(new Set(drafts.flatMap((scene) => scene.evidenceIds))),
      autoExecute: false,
      requiresConfirmation: true,
      blocked: false,
      warning: "预览不写入；保存、发布或覆盖既有 Scene 均需明确确认。",
    }),
    viewIntent: {
      mode: "2d",
      layout: drafts[0].layout,
      scopeNodeIds: [...drafts[0].scopeNodeIds],
      edgeKinds: [...drafts[0].edgeKinds],
      selectNodeId: drafts[0].selectedId,
      selectEdgeId: drafts[0].selectedEdgeId,
      highlightNodeIds: [...drafts[0].highlightNodeIds],
    },
    pendingAction: {
      id: "PA-SAVE-IC-SCENES",
      kind: "save-scenes",
      status: "awaiting-confirmation",
      expectedGraphRevision: context.graphRevision ?? "demo-r1",
      requiresConfirmation: true,
      preview: "保存 DRAFT-IC-01、DRAFT-IC-02、DRAFT-IC-03；不修改任何节点或关系。",
      scenes: drafts,
    },
    sceneDrafts: drafts,
  };
}

function buildClarifyTurn(context: AgentContext): AgentTurn {
  const focus = context.selectedNodeId
    ? `当前选中 ${context.selectedNodeId}。`
    : "当前没有选中实体。";

  return {
    assistant: assistant(
      `${focus} 请明确要执行哪一类任务：展开 N01 上游、解释风险证据、查找 N11 到 N17/N18 的资本路径、审查 E13 修改，或生成三个投委会 Scene 草案。只读动作会自动执行，写入会先预览并等待确认。`,
    ),
    plan: plan({
      id: "AP-CLARIFY",
      intent: "clarify",
      title: "澄清分析目标",
      summary: "输入未命中确定性 Demo 意图，不猜测用户希望修改的数据。",
      execution: "read-only-auto",
      steps: ["请求用户从五类演示任务中选择或补充目标实体"],
      nodeIds: context.selectedNodeId ? [context.selectedNodeId] : [],
      edgeIds: context.selectedEdgeId ? [context.selectedEdgeId] : [],
      evidenceIds: [],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
    }),
  };
}

export function buildAgentTurn(
  prompt: string,
  context: AgentContext = {},
): AgentTurn {
  const normalized = normalizePrompt(prompt);

  if (!normalized || includesAny(normalized, ["你好", "您好", "hello", "hi", "帮助", "能做什么"])) {
    return buildWelcomeTurn();
  }

  if (includesAny(normalized, ["实际控制", "控制权", "控股", "改成控制", "标为已核验"])) {
    return buildBlockedControlChangeTurn(context);
  }

  if (
    includesAny(normalized, ["scene", "镜头", "投委会", "汇报"]) &&
    includesAny(normalized, ["三个", "3个", "三张", "生成", "草案", "整理"])
  ) {
    return buildInvestmentScenesTurn(context);
  }

  if (
    includesAny(normalized, ["产业基金", "引导基金", "资本", "嘉序"]) &&
    includesAny(normalized, ["穿透", "路径", "项目", "影响", "最短"])
  ) {
    return buildCapitalPathTurn();
  }

  if (includesAny(normalized, ["风险", "证据", "依据", "为什么", "解释", "中心性"])) {
    return buildRiskEvidenceTurn();
  }

  if (
    includesAny(normalized, ["上游", "供应", "供应商", "研发"]) &&
    includesAny(normalized, ["展开", "两层", "关系", "只看", "霁川"])
  ) {
    return buildUpstreamTurn();
  }

  return buildClarifyTurn(context);
}
