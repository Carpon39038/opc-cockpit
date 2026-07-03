import { getDb } from './db';
import {
  Activity,
  ActivityKind,
  HUMAN_ACTOR,
  PRIORITIES,
  Priority,
  PROJECT_STATUSES,
  Project,
  ProjectStatus,
  ProjectWithStats,
  STATUSES,
  Status,
  Task,
  isAgent,
  taskRef,
} from './types';

function now(): string {
  return new Date().toISOString();
}

export class StoreError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

function assertStatus(s: string): asserts s is Status {
  if (!STATUSES.includes(s as Status)) {
    throw new StoreError(`无效状态: ${s}（可选: ${STATUSES.join(', ')}）`);
  }
}

function assertPriority(p: string): asserts p is Priority {
  if (!PRIORITIES.includes(p as Priority)) {
    throw new StoreError(`无效优先级: ${p}（可选: ${PRIORITIES.join(', ')}）`);
  }
}

function log(taskId: number, actor: string, kind: ActivityKind, content = '', meta: object = {}) {
  getDb()
    .prepare('INSERT INTO activity (task_id, actor, kind, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(taskId, actor, kind, content, JSON.stringify(meta), now());
}

export function getTask(id: number): Task {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  if (!row) throw new StoreError(`任务 ${taskRef(id)} 不存在`, 404);
  return row;
}

export function getTaskActivity(id: number): Activity[] {
  return getDb()
    .prepare('SELECT * FROM activity WHERE task_id = ? ORDER BY id ASC')
    .all(id) as unknown as Activity[];
}

export interface ListFilters {
  status?: string;
  project?: string;
  assignee?: string;
  q?: string;
}

export function listTasks(filters: ListFilters = {}): Task[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filters.status && filters.status !== 'all') {
    assertStatus(filters.status);
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.project) {
    where.push('project = ?');
    params.push(filters.project);
  }
  if (filters.assignee !== undefined && filters.assignee !== '') {
    if (filters.assignee === 'none') {
      where.push("assignee = ''");
    } else if (filters.assignee === 'agent') {
      where.push("assignee != '' AND assignee != ?");
      params.push(HUMAN_ACTOR);
    } else {
      where.push('assignee = ?');
      params.push(filters.assignee);
    }
  }
  if (filters.q) {
    where.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY priority ASC, updated_at DESC`;
  return getDb().prepare(sql).all(...params) as unknown as Task[];
}

export interface CreateInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  project?: string;
  due_date?: string;
  assignee?: string;
  creator?: string; // 创建者的工具·模型（AI 创建时自填，人创建为空）
}

export function createTask(input: CreateInput, actor: string): Task {
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const status = input.status || 'todo';
  const priority = input.priority || 'P2';
  assertStatus(status);
  assertPriority(priority);
  const ts = now();
  const creator = input.creator || '';
  const result = getDb()
    .prepare(
      `INSERT INTO tasks (title, description, status, priority, project, assignee, creator, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description || '',
      status,
      priority,
      input.project || '',
      input.assignee || '',
      creator,
      input.due_date || '',
      ts,
      ts
    );
  const id = Number(result.lastInsertRowid);
  if (input.project) ensureProject(input.project);
  log(id, actor, 'created', title, { status, priority, creator });
  return getTask(id);
}

/** 领取者的工具/模型信息（人领取时为空） */
export interface AgentMeta {
  tool?: string;
  model?: string;
}

/**
 * 领取任务。id 为 null 时自动领取「待领取」列中优先级最高的未分配任务。
 * 领取 = 设为自己 + 状态改为进行中，并记录工具名/模型名。
 */
export function claimTask(id: number | null, actor: string, agent: AgentMeta = {}): Task {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    let task: Task;
    if (id === null) {
      const row = db
        .prepare(
          `SELECT * FROM tasks WHERE status = 'todo' AND assignee = ''
           ORDER BY priority ASC, created_at ASC LIMIT 1`
        )
        .get() as Task | undefined;
      if (!row) throw new StoreError('当前没有可领取的任务（「待领取」列为空或都已分配）', 404);
      task = row;
    } else {
      task = getTask(id);
      if (task.status === 'done') throw new StoreError(`${taskRef(task.id)} 已完成，无法领取`, 409);
      if (task.assignee && task.assignee !== actor) {
        throw new StoreError(`${taskRef(task.id)} 已被 ${task.assignee} 领取`, 409);
      }
    }
    const ts = now();
    const tool = agent.tool?.trim() || '';
    const model = agent.model?.trim() || '';
    db.prepare(
      `UPDATE tasks SET assignee = ?, agent_tool = ?, agent_model = ?, status = 'in_progress',
       claimed_at = ?, updated_at = ?, completed_at = '' WHERE id = ?`
    ).run(actor, tool, model, ts, ts, task.id);
    const meta: Record<string, string> = { from: task.status, to: 'in_progress' };
    if (tool) meta.tool = tool;
    if (model) meta.model = model;
    log(task.id, actor, 'claimed', '', meta);
    db.exec('COMMIT');
    return getTask(task.id);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 查看下一个可领取的任务（不产生任何变更） */
export function peekNext(): Task | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM tasks WHERE status = 'todo' AND assignee = ''
       ORDER BY priority ASC, created_at ASC LIMIT 1`
    )
    .get() as Task | undefined;
  return row ?? null;
}

/** 追加进度/评论 */
export function addNote(id: number, actor: string, content: string, kind: 'progress' | 'comment' = 'progress'): Task {
  const task = getTask(id);
  if (!content.trim()) throw new StoreError('内容不能为空');
  log(task.id, actor, kind, content.trim());
  getDb().prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), task.id);
  return getTask(task.id);
}

/** 移动状态。移回 todo/backlog 时自动释放认领。 */
export function moveTask(id: number, to: string, actor: string, note = ''): Task {
  assertStatus(to);
  const task = getTask(id);
  if (task.status === to) return task;
  const ts = now();
  const release = to === 'todo' || to === 'backlog';
  getDb()
    .prepare(
      `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ?,
       assignee = CASE WHEN ? THEN '' ELSE assignee END,
       agent_tool = CASE WHEN ? THEN '' ELSE agent_tool END,
       agent_model = CASE WHEN ? THEN '' ELSE agent_model END,
       claimed_at = CASE WHEN ? THEN '' ELSE claimed_at END
       WHERE id = ?`
    )
    .run(to, ts, to === 'done' ? ts : '', release ? 1 : 0, release ? 1 : 0, release ? 1 : 0, release ? 1 : 0, task.id);
  log(task.id, actor, 'status', note, { from: task.status, to });
  return getTask(task.id);
}

/**
 * 完成任务。
 * Agent 完成默认进入「待审核」，由用户在看板上确认；人完成或 skipReview 时直接到「已完成」。
 */
export function completeTask(id: number, actor: string, summary = '', skipReview = false): Task {
  const task = getTask(id);
  if (task.status === 'done') throw new StoreError(`${taskRef(task.id)} 已经是完成状态`, 409);
  const toReview = isAgent(actor) && !skipReview;
  const to: Status = toReview ? 'review' : 'done';
  const ts = now();
  getDb()
    .prepare(`UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
    .run(to, ts, to === 'done' ? ts : '', task.id);
  log(task.id, actor, 'completed', summary, { from: task.status, to });
  return getTask(task.id);
}

export interface UpdateInput {
  title?: string;
  description?: string;
  priority?: string;
  project?: string;
  due_date?: string;
  assignee?: string;
}

export function updateTask(id: number, input: UpdateInput, actor: string): Task {
  const task = getTask(id);
  const fields: string[] = [];
  const params: (string | number)[] = [];
  const changed: string[] = [];
  const apply = (key: keyof UpdateInput, value: string | undefined) => {
    if (value === undefined || value === (task as unknown as Record<string, string>)[key]) return;
    fields.push(`${key} = ?`);
    params.push(value);
    changed.push(key);
  };
  if (input.priority !== undefined) assertPriority(input.priority);
  apply('title', input.title);
  apply('description', input.description);
  apply('priority', input.priority);
  apply('project', input.project);
  apply('due_date', input.due_date);
  apply('assignee', input.assignee);
  // 手动改负责人时，原来记录的工具/模型不再可信，清空等下次领取重写
  if (changed.includes('assignee')) {
    fields.push("agent_tool = ''", "agent_model = ''");
  }
  if (!fields.length) return task;
  params.push(now(), task.id);
  getDb().prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  if (changed.includes('project') && input.project) ensureProject(input.project);
  log(task.id, actor, 'updated', '', { changed });
  return getTask(task.id);
}

export function deleteTask(id: number): void {
  getTask(id); // 不存在则抛 404
  const db = getDb();
  db.prepare('DELETE FROM activity WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

/** 全局最近动态（带任务标题） */
export function recentActivity(limit = 30): Activity[] {
  return getDb()
    .prepare(
      `SELECT a.*, t.title AS task_title FROM activity a
       LEFT JOIN tasks t ON t.id = a.task_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit) as unknown as Activity[];
}

// ---------------- 项目 ----------------

function assertProjectStatus(s: string): asserts s is ProjectStatus {
  if (!PROJECT_STATUSES.includes(s as ProjectStatus)) {
    throw new StoreError(`无效项目状态: ${s}（可选: ${PROJECT_STATUSES.join(', ')}）`);
  }
}

/** 项目自动建档：任务登记/改项目时调用，不存在则补一行 */
export function ensureProject(name: string): void {
  const n = name.trim();
  if (!n) return;
  const ts = now();
  getDb()
    .prepare('INSERT OR IGNORE INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)')
    .run(n, ts, ts);
}

/** 所有项目名（项目表 ∪ 任务里出现过的），供筛选和补全 */
export function listProjectNames(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT name FROM projects
       UNION SELECT DISTINCT project FROM tasks WHERE project != ''
       ORDER BY name`
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

const PROJECT_ORDER: Record<ProjectStatus, number> = { active: 0, paused: 1, done: 2 };

/** 项目列表 + 任务统计，推进中在前、按最近动作排序 */
export function listProjectsWithStats(): ProjectWithStats[] {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects').all() as unknown as Project[];
  const taskRows = db
    .prepare("SELECT project, status, assignee, updated_at FROM tasks WHERE project != ''")
    .all() as { project: string; status: Status; assignee: string; updated_at: string }[];

  const statsOf = (name: string) => {
    const rows = taskRows.filter((r) => r.project === name);
    const by_status = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    let agents = 0;
    let last = '';
    for (const r of rows) {
      by_status[r.status] += 1;
      if (r.status === 'in_progress' && isAgent(r.assignee)) agents += 1;
      if (r.updated_at > last) last = r.updated_at;
    }
    return { total: rows.length, by_status, agents_working: agents, last_update: last };
  };

  return projects
    .map((p) => ({ ...p, ...statsOf(p.name) }))
    .sort(
      (a, b) =>
        PROJECT_ORDER[a.status] - PROJECT_ORDER[b.status] ||
        (b.last_update || b.updated_at).localeCompare(a.last_update || a.updated_at)
    );
}

export function getProject(name: string): Project & { tasks: Task[] } {
  const row = getDb().prepare('SELECT * FROM projects WHERE name = ?').get(name) as
    | Project
    | undefined;
  if (!row) throw new StoreError(`项目「${name}」不存在`, 404);
  const tasks = listTasks({ project: name });
  return { ...row, tasks };
}

export interface ProjectUpdateInput {
  goal?: string;
  status?: string;
  next_step?: string;
  blockers?: string;
}

/** 更新项目字段（不存在则先建档） */
export function updateProject(name: string, input: ProjectUpdateInput): Project & { tasks: Task[] } {
  const n = name.trim();
  if (!n) throw new StoreError('项目名不能为空');
  if (input.status !== undefined) assertProjectStatus(input.status);
  ensureProject(n);
  const fields: string[] = [];
  const params: string[] = [];
  for (const key of ['goal', 'status', 'next_step', 'blockers'] as const) {
    const v = input[key];
    if (v !== undefined) {
      fields.push(`${key} = ?`);
      params.push(v);
    }
  }
  if (fields.length) {
    params.push(now());
    getDb().prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = ? WHERE name = ?`).run(...params, n);
  }
  return getProject(n);
}

/** 删除项目档案（仅限没有关联任务时） */
export function deleteProject(name: string): void {
  const count = (
    getDb().prepare('SELECT COUNT(*) AS c FROM tasks WHERE project = ?').get(name) as { c: number }
  ).c;
  if (count > 0) throw new StoreError(`项目「${name}」下还有 ${count} 个任务，不能删除（可将状态改为已完成）`, 409);
  const r = getDb().prepare('DELETE FROM projects WHERE name = ?').run(name);
  if (Number(r.changes) === 0) throw new StoreError(`项目「${name}」不存在`, 404);
}
