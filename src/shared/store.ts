import { getDb } from './db';
import { deleteFiles } from './files';
import {
  Activity,
  ActivityKind,
  DepSummary,
  HUMAN_ACTOR,
  KNOWLEDGE_TYPES,
  KnowledgeEntry,
  KnowledgeType,
  PRIORITIES,
  Priority,
  PROJECT_STATUSES,
  Project,
  ProjectStatus,
  ProjectWithStats,
  RESEARCH_STATUSES,
  Research,
  ResearchItem,
  ResearchStatus,
  ResearchWithStats,
  STATUSES,
  STATUS_LABELS,
  Status,
  Task,
  TaskAttachment,
  isAgent,
  kbRef,
  researchRef,
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

/** 任务查询都附带 blocked_by（未完成前置任务的 id 逗号串，null = 未被阻塞）和附件数 */
const TASK_SELECT = `SELECT tasks.*, (
    SELECT group_concat(d.depends_on) FROM task_deps d
    JOIN tasks p ON p.id = d.depends_on
    WHERE d.task_id = tasks.id AND p.status != 'done'
  ) AS blocked_by, (
    SELECT COUNT(*) FROM task_attachments att WHERE att.task_id = tasks.id
  ) AS attachment_count FROM tasks`;

/** 就绪条件：不存在未完成的前置任务（自动领取 / next 的 SQL 过滤） */
const NOT_BLOCKED = `NOT EXISTS (
    SELECT 1 FROM task_deps d JOIN tasks p ON p.id = d.depends_on
    WHERE d.task_id = tasks.id AND p.status != 'done'
  )`;

export function getTask(id: number): Task {
  const row = getDb().prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(id) as Task | undefined;
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
  const sql = `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY priority ASC, updated_at DESC`;
  return getDb().prepare(sql).all(...params) as unknown as Task[];
}

// ---------------- 依赖 ----------------

/** 前置任务（本任务依赖谁） */
export function getDeps(id: number): DepSummary[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.status FROM task_deps d
       JOIN tasks t ON t.id = d.depends_on WHERE d.task_id = ? ORDER BY t.id`
    )
    .all(id) as unknown as DepSummary[];
}

/** 后续任务（谁依赖本任务） */
export function getDependents(id: number): DepSummary[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.status FROM task_deps d
       JOIN tasks t ON t.id = d.task_id WHERE d.depends_on = ? ORDER BY t.id`
    )
    .all(id) as unknown as DepSummary[];
}

/** 未完成的前置任务（非空 = 被阻塞，不可领取） */
export function unmetDeps(id: number): DepSummary[] {
  return getDeps(id).filter((d) => d.status !== 'done');
}

/** a 是否（直接或间接）依赖 b —— 加依赖前的环检测 */
function dependsOn(a: number, b: number): boolean {
  const stmt = getDb().prepare('SELECT depends_on FROM task_deps WHERE task_id = ?');
  const seen = new Set<number>();
  const queue = [a];
  while (queue.length) {
    const cur = queue.pop()!;
    if (cur === b) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const row of stmt.all(cur) as { depends_on: number }[]) queue.push(row.depends_on);
  }
  return false;
}

/** 添加前置依赖（幂等，重复添加忽略）。拒绝自依赖和环。 */
export function addDeps(taskId: number, depIds: number[], actor: string): Task {
  getTask(taskId);
  const db = getDb();
  const added: number[] = [];
  for (const depId of [...new Set(depIds)]) {
    if (depId === taskId) throw new StoreError(`${taskRef(taskId)} 不能依赖自己`);
    getTask(depId); // 不存在则 404
    if (dependsOn(depId, taskId)) {
      throw new StoreError(
        `${taskRef(depId)} 已（直接或间接）依赖 ${taskRef(taskId)}，反向添加会成环`,
        409
      );
    }
    const r = db
      .prepare('INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)')
      .run(taskId, depId);
    if (Number(r.changes) > 0) added.push(depId);
  }
  if (added.length) {
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), taskId);
    log(taskId, actor, 'dep', `添加前置 ${added.map(taskRef).join('、')}`, { op: 'add', deps: added });
  }
  return getTask(taskId);
}

