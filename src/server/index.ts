import '../shared/quiet';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { HUMAN_ACTOR } from '../shared/types';
import { findRepoRoot } from '../shared/db';
import {
  StoreError,
  addDeps,
  addNote,
  claimTask,
  completeTask,
  createKnowledge,
  createTask,
  deleteKnowledge,
  deleteProject,
  deleteTask,
  getDependents,
  getDeps,
  getKnowledge,
  getProject,
  getTask,
  getTaskActivity,
  listKnowledge,
  listProjectNames,
  listProjectsWithStats,
  listTasks,
  moveTask,
  peekNext,
  recentActivity,
  removeDeps,
  updateKnowledge,
  updateProject,
  updateTask,
} from '../shared/store';

const app = new Hono();
const root = findRepoRoot();

app.onError((e, c) => {
  if (e instanceof StoreError) {
    return c.json({ error: e.message }, e.code as 400);
  }
  console.error(e);
  return c.json({ error: String(e) }, 500);
});

// UI 端默认以用户本人身份操作；body 里可显式传 actor（供程序化调用）
function actorOf(body: Record<string, unknown> | undefined): string {
  const a = body?.actor;
  return typeof a === 'string' && a.trim() ? a.trim() : HUMAN_ACTOR;
}

app.get('/api/tasks', (c) => {
  const { status, project, assignee, q } = c.req.query();
  return c.json(listTasks({ status: status || 'all', project, assignee, q }));
});

app.post('/api/tasks', async (c) => {
  const body = await c.req.json();
  const deps = Array.isArray(body.deps)
    ? body.deps.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : undefined;
  return c.json(createTask({ ...body, deps }, actorOf(body)), 201);
});

app.get('/api/tasks/:id', (c) => {
  const id = Number(c.req.param('id'));
  return c.json({
    ...getTask(id),
    deps: getDeps(id),
    dependents: getDependents(id),
    activity: getTaskActivity(id),
    knowledge: listKnowledge({ task_id: id }),
  });
});

app.patch('/api/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const actor = actorOf(body);
  let task = getTask(id);
  if (typeof body.status === 'string' && body.status !== task.status) {
    task = moveTask(id, body.status, actor, typeof body.note === 'string' ? body.note : '');
  }
  task = updateTask(
    id,
    {
      title: body.title,
      description: body.description,
      priority: body.priority,
      project: body.project,
      due_date: body.due_date,
      assignee: body.assignee,
    },
    actor
  );
  return c.json(task);
});

app.delete('/api/tasks/:id', (c) => {
  deleteTask(Number(c.req.param('id')));
  return c.json({ ok: true });
});

// 增删前置依赖：body { add?: number[], remove?: number[] }，返回最新依赖
app.post('/api/tasks/:id/deps', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const actor = actorOf(body);
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
  const add = ids(body.add);
  const remove = ids(body.remove);
  if (add.length) addDeps(id, add, actor);
  if (remove.length) removeDeps(id, remove, actor);
  return c.json({ ...getTask(id), deps: getDeps(id), dependents: getDependents(id) });
});

function agentOf(body: Record<string, unknown>): { tool?: string; model?: string } {
  return {
    tool: typeof body.tool === 'string' ? body.tool : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
  };
}

app.post('/api/tasks/:id/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(claimTask(Number(c.req.param('id')), actorOf(body), agentOf(body)));
});

app.post('/api/claim-next', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // 可选 project：优先领取该项目（忽略大小写），无可领则全局兜底
  const preferProject = typeof body?.project === 'string' ? body.project : '';
  return c.json(claimTask(null, actorOf(body), agentOf(body), preferProject));
});

app.get('/api/next', (c) => c.json(peekNext()));

app.post('/api/tasks/:id/progress', async (c) => {
  const body = await c.req.json();
  const kind = body.kind === 'comment' ? 'comment' : 'progress';
  return c.json(addNote(Number(c.req.param('id')), actorOf(body), String(body.content ?? ''), kind));
});

