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
}

export type ActivityKind =
  | 'created'
  | 'claimed'
  | 'status'
  | 'progress'
  | 'comment'
  | 'updated'
  | 'completed'
  | 'knowledge';

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
