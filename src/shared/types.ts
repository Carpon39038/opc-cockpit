export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  backlog: '待规划',
  todo: '待领取',
  in_progress: '进行中',
  review: '待审核',
  done: '已完成',
};

// CLI 里允许的状态别名
export const STATUS_ALIASES: Record<string, Status> = {
  backlog: 'backlog',
  todo: 'todo',
  ready: 'todo',
  in_progress: 'in_progress',
  doing: 'in_progress',
  wip: 'in_progress',
  review: 'review',
  done: 'done',
};

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  project: string;
  assignee: string; // '' = 未分配，'me' = 用户本人，其余 = agent 名称
  creator: string; // 创建者的模型·工具，如 claude-fable-5 · claude-code（人创建为空）
  agent_tool: string; // 领取时的工具名，如 claude-code / cursor（人领取为空）
  agent_model: string; // 领取时的模型名，如 claude-fable-5
  due_date: string; // YYYY-MM-DD 或 ''
  created_at: string;
  updated_at: string;
  claimed_at: string;
  completed_at: string;
  /** 查询时附带：未完成的前置任务 id（逗号分隔），null/空 = 未被阻塞 */
  blocked_by?: string | null;
  /** 查询时附带：附件图片数量 */
  attachment_count?: number;
}

/** 任务附件图片（设计图 / 预览图 / 截图），文件存 data/files/，UI 经 /files/<name> 访问 */
export interface TaskAttachment {
  id: number;
  task_id: number;
  file: string; // 附件目录里的存储文件名
  label: string; // 说明，如「首页设计图」，'' = 无
  creator: string; // 上传者的模型·工具（人上传为空）
  actor: string; // 上传者身份（me / claude / ...）
  created_at: string;
}

/** 依赖关系里引用的任务概要 */
export interface DepSummary {
  id: number;
  title: string;
  status: Status;
}

/** 从 blocked_by 字段解析出未完成前置任务的 id 列表 */
export function blockedIds(t: Pick<Task, 'blocked_by'>): number[] {
  return t.blocked_by ? t.blocked_by.split(',').map(Number) : [];
}

export type ActivityKind =
  | 'created'
  | 'claimed'
  | 'status'
  | 'progress'
  | 'comment'
  | 'updated'
  | 'completed'
  | 'knowledge'
  | 'research'
  | 'dep'
  | 'attachment';

export interface Activity {
  id: number;
  task_id: number;
  actor: string;
  kind: ActivityKind;
  content: string;
  meta: string; // JSON 字符串，如 {"from":"todo","to":"in_progress"}
  created_at: string;
  task_title?: string; // 全局动态流 join 出来的字段
}

// ---------------- 项目 ----------------

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '推进中',
  paused: '暂停',
  done: '已完成',
};

export interface Project {
  name: string; // 主键，任务通过 tasks.project 关联
  goal: string; // 目标
  status: ProjectStatus;
  next_step: string; // 下一步
  blockers: string; // 阻塞与风险
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  total: number;
  by_status: Record<Status, number>;
  agents_working: number; // 进行中且由 Agent 认领的任务数
  last_update: string; // 项目下任务的最近更新时间
}

// ---------------- 知识库 ----------------

export const KNOWLEDGE_TYPES = ['issue', 'knowledge', 'pitfall'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  issue: '问题', // 执行中遇到的未决问题（解决后补结论或转成坑）
  knowledge: '知识', // 搜到的资料 / 得出的结论
  pitfall: '坑', // 踩过并有结论的陷阱
};

// CLI 里允许的类型别名
export const KNOWLEDGE_TYPE_ALIASES: Record<string, KnowledgeType> = {
  issue: 'issue',
  problem: 'issue',
  question: 'issue',
  knowledge: 'knowledge',
  know: 'knowledge',
  ref: 'knowledge',
  reference: 'knowledge',
  pitfall: 'pitfall',
  trap: 'pitfall',
  gotcha: 'pitfall',
};