/** 移除前置依赖 */
export function removeDeps(taskId: number, depIds: number[], actor: string): Task {
  getTask(taskId);
  const db = getDb();
  const removed: number[] = [];
  for (const depId of [...new Set(depIds)]) {
    const r = db.prepare('DELETE FROM task_deps WHERE task_id = ? AND depends_on = ?').run(taskId, depId);
    if (Number(r.changes) > 0) removed.push(depId);
  }
  if (removed.length) {
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), taskId);
    log(taskId, actor, 'dep', `移除前置 ${removed.map(taskRef).join('、')}`, { op: 'remove', deps: removed });
  }
  return getTask(taskId);
}

/** 因某任务完成而解锁的下游任务（此前被它挡住、现在全部前置就绪的待办） */
function unlockedBy(id: number): DepSummary[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.status FROM task_deps d
       JOIN tasks t ON t.id = d.task_id
       WHERE d.depends_on = ? AND t.status IN ('backlog', 'todo')
       AND NOT EXISTS (
         SELECT 1 FROM task_deps d2 JOIN tasks p ON p.id = d2.depends_on
         WHERE d2.task_id = t.id AND p.status != 'done'
       ) ORDER BY t.id`
    )
    .all(id) as unknown as DepSummary[];
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
  deps?: number[]; // 前置任务 id（全部完成后本任务才可领取）
}

export function createTask(input: CreateInput, actor: string): Task {
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const status = input.status || 'todo';
  const priority = input.priority || 'P2';
  assertStatus(status);
  assertPriority(priority);
  for (const depId of input.deps ?? []) getTask(depId); // 前置必须存在，先校验再建
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
  if (input.deps?.length) addDeps(id, input.deps, actor);
  return getTask(id);
}

/** 领取者的工具/模型信息（人领取时为空） */
export interface AgentMeta {
  tool?: string;
  model?: string;
}

/**
 * 领取任务。id 为 null 时自动领取「待领取」列中优先级最高的未分配任务。
 * 传 preferProject 时优先领取该项目（忽略大小写）的任务，本项目无可领则全局兜底。
 * 领取 = 设为自己 + 状态改为进行中，并记录工具名/模型名。
 */
export function claimTask(
  id: number | null,
  actor: string,
  agent: AgentMeta = {},
  preferProject = ''
): Task {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    let task: Task;
    if (id === null) {
      let row: Task | undefined;
      // 优先领取当前项目的任务（项目名忽略大小写）；被前置阻塞的任务自动跳过
      if (preferProject.trim()) {
        row = db
          .prepare(
            `SELECT * FROM tasks WHERE status = 'todo' AND assignee = ''
             AND lower(project) = lower(?) AND ${NOT_BLOCKED}
             ORDER BY priority ASC, created_at ASC LIMIT 1`
          )
          .get(preferProject.trim()) as Task | undefined;
      }
      // 本项目无可领 → 全局兜底
      if (!row) {
        row = db
          .prepare(
            `SELECT * FROM tasks WHERE status = 'todo' AND assignee = '' AND ${NOT_BLOCKED}
             ORDER BY priority ASC, created_at ASC LIMIT 1`
          )
          .get() as Task | undefined;
      }
      if (!row) throw new StoreError('当前没有可领取的任务（「待领取」列为空、都已分配或都被前置任务阻塞）', 404);
      task = row;
    } else {
      task = getTask(id);
      if (task.status === 'done') throw new StoreError(`${taskRef(task.id)} 已完成，无法领取`, 409);
      if (task.assignee && task.assignee !== actor) {
        throw new StoreError(`${taskRef(task.id)} 已被 ${task.assignee} 领取`, 409);
      }
      const unmet = unmetDeps(task.id);
      if (unmet.length) {
        const detail = unmet.map((d) => `${taskRef(d.id)}[${STATUS_LABELS[d.status]}]`).join('、');
        throw new StoreError(
          `${taskRef(task.id)} 被前置任务阻塞：${detail} 未完成。先做前置任务，或确认不需要后用 opc dep ${taskRef(task.id)} --rm <编号> 解除`,
          409
        );
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

/** 查看下一个可领取的任务（不产生任何变更；跳过被前置阻塞的） */
export function peekNext(): Task | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM tasks WHERE status = 'todo' AND assignee = '' AND ${NOT_BLOCKED}
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

/** 任务 + 因它完成而解锁的下游任务（done 时附带，供调用方提示） */
export type TaskWithUnlocked = Task & { unlocked?: DepSummary[] };

/** 移动状态。移回 todo/backlog 时自动释放认领；移到 done 时附带解锁的下游任务。 */
export function moveTask(id: number, to: string, actor: string, note = ''): TaskWithUnlocked {
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
  const result: TaskWithUnlocked = getTask(task.id);
  if (to === 'done') {
    const unlocked = unlockedBy(task.id);
    if (unlocked.length) result.unlocked = unlocked;
  }
  return result;
}

/**
 * 完成任务。
 * Agent 完成默认进入「待审核」，由用户在看板上确认；人完成或 skipReview 时直接到「已完成」。
 */
export function completeTask(id: number, actor: string, summary = '', skipReview = false): TaskWithUnlocked {
  const task = getTask(id);
  if (task.status === 'done') throw new StoreError(`${taskRef(task.id)} 已经是完成状态`, 409);
  const toReview = isAgent(actor) && !skipReview;
  const to: Status = toReview ? 'review' : 'done';
  const ts = now();
  getDb()
    .prepare(`UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
    .run(to, ts, to === 'done' ? ts : '', task.id);
  log(task.id, actor, 'completed', summary, { from: task.status, to });
  const result: TaskWithUnlocked = getTask(task.id);
  if (to === 'done') {
    const unlocked = unlockedBy(task.id);
    if (unlocked.length) result.unlocked = unlocked;
  }
  return result;
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
  const files = getTaskAttachments(id).map((a) => a.file);
  db.prepare('DELETE FROM activity WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM task_deps WHERE task_id = ? OR depends_on = ?').run(id, id);
  db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  deleteFiles(files);
}

