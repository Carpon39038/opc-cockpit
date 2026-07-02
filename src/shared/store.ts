import { getDb } from './db';
import {
  Activity,
  ActivityKind,
  HUMAN_ACTOR,
  PRIORITIES,
  Priority,
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
}

export function createTask(input: CreateInput, actor: string): Task {
  const title = input.title?.trim();
  if (!title) throw new StoreError('标题不能为空');
  const status = input.status || 'todo';
  const priority = input.priority || 'P2';
  assertStatus(status);
  assertPriority(priority);
  const ts = now();
  const result = getDb()
    .prepare(
      `INSERT INTO tasks (title, description, status, priority, project, assignee, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description || '',
      status,
      priority,
      input.project || '',
      input.assignee || '',
      input.due_date || '',
      ts,
      ts
    );
  const id = Number(result.lastInsertRowid);
  log(id, actor, 'created', title, { status, priority });
  return getTask(id);
}

/**
 * 领取任务。id 为 null 时自动领取「待领取」列中优先级最高的未分配任务。
 * 领取 = 设为自己 + 状态改为进行中。
 */
export function claimTask(id: number | null, actor: string): Task {
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
    db.prepare(
      `UPDATE tasks SET assignee = ?, status = 'in_progress', claimed_at = ?, updated_at = ?, completed_at = '' WHERE id = ?`
    ).run(actor, ts, ts, task.id);
    log(task.id, actor, 'claimed', '', { from: task.status, to: 'in_progress' });
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
       claimed_at = CASE WHEN ? THEN '' ELSE claimed_at END
       WHERE id = ?`
    )
    .run(to, ts, to === 'done' ? ts : '', release ? 1 : 0, release ? 1 : 0, task.id);
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
  if (!fields.length) return task;
  params.push(now(), task.id);
  getDb().prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
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

/** 看板元信息：所有出现过的项目名 */
export function listProjects(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT project FROM tasks WHERE project != '' ORDER BY project")
    .all() as { project: string }[];
  return rows.map((r) => r.project);
}
