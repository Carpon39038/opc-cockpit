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
  addNote,
  claimTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  getTaskActivity,
  listProjects,
  listTasks,
  moveTask,
  peekNext,
  recentActivity,
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
  return c.json(createTask(body, actorOf(body)), 201);
});

app.get('/api/tasks/:id', (c) => {
  const id = Number(c.req.param('id'));
  return c.json({ ...getTask(id), activity: getTaskActivity(id) });
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

app.post('/api/tasks/:id/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(claimTask(Number(c.req.param('id')), actorOf(body)));
});

app.post('/api/claim-next', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(claimTask(null, actorOf(body)));
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

app.get('/api/meta', (c) => c.json({ projects: listProjects() }));

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