// ---------------- 附件 ----------------

export function getTaskAttachments(taskId: number): TaskAttachment[] {
  return getDb()
    .prepare('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY id ASC')
    .all(taskId) as unknown as TaskAttachment[];
}

export function getTaskAttachment(id: number): TaskAttachment {
  const row = getDb().prepare('SELECT * FROM task_attachments WHERE id = ?').get(id) as
    | TaskAttachment
    | undefined;
  if (!row) throw new StoreError(`附件 #${id} 不存在`, 404);
  return row;
}

export interface AttachmentInput {
  file: string; // 已存入附件目录的文件名
  label?: string;
  creator?: string;
}

/** 给任务挂附件图片（file 传已存入附件目录的文件名），会在任务动态留痕 */
export function addTaskAttachment(taskId: number, input: AttachmentInput, actor: string): TaskAttachment {
  const task = getTask(taskId);
  const file = input.file?.trim();
  if (!file) throw new StoreError('附件文件名不能为空');
  const label = input.label?.trim() || '';
  const ts = now();
  const result = getDb()
    .prepare(
      `INSERT INTO task_attachments (task_id, file, label, creator, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(task.id, file, label, input.creator || '', actor, ts);
  const id = Number(result.lastInsertRowid);
  getDb().prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, task.id);
  log(task.id, actor, 'attachment', label || file, { attachment_id: id, file });
  return getTaskAttachment(id);
}

/** 改附件说明 */
export function updateTaskAttachment(id: number, label: string): TaskAttachment {
  const att = getTaskAttachment(id);
  getDb().prepare('UPDATE task_attachments SET label = ? WHERE id = ?').run(label.trim(), att.id);
  return getTaskAttachment(id);
}

/** 删附件（连同文件） */
export function deleteTaskAttachment(id: number): void {
  const att = getTaskAttachment(id);
  getDb().prepare('DELETE FROM task_attachments WHERE id = ?').run(id);
  deleteFiles([att.file]);
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

// ---------------- 知识库 ----------------

function assertKnowledgeType(t: string): asserts t is KnowledgeType {
  if (!KNOWLEDGE_TYPES.includes(t as KnowledgeType)) {
    throw new StoreError(`无效知识类型: ${t}（可选: ${KNOWLEDGE_TYPES.join(', ')}）`);
  }
}

/** tags 规范化：逗号/顿号分隔 → trim、去空、去重，存回逗号分隔 */
function normalizeTags(tags: string): string {
  return [...new Set(tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean))].join(',');
}

const KB_SELECT = `SELECT k.*, t.title AS task_title FROM knowledge k
  LEFT JOIN tasks t ON t.id = k.task_id`;

export function getKnowledge(id: number): KnowledgeEntry {
  const row = getDb().prepare(`${KB_SELECT} WHERE k.id = ?`).get(id) as KnowledgeEntry | undefined;
  if (!row) throw new StoreError(`知识条目 ${kbRef(id)} 不存在`, 404);
  return row;
}

export interface KnowledgeFilters {
  type?: string;
  project?: string;
  tag?: string;
  q?: string;
  task_id?: number;
}

export function listKnowledge(filters: KnowledgeFilters = {}): KnowledgeEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.type) {
    assertKnowledgeType(filters.type);
    where.push('k.type = ?');
    params.push(filters.type);
  }
  if (filters.project) {
    where.push('lower(k.project) = lower(?)');
    params.push(filters.project);
  }
  if (filters.tag) {
    where.push("(',' || k.tags || ',') LIKE ('%,' || ? || ',%')");
    params.push(filters.tag.trim());
  }
  if (filters.task_id) {
    where.push('k.task_id = ?');
    params.push(filters.task_id);
  }
  if (filters.q) {
    where.push('(k.title LIKE ? OR k.body LIKE ? OR k.tags LIKE ?)');
    const kw = `%${filters.q}%`;
    params.push(kw, kw, kw);
  }
  const sql = `${KB_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY k.updated_at DESC`;
  return getDb().prepare(sql).all(...params) as unknown as KnowledgeEntry[];
}

/** 领任务时带出的相关知识：同项目 ∪ 通用（project=''），最近更新在前 */
export function relatedKnowledge(project: string, limit = 8): KnowledgeEntry[] {
  const p = project.trim();
  if (!p) {
    return getDb()
      .prepare(`${KB_SELECT} WHERE k.project = '' ORDER BY k.updated_at DESC LIMIT ?`)
      .all(limit) as unknown as KnowledgeEntry[];
  }
  return getDb()
    .prepare(
      `${KB_SELECT} WHERE lower(k.project) = lower(?) OR k.project = ''
       ORDER BY k.updated_at DESC LIMIT ?`
    )
    .all(p, limit) as unknown as KnowledgeEntry[];
}

export interface KnowledgeCreateInput {
  type?: string;
  title: string;
  body?: string;
  tags?: string;
  project?: string;
  task_id?: number;
  source_url?: string;
  creator?: string;
}

export function createKnowledge(input: KnowledgeCreateInput, actor: string): KnowledgeEntry {
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const type = input.type || 'knowledge';
  assertKnowledgeType(type);
  const taskId = input.task_id || 0;
  if (taskId) getTask(taskId); // 关联任务必须存在
  const ts = now();
  const result = getDb()
    .prepare(
      `INSERT INTO knowledge (type, title, body, tags, project, task_id, source_url, creator, actor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      type,
      title,
      input.body || '',
      normalizeTags(input.tags || ''),
      input.project?.trim() || '',
      taskId,
      input.source_url?.trim() || '',
      input.creator || '',
      actor,
      ts,
      ts
    );
  const id = Number(result.lastInsertRowid);
  if (input.project?.trim()) ensureProject(input.project);
  // 关联任务时在任务动态里留痕，看板运行日志可见
  if (taskId) log(taskId, actor, 'knowledge', `${kbRef(id)} ${title}`, { kb_id: id, kb_type: type });
  return getKnowledge(id);
}

export interface KnowledgeUpdateInput {
  type?: string;
  title?: string;
  body?: string;
  tags?: string;
  project?: string;
  task_id?: number;
  source_url?: string;
}

export function updateKnowledge(id: number, input: KnowledgeUpdateInput, actor: string): KnowledgeEntry {
  const entry = getKnowledge(id);
  if (input.type !== undefined) assertKnowledgeType(input.type);
  if (input.task_id) getTask(input.task_id);
  const fields: string[] = [];
  const params: (string | number)[] = [];
  const apply = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === (entry as unknown as Record<string, string | number>)[key]) return;
    fields.push(`${key} = ?`);
    params.push(value);
  };
  apply('type', input.type);
  apply('title', input.title?.trim());
  apply('body', input.body);
  apply('tags', input.tags === undefined ? undefined : normalizeTags(input.tags));
  apply('project', input.project === undefined ? undefined : input.project.trim());
  apply('task_id', input.task_id);
  apply('source_url', input.source_url === undefined ? undefined : input.source_url.trim());
  if (!fields.length) return entry;
  params.push(now(), id);
  getDb().prepare(`UPDATE knowledge SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  if (input.project?.trim()) ensureProject(input.project);
  // 新关联任务时留痕（原来没关联、现在关联上）
  if (input.task_id && input.task_id !== entry.task_id) {
    log(input.task_id, actor, 'knowledge', `${kbRef(id)} ${input.title?.trim() || entry.title}`, {
      kb_id: id,
      kb_type: input.type || entry.type,
    });
  }
  return getKnowledge(id);
}

export function deleteKnowledge(id: number): void {
  getKnowledge(id); // 不存在则抛 404
  getDb().prepare('DELETE FROM knowledge WHERE id = ?').run(id);
}

// ---------------- 调研 ----------------

function assertResearchStatus(s: string): asserts s is ResearchStatus {
  if (!RESEARCH_STATUSES.includes(s as ResearchStatus)) {
    throw new StoreError(`无效调研状态: ${s}（可选: ${RESEARCH_STATUSES.join(', ')}）`);
  }
}

function assertRating(r: number): void {
  if (!Number.isInteger(r) || r < 0 || r > 5) {
    throw new StoreError(`无效评级: ${r}（0 = 未评级，1-5 星）`);
  }
}

const RESEARCH_SELECT = `SELECT r.*, t.title AS task_title FROM research r
  LEFT JOIN tasks t ON t.id = r.task_id`;

export function getResearch(id: number): Research {
  const row = getDb().prepare(`${RESEARCH_SELECT} WHERE r.id = ?`).get(id) as Research | undefined;
  if (!row) throw new StoreError(`调研 ${researchRef(id)} 不存在`, 404);
  return row;
}

export function getResearchItems(researchId: number): ResearchItem[] {
  return getDb()
    .prepare('SELECT * FROM research_items WHERE research_id = ? ORDER BY id ASC')
    .all(researchId) as unknown as ResearchItem[];
}

export type ResearchDetail = Research & { items: ResearchItem[] };

export function getResearchDetail(id: number): ResearchDetail {
  return { ...getResearch(id), items: getResearchItems(id) };
}

export interface ResearchFilters {
  status?: string;
  project?: string;
  q?: string;
  task_id?: number;
}

export function listResearch(filters: ResearchFilters = {}): ResearchWithStats[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status && filters.status !== 'all') {
    assertResearchStatus(filters.status);
    where.push('r.status = ?');
    params.push(filters.status);
  }
  if (filters.project) {
    where.push('lower(r.project) = lower(?)');
    params.push(filters.project);
  }
  if (filters.task_id) {
    where.push('r.task_id = ?');
    params.push(filters.task_id);
  }
  if (filters.q) {
    where.push('(r.title LIKE ? OR r.question LIKE ? OR r.conclusion LIKE ?)');
    const kw = `%${filters.q}%`;
    params.push(kw, kw, kw);
  }
  const sql = `SELECT r.*, t.title AS task_title,
      (SELECT COUNT(*) FROM research_items i WHERE i.research_id = r.id) AS item_count,
      (SELECT i.image FROM research_items i WHERE i.research_id = r.id AND i.image != ''
       ORDER BY i.id DESC LIMIT 1) AS cover
    FROM research r LEFT JOIN tasks t ON t.id = r.task_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.updated_at DESC`;
  const rows = getDb().prepare(sql).all(...params) as unknown as ResearchWithStats[];
  return rows.map((r) => ({ ...r, cover: r.cover ?? '' }));
}

export interface ResearchCreateInput {
  title: string;
  question?: string;
  project?: string;
  task_id?: number;
  creator?: string;
}

export function createResearch(input: ResearchCreateInput, actor: string): Research {
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const taskId = input.task_id || 0;
  if (taskId) getTask(taskId); // 关联任务必须存在
  const ts = now();
  const result = getDb()
    .prepare(
      `INSERT INTO research (title, question, project, task_id, creator, actor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, input.question || '', input.project?.trim() || '', taskId, input.creator || '', actor, ts, ts);
  const id = Number(result.lastInsertRowid);
  if (input.project?.trim()) ensureProject(input.project);
  if (taskId) log(taskId, actor, 'research', `发起调研 ${researchRef(id)}「${title}」`, { research_id: id });
  return getResearch(id);
}

export interface ResearchUpdateInput {
  title?: string;
  question?: string;
  status?: string;
  conclusion?: string;
  project?: string;
  task_id?: number;
}

export function updateResearch(id: number, input: ResearchUpdateInput, actor: string): Research {
  const research = getResearch(id);
  if (input.status !== undefined) assertResearchStatus(input.status);
  if (input.task_id) getTask(input.task_id);
  const fields: string[] = [];
  const params: (string | number)[] = [];
  const apply = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === (research as unknown as Record<string, string | number>)[key]) return;
    fields.push(`${key} = ?`);
    params.push(value);
  };
  apply('title', input.title?.trim());
  apply('question', input.question);
  apply('status', input.status);
  apply('conclusion', input.conclusion);
  apply('project', input.project === undefined ? undefined : input.project.trim());
  apply('task_id', input.task_id);
  if (!fields.length) return research;
  params.push(now(), id);
  getDb().prepare(`UPDATE research SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  if (input.project?.trim()) ensureProject(input.project);
  const updated = getResearch(id);
  // 结论首次写入/更新时在关联任务留痕，看板运行日志可见
  if (input.conclusion !== undefined && input.conclusion !== research.conclusion && updated.task_id) {
    log(updated.task_id, actor, 'research', `调研 ${researchRef(id)}「${updated.title}」结论已更新`, { research_id: id });
  } else if (input.task_id && input.task_id !== research.task_id) {
    log(input.task_id, actor, 'research', `关联调研 ${researchRef(id)}「${updated.title}」`, { research_id: id });
  }
  return updated;
}

export function deleteResearch(id: number): void {
  getResearch(id); // 不存在则抛 404
  const db = getDb();
  const images = getResearchItems(id).map((i) => i.image);
  db.prepare('DELETE FROM research_items WHERE research_id = ?').run(id);
  db.prepare('DELETE FROM research WHERE id = ?').run(id);
  deleteFiles(images);
}

export function getResearchItem(id: number): ResearchItem {
  const row = getDb().prepare('SELECT * FROM research_items WHERE id = ?').get(id) as
    | ResearchItem
    | undefined;
  if (!row) throw new StoreError(`资料条目 #${id} 不存在`, 404);
  return row;
}

