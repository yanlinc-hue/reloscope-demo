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
  "Read-only queries and view actions execute automatically. Any relationship, project, or scene write must be previewed and explicitly confirmed by the user.";

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
    title: "Upstream Concentration and Shared Lithium Supply",
    subtitle: "Jichuan Power's three critical dependencies: lithium salts, cathode materials, and BMS",
    layout: "radial",
    selectedId: "N01",
    scopeNodeIds: [...UPSTREAM_NODE_IDS],
    edgeKinds: ["supply", "research"],
    highlightNodeIds: ["N02", "N03", "N05"],
    highlightEdgeIds: ["E01", "E02", "E03", "E05"],
    callout: "Lanxin BMS covers 62%, Chengyue cathode materials account for 44%, and Xingyu directly supplies 36% of lithium salts; Xingyu also supplies 55% of Chengyue's lithium salts. These percentages use different denominators and must not be added together.",
    evidenceIds: ["S01-C2", "S03-C1", "S03-C2", "S04-C1"],
    status: "draft",
  },
  {
    id: "DRAFT-IC-02",
    title: "Impact Paths from the Guidance Fund to Projects",
    subtitle: "Distinguishing two-hop association paths from three-hop directed capital-to-delivery paths",
    layout: "layered",
    selectedId: "N11",
    scopeNodeIds: [...CAPITAL_NODE_IDS],
    edgeKinds: ["capital", "delivery"],
    highlightNodeIds: ["N11", "N10", "N01", "N05", "N17", "N18"],
    highlightEdgeIds: ["E11", "E12", "E13", "E26", "E28", "E30", "E31"],
    callout: "N11—N01—N17/N18 is the shortest association path; N11→N10→N05→N17/N18 is the strictly directed path. Neither capital ties nor shared technology nodes establish de facto control.",
    evidenceIds: ["S02-C2", "S08-C1", "S08-C2", "S12-C2", "S12-C4", "S13-C2", "S13-C3"],
    status: "draft",
  },
  {
    id: "DRAFT-IC-03",
    title: "Boundaries Between Facts, Inferences, and Evidence Gaps",
    subtitle: "Separating verified shareholdings, planned targets, and incomplete acceptance",
    layout: "force",
    selectedId: "N10",
    selectedEdgeId: "E13",
    scopeNodeIds: ["N10", "N05", "N08", "N01", "N12", "N03", "N13", "N18"],
    edgeKinds: ["capital", "circular", "research", "certification"],
    highlightNodeIds: ["N10", "N05", "N08", "N03", "N18"],
    highlightEdgeIds: ["E13", "E09", "E20", "E32"],
    callout: "E13 establishes only that Jiaxu Capital holds an 18% stake in Lanxin Control. E09, E20, and E32 respectively represent a recycling target, a pilot plan, and incomplete acceptance; none may be presented as a completed fact.",
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
      "I can run read-only graph investigations directly: expand Jichuan Power's upstream network, explain risk evidence, trace paths from the Donglan Industry Guidance Fund, or prepare three investment-committee scene drafts. Relationship and scene writes are always previewed and held for confirmation.",
    ),
    plan: plan({
      id: "AP-WELCOME",
      intent: "welcome",
      title: "Awaiting an Analysis Objective",
      summary: "Present the five deterministic tasks supported by this demo.",
      execution: "read-only-auto",
      steps: ["Wait for the user to select a task"],
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
      "Expanded two upstream hops from Jichuan Power N01: 6 entities and 8 supply or research relationships. Xingyu Lithium N02 supplies directly through E02 and also creates an indirect dependency through E01→E03.",
    ),
    plan: plan({
      id: "AP-UPSTREAM",
      intent: "upstream",
      title: "Expand Two Upstream Hops from Jichuan Power",
      summary: "Focus on the supply and research network and use a radial layout to expose shared upstream dependencies.",
      execution: "read-only-auto",
      steps: [
        "Expand two relationship hops from root node N01",
        "Retain only supply and research relationships",
        "Highlight N02, N03, and N05",
        "Apply the radial layout",
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
      "The elevated risk does not come from node degree alone; it comes from the combination of concentration and a shared upstream dependency. E05 shows 62% Lanxin BMS coverage, E03 shows a 44% Chengyue cathode-material share, E02 shows a 36% direct Xingyu lithium-salt share, and E01 shows that Xingyu supplies 55% of Chengyue's lithium salts. These four percentages use different denominators and must not be added together.",
    ),
    plan: plan({
      id: "AP-RISK-EVIDENCE",
      intent: "risk-evidence",
      title: "Explain Upstream Risk with Field-Level Evidence",
      summary: "Compare concentration, shared upstream exposure, and review status without presenting structural observations as verified facts.",
      execution: "read-only-auto",
      steps: [
        "Focus on E01, E02, E03, and E05",
        "Open S01-C2, S03-C1, S03-C2, and S04-C1",
        "Label the dependency roles of N02, N03, and N05",
      ],
      nodeIds: [...UPSTREAM_NODE_IDS],
      edgeIds: ["E01", "E02", "E03", "E05"],
      evidenceIds: ["S01-C2", "S03-C1", "S03-C2", "S04-C1", "S14"],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
      warning: "The 36%, 44%, 55%, and 62% figures use different procurement or coverage denominators and must not be added together.",
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
      "Found two path classes: the shortest association path is N11—N01—N17/N18; the strictly directed path is N11→N10→N05→N17/N18, with N11→N10→N07→N18 as an additional energy-storage branch. N05 is a shared technology node, but the available evidence does not support a finding of common control.",
    ),
    plan: plan({
      id: "AP-CAPITAL-PATH",
      intent: "capital-path",
      title: "Trace the Industry Fund to Both Projects",
      summary: "Show the undirected shortest association path alongside the strictly directed capital-to-delivery path.",
      execution: "read-only-auto",
      steps: [
        "Find paths from N11 to N17 and N18",
        "Compare the undirected shortest path with the directed semantic path",
        "Identify N10 as the capital platform and N05 as the shared technology node",
        "Apply the layered layout",
      ],
      nodeIds: [...CAPITAL_NODE_IDS],
      edgeIds: [...CAPITAL_EDGE_IDS],
      evidenceIds: [...CAPITAL_EVIDENCE_IDS],
      autoExecute: true,
      requiresConfirmation: false,
      blocked: false,
      warning: "Equity, supply, and project-delivery relationships establish associations or influence paths; they do not, by themselves, establish de facto control.",
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
      label: "Direct 18% equity stake",
      status: "verified",
    },
    requested: {
      edgeId: "E13",
      kind: "governance",
      label: "De facto control",
      status: "verified",
    },
    supportedAlternative: {
      edgeId: "E13",
      kind: "governance",
      label: "Governance influence · Pending review",
      status: "review",
    },
    evidenceIds: ["S08-C1"],
    conflict: "S08-C1 establishes only that Jiaxu Capital N10 holds an 18% equity stake in Lanxin Control N05; it does not establish control rights.",
    requiredEvidence: [
      "Voting-right arrangements",
      "Board seats or appointment and removal rights",
      "Acting-in-concert agreement",
      "Formal determination of control",
    ],
  };

  return {
    assistant: assistant(
      "The requested change has been blocked, and the authoritative graph is unchanged. S08-C1 supports only E13, ‘Direct 18% equity stake’; it is insufficient to change the relationship to ‘De facto control’ or retain verified status. Provide evidence of voting rights, board representation, acting-in-concert arrangements, or a formal control determination. Alternatively, preview the compliant ‘Governance influence · Pending review’ option.",
    ),
    plan: plan({
      id: "AP-BLOCK-CONTROL",
      intent: "blocked-control-change",
      title: "Review the Requested E13 Control Change",
      summary: "Show the proposed difference, but block changes to relationship type and verification status until sufficient evidence is available.",
      execution: "blocked-evidence-required",
      steps: [
        "Read the current E13 relationship and S08-C1",
        "Preview the capital→governance and label changes",
        "Run the evidence-sufficiency check",
        "Block the authoritative write and list the required evidence",
      ],
      nodeIds: ["N10", "N05"],
      edgeIds: ["E13"],
      evidenceIds: ["S08-C1"],
      autoExecute: false,
      requiresConfirmation: true,
      blocked: true,
      warning: "Standard confirmation cannot override the evidence requirement. After sufficient evidence is provided, the change must still be previewed and confirmed again.",
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
      preview: "E13: Direct 18% equity stake / verified → De facto control / verified (blocked due to insufficient evidence)",
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
      "Prepared three investment-committee scene drafts: upstream concentration, the fund-to-project impact path, and the boundary between facts and evidence gaps. Relationship data is unchanged. This is a preview only; the three scenes will be saved to the project only after confirmation.",
    ),
    plan: plan({
      id: "AP-INVESTMENT-SCENES",
      intent: "investment-scenes",
      title: "Prepare Three Investment-Committee Scene Drafts",
      summary: "Arrange the preceding read-only analysis into editable narrative scenes that can be played in sequence.",
      execution: "preview-required",
      steps: [
        "Create the upstream-dependency scene draft",
        "Create the capital-path scene draft",
        "Create the evidence-boundary scene draft",
        "Preview the drafts and wait for confirmation before saving",
      ],
      nodeIds: Array.from(new Set(drafts.flatMap((scene) => scene.scopeNodeIds))),
      edgeIds: Array.from(new Set(drafts.flatMap((scene) => scene.highlightEdgeIds))),
      evidenceIds: Array.from(new Set(drafts.flatMap((scene) => scene.evidenceIds))),
      autoExecute: false,
      requiresConfirmation: true,
      blocked: false,
      warning: "Previewing does not write data. Saving, publishing, or overwriting an existing scene requires explicit confirmation.",
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
      preview: "Save DRAFT-IC-01, DRAFT-IC-02, and DRAFT-IC-03 without modifying any node or relationship.",
      scenes: drafts,
    },
    sceneDrafts: drafts,
  };
}

function buildClarifyTurn(context: AgentContext): AgentTurn {
  const focus = context.selectedNodeId
    ? `Currently selected: ${context.selectedNodeId}.`
    : "No entity is currently selected.";

  return {
    assistant: assistant(
      `${focus} Specify the task to run: expand the upstream network from N01, explain the risk evidence, find capital paths from N11 to N17/N18, review the requested E13 change, or prepare three investment-committee scene drafts. Read-only actions execute automatically; writes are previewed and held for confirmation.`,
    ),
    plan: plan({
      id: "AP-CLARIFY",
      intent: "clarify",
      title: "Clarify the Analysis Objective",
      summary: "The input did not match a deterministic demo intent; do not guess which data the user wants to change.",
      execution: "read-only-auto",
      steps: ["Ask the user to select one of the five demo tasks or provide a target entity"],
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

  if (!normalized || includesAny(normalized, ["你好", "您好", "hello", "hi", "help", "what can you do", "帮助", "能做什么"])) {
    return buildWelcomeTurn();
  }

  if (
    normalized === "control" ||
    normalized === "verified" ||
    includesAny(normalized, [
      "实际控制",
      "控制权",
      "控股",
      "改成控制",
      "标为已核验",
      "de facto control",
      "actual control",
      "control rights",
      "controlling stake",
      "change to control",
      "mark as verified",
      "verified control",
    ]) ||
    (includesAny(normalized, ["control", "verified"]) &&
      includesAny(normalized, ["e13", "change", "mark", "set", "relationship"]))
  ) {
    return buildBlockedControlChangeTurn(context);
  }

  if (
    normalized === "scene" ||
    normalized === "scenes" ||
    normalized === "investment committee" ||
    includesAny(normalized, ["scene", "scenes", "investment committee", "镜头", "投委会", "汇报"]) &&
    includesAny(normalized, ["three", "3", "generate", "create", "prepare", "draft", "drafts", "三个", "3个", "三张", "生成", "草案", "整理"])
  ) {
    return buildInvestmentScenesTurn(context);
  }

  if (
    normalized === "capital path" ||
    normalized === "fund" ||
    includesAny(normalized, ["capital", "fund", "industry fund", "guidance fund", "产业基金", "引导基金", "资本", "嘉序"]) &&
    includesAny(normalized, ["path", "paths", "trace", "project", "projects", "impact", "shortest", "穿透", "路径", "项目", "影响", "最短"])
  ) {
    return buildCapitalPathTurn();
  }

  if (includesAny(normalized, ["risk", "evidence", "why", "explain", "centrality", "风险", "证据", "依据", "为什么", "解释", "中心性"])) {
    return buildRiskEvidenceTurn();
  }

  if (
    normalized === "upstream" ||
    normalized === "supplier" ||
    normalized === "suppliers" ||
    includesAny(normalized, ["upstream", "supplier", "suppliers", "supply", "research", "上游", "供应", "供应商", "研发"]) &&
    includesAny(normalized, ["expand", "show", "focus", "two-hop", "two hop", "two hops", "relationship", "relationships", "jichuan", "展开", "两层", "关系", "只看", "霁川"])
  ) {
    return buildUpstreamTurn();
  }

  return buildClarifyTurn(context);
}