app.post('/api/tasks/:id/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(
    completeTask(
      Number(c.req.param('id')),
      actorOf(body),
      typeof body.summary === 'string' ? body.summary : '',
      Boolean(body.skipReview)
    )
  );
});

app.get('/api/activity', (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 30, 200);
  return c.json(recentActivity(limit));
});

app.get('/api/meta', (c) => c.json({ projects: listProjectNames() }));

// ---------------- 项目 ----------------

app.get('/api/projects', (c) => c.json(listProjectsWithStats()));

app.post('/api/projects', async (c) => {
  const body = await c.req.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: '项目名不能为空' }, 400);
  return c.json(
    updateProject(name, {
      goal: typeof body.goal === 'string' ? body.goal : undefined,
      next_step: typeof body.next_step === 'string' ? body.next_step : undefined,
      blockers: typeof body.blockers === 'string' ? body.blockers : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
    }),
    201
  );
});

app.get('/api/projects/:name', (c) => c.json(getProject(c.req.param('name'))));

app.patch('/api/projects/:name', async (c) => {
  const body = await c.req.json();
  return c.json(
    updateProject(c.req.param('name'), {
      goal: typeof body.goal === 'string' ? body.goal : undefined,
      next_step: typeof body.next_step === 'string' ? body.next_step : undefined,
      blockers: typeof body.blockers === 'string' ? body.blockers : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
    })
  );
});

app.delete('/api/projects/:name', (c) => {
  deleteProject(c.req.param('name'));
  return c.json({ ok: true });
});

// ---------------- 知识库 ----------------

app.get('/api/kb', (c) => {
  const { type, project, tag, q, task } = c.req.query();
  return c.json(
    listKnowledge({ type: type || undefined, project, tag, q, task_id: task ? Number(task) : undefined })
  );
});

app.post('/api/kb', async (c) => {
  const body = await c.req.json();
  return c.json(
    createKnowledge(
      {
        type: typeof body.type === 'string' ? body.type : undefined,
        title: String(body.title ?? ''),
        body: typeof body.body === 'string' ? body.body : undefined,
        tags: typeof body.tags === 'string' ? body.tags : undefined,
        project: typeof body.project === 'string' ? body.project : undefined,
        task_id: body.task_id ? Number(body.task_id) : undefined,
        source_url: typeof body.source_url === 'string' ? body.source_url : undefined,
        creator: typeof body.creator === 'string' ? body.creator : undefined,
      },
      actorOf(body)
    ),
    201
  );
});

app.get('/api/kb/:id', (c) => c.json(getKnowledge(Number(c.req.param('id')))));

app.patch('/api/kb/:id', async (c) => {
  const body = await c.req.json();
  return c.json(
    updateKnowledge(
      Number(c.req.param('id')),
      {
        type: typeof body.type === 'string' ? body.type : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        body: typeof body.body === 'string' ? body.body : undefined,
        tags: typeof body.tags === 'string' ? body.tags : undefined,
        project: typeof body.project === 'string' ? body.project : undefined,
        task_id: body.task_id !== undefined ? Number(body.task_id) : undefined,
        source_url: typeof body.source_url === 'string' ? body.source_url : undefined,
      },
      actorOf(body)
    )
  );
});

app.delete('/api/kb/:id', (c) => {
  deleteKnowledge(Number(c.req.param('id')));
  return c.json({ ok: true });
});

// 静态资源（构建后的看板 UI）
app.use('/assets/*', serveStatic({ root: './web/dist' }));
app.get('*', (c) => {
  if (c.req.path.startsWith('/api')) return c.json({ error: 'not found' }, 404);
  try {
    return c.html(readFileSync(join(root, 'web', 'dist', 'index.html'), 'utf8'));
  } catch {
    return c.text('看板 UI 还没构建，请先运行: npm run build（开发模式请用 npm run dev 并访问 5173 端口）', 503);
  }
});

const port = Number(process.env.PORT) || 5175;
serve({ fetch: app.fetch, port }, () => {
  console.log(`OPC Cockpit server: http://localhost:${port}`);
});
