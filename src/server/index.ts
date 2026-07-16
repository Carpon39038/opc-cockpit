import '../shared/quiet';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { HUMAN_ACTOR } from '../shared/types';
import { findRepoRoot } from '../shared/db';
import { MIME_BY_EXT, filesDir, saveImageBuffer } from '../shared/files';
import {
  StoreError,
  addDeps,
  addNote,
  addResearchItem,
  addTaskAttachment,
  claimTask,
  completeTask,
  createKnowledge,
  createResearch,
  createTask,
  deleteKnowledge,
  deleteProject,
  deleteResearch,
  deleteResearchItem,
  deleteTask,
  deleteTaskAttachment,
  distillResearch,
  getDependents,
  getDeps,
  getKnowledge,
  getProject,
  getResearchDetail,
  getTask,
  getTaskActivity,
  getTaskAttachments,
  listKnowledge,
  listProjectNames,
  listProjectsWithStats,
  listResearch,
  listTasks,
  moveTask,
  peekNext,
  recentActivity,
  removeDeps,
  updateKnowledge,
  updateProject,
  updateResearch,
  updateResearchItem,
  updateTask,
  updateTaskAttachment,
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
    attachments: getTaskAttachments(id),
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

// ---------------- 调研 ----------------

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

app.get('/api/research', (c) => {
  const { status, project, q, task } = c.req.query();
  return c.json(
    listResearch({ status: status || undefined, project, q, task_id: task ? Number(task) : undefined })
  );
});

app.post('/api/research', async (c) => {
  const body = await c.req.json();
  return c.json(
    createResearch(
      {
        title: String(body.title ?? ''),
        question: str(body.question),
        project: str(body.project),
        task_id: body.task_id ? Number(body.task_id) : undefined,
        creator: str(body.creator),
      },
      actorOf(body)
    ),
    201
  );
});

app.get('/api/research/:id', (c) => c.json(getResearchDetail(Number(c.req.param('id')))));

app.patch('/api/research/:id', async (c) => {
  const body = await c.req.json();
  return c.json(
    updateResearch(
      Number(c.req.param('id')),
      {
        title: str(body.title),
        question: str(body.question),
        status: str(body.status),
        conclusion: str(body.conclusion),
        project: str(body.project),
        task_id: body.task_id !== undefined ? Number(body.task_id) : undefined,
      },
      actorOf(body)
    )
  );
});

app.delete('/api/research/:id', (c) => {
  deleteResearch(Number(c.req.param('id')));
  return c.json({ ok: true });
});

app.post('/api/research/:id/items', async (c) => {
  const body = await c.req.json();
  return c.json(
    addResearchItem(
      Number(c.req.param('id')),
      {
        title: String(body.title ?? ''),
        url: str(body.url),
        image: str(body.image),
        body: str(body.body),
        tags: str(body.tags),
        rating: body.rating !== undefined ? Number(body.rating) : undefined,
        creator: str(body.creator),
      },
      actorOf(body)
    ),
    201
  );
});

// 结论沉淀为知识库条目，调研转入已归档
app.post('/api/research/:id/distill', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { research, entry } = distillResearch(Number(c.req.param('id')), actorOf(body), {
    type: str(body.type),
    global: Boolean(body.global),
    creator: str(body.creator),
  });
  return c.json({ research, knowledge: entry }, 201);
});

app.patch('/api/research-items/:id', async (c) => {
  const body = await c.req.json();
  return c.json(
    updateResearchItem(
      Number(c.req.param('id')),
      {
        title: str(body.title),
        url: str(body.url),
        image: str(body.image),
        body: str(body.body),
        tags: str(body.tags),
        rating: body.rating !== undefined ? Number(body.rating) : undefined,
      },
      actorOf(body)
    )
  );
});

app.delete('/api/research-items/:id', (c) => {
  deleteResearchItem(Number(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------- 附件（截图上传 / 访问 / 挂到任务） ----------------

// 挂附件到任务：body { file: 已上传的文件名, label?, creator?, actor? }
app.post('/api/tasks/:id/attachments', async (c) => {
  const body = await c.req.json();
  return c.json(
    addTaskAttachment(
      Number(c.req.param('id')),
      { file: String(body.file ?? ''), label: str(body.label), creator: str(body.creator) },
      actorOf(body)
    ),
    201
  );
});

app.patch('/api/attachments/:id', async (c) => {
  const body = await c.req.json();
  return c.json(updateTaskAttachment(Number(c.req.param('id')), String(body.label ?? '')));
});

app.delete('/api/attachments/:id', (c) => {
  deleteTaskAttachment(Number(c.req.param('id')));
  return c.json({ ok: true });
});

app.post('/api/files', async (c) => {
  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File)) return c.json({ error: '需要 multipart 字段 file（图片）' }, 400);
  const data = new Uint8Array(await f.arrayBuffer());
  return c.json({ file: saveImageBuffer(data, f.name || f.type) }, 201);
});

app.get('/files/:name', (c) => {
  const name = c.req.param('name');
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) return c.text('bad name', 400);
  try {
    const data = readFileSync(join(filesDir(), name));
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return c.body(new Uint8Array(data), 200, {
      'content-type': MIME_BY_EXT[ext] || 'application/octet-stream',
      // 文件名带时间戳随机串，内容不可变，放心长缓存
      'cache-control': 'public, max-age=31536000, immutable',
    });
  } catch {
    return c.text('not found', 404);
  }
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