export interface ResearchItemInput {
  title: string;
  url?: string;
  image?: string;
  body?: string;
  tags?: string;
  rating?: number;
  creator?: string;
}

/** 往资料池加一条资料卡（image 传已存入附件目录的文件名） */
export function addResearchItem(researchId: number, input: ResearchItemInput, actor: string): ResearchItem {
  const research = getResearch(researchId);
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const rating = input.rating ?? 0;
  assertRating(rating);
  const ts = now();
  const result = getDb()
    .prepare(
      `INSERT INTO research_items (research_id, title, url, image, body, tags, rating, creator, actor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      research.id,
      title,
      input.url?.trim() || '',
      input.image?.trim() || '',
      input.body || '',
      normalizeTags(input.tags || ''),
      rating,
      input.creator || '',
      actor,
      ts,
      ts
    );
  // 资料池有动静就算调研在推进，更新调研时间戳让列表浮上来
  getDb().prepare('UPDATE research SET updated_at = ? WHERE id = ?').run(ts, research.id);
  return getResearchItem(Number(result.lastInsertRowid));
}

export type ResearchItemUpdateInput = Partial<Omit<ResearchItemInput, 'creator'>>;

export function updateResearchItem(id: number, input: ResearchItemUpdateInput, actor: string): ResearchItem {
  void actor;
  const item = getResearchItem(id);
  if (input.rating !== undefined) assertRating(input.rating);
  const fields: string[] = [];
  const params: (string | number)[] = [];
  const apply = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === (item as unknown as Record<string, string | number>)[key]) return;
    fields.push(`${key} = ?`);
    params.push(value);
  };
  apply('title', input.title?.trim());
  apply('url', input.url === undefined ? undefined : input.url.trim());
  apply('image', input.image === undefined ? undefined : input.image.trim());
  apply('body', input.body);
  apply('tags', input.tags === undefined ? undefined : normalizeTags(input.tags));
  apply('rating', input.rating);
  if (!fields.length) return item;
  params.push(now(), id);
  getDb().prepare(`UPDATE research_items SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  // 换图后清掉旧附件
  if (input.image !== undefined && item.image && input.image.trim() !== item.image) {
    deleteFiles([item.image]);
  }
  return getResearchItem(id);
}

export function deleteResearchItem(id: number): void {
  const item = getResearchItem(id);
  getDb().prepare('DELETE FROM research_items WHERE id = ?').run(id);
  deleteFiles([item.image]);
}

/** 结论沉淀到知识库时附带的精选参考：4 星以上全带，没有高星则取前几条 */
function distillRefs(items: ResearchItem[]): string {
  const starred = items.filter((i) => i.rating >= 4);
  const picked = (starred.length ? starred : items).slice(0, 12);
  if (!picked.length) return '';
  const lines = picked
    .sort((a, b) => b.rating - a.rating || a.id - b.id)
    .map((i) => {
      const name = i.url ? `[${i.title}](${i.url})` : i.title;
      return `- ${name}${i.rating ? ` ★${i.rating}` : ''}`;
    });
  return `\n\n## 精选参考\n\n${lines.join('\n')}`;
}

export interface DistillOptions {
  type?: string;
  global?: boolean;
  creator?: string;
}

/**
 * 把调研结论沉淀为知识库条目（调研是生产线，知识库是仓库）。
 * 生成 K-x 后调研转为「已归档」。
 */
export function distillResearch(id: number, actor: string, opts: DistillOptions = {}): { research: Research; entry: KnowledgeEntry } {
  const research = getResearch(id);
  if (!research.conclusion.trim()) {
    throw new StoreError(`调研 ${researchRef(id)} 还没有结论，先 conclude 写总结再沉淀`);
  }
  const items = getResearchItems(id);
  const body = `> 源自调研 ${researchRef(id)}「${research.title}」\n\n${research.conclusion}${distillRefs(items)}`;
  const entry = createKnowledge(
    {
      type: opts.type || 'knowledge',
      title: research.title,
      body,
      project: opts.global ? '' : research.project,
      task_id: research.task_id || undefined,
      creator: opts.creator,
    },
    actor
  );
  const updated = updateResearch(id, { status: 'archived' }, actor);
  if (research.task_id) {
    log(research.task_id, actor, 'research', `调研 ${researchRef(id)} 沉淀为 ${kbRef(entry.id)}`, {
      research_id: id,
      kb_id: entry.id,
    });
  }
  return { research: updated, entry };
}