export interface KnowledgeEntry {
  id: number;
  type: KnowledgeType;
  title: string;
  body: string; // Markdown：现象 / 原因 / 解法 / 摘录
  tags: string; // 逗号分隔，存储时已规范化（trim、去空）
  project: string; // 关联项目，'' = 通用（所有项目都会带出）
  task_id: number; // 关联任务，0 = 无
  source_url: string; // 出处链接（搜到的知识记来源）
  creator: string; // 记录者的模型·工具，如 claude-fable-5 · claude-code（人记录为空）
  actor: string; // 记录者身份（me / claude / ...）
  created_at: string;
  updated_at: string;
  task_title?: string; // join 出来的关联任务标题
}

export function kbRef(id: number): string {
  return `K-${id}`;
}

/** 接受 K-3 / k3 / #3 / 3 等写法 */
export function parseKbRef(ref: string): number {
  const m = /^[Kk]?-?#?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`无法识别的知识编号: ${ref}（期望形如 K-3 或 3）`);
  return Number(m[1]);
}

// ---------------- 调研 ----------------

export const RESEARCH_STATUSES = ['collecting', 'concluded', 'archived'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  collecting: '收集中', // 围绕研究问题收集资料
  concluded: '已有结论', // 写完总结，等待转化
  archived: '已归档', // 结论已沉淀/不再跟进
};

// CLI 里允许的状态别名
export const RESEARCH_STATUS_ALIASES: Record<string, ResearchStatus> = {
  collecting: 'collecting',
  open: 'collecting',
  concluded: 'concluded',
  done: 'concluded',
  archived: 'archived',
  archive: 'archived',
};

/** 一次调研：从研究问题出发，收集资料池，形成结论，最终沉淀到知识库 */
export interface Research {
  id: number;
  title: string;
  question: string; // 研究问题/目标/要求（Markdown，如「找 10 个以上…每个记录爽点」）
  status: ResearchStatus;
  conclusion: string; // 综合结论/总结（Markdown）
  project: string; // 关联项目，'' = 通用
  task_id: number; // 关联任务，0 = 无
  creator: string; // 发起者的模型·工具（人发起为空）
  actor: string; // 发起者身份（me / claude / ...）
  created_at: string;
  updated_at: string;
  task_title?: string; // join 出来的关联任务标题
}

/** 资料池条目：一张资料卡 = 标题 + 链接 + 截图 + 摘要/摘录 + 标签 + 星级 */
export interface ResearchItem {
  id: number;
  research_id: number;
  title: string;
  url: string; // 来源链接
  image: string; // 截图文件名（data/files/ 下，UI 经 /files/<name> 访问），'' = 无图
  body: string; // 摘要、关键摘录、爽点分析…（Markdown）
  tags: string; // 逗号分隔，存储时已规范化
  rating: number; // 0 = 未评级，1-5 星（标记参考价值）
  creator: string;
  actor: string;
  created_at: string;
  updated_at: string;
}

/** 列表页用：调研 + 资料统计 */
export interface ResearchWithStats extends Research {
  item_count: number;
  cover: string; // 最新一张截图的文件名，'' = 无
}

export function researchRef(id: number): string {
  return `R-${id}`;
}

/** 接受 R-3 / r3 / #3 / 3 等写法 */
export function parseResearchRef(ref: string): number {
  const m = /^[Rr]?-?#?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`无法识别的调研编号: ${ref}（期望形如 R-3 或 3）`);
  return Number(m[1]);
}

export const HUMAN_ACTOR = 'me';

export function isAgent(actor: string): boolean {
  return actor !== '' && actor !== HUMAN_ACTOR;
}

export function taskRef(id: number): string {
  return `T-${id}`;
}

/** 接受 T-3 / t3 / #3 / 3 等写法 */
export function parseRef(ref: string): number {
  const m = /^[Tt]?-?#?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`无法识别的任务编号: ${ref}（期望形如 T-3 或 3）`);
  return Number(m[1]);
}
