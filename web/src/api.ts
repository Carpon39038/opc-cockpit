import type { Activity, Project, ProjectWithStats, Task } from '../../src/shared/types';

export type TaskDetail = Task & { activity: Activity[] };
export type ProjectDetail = Project & { tasks: Task[] };
export type ProjectPatch = Partial<Pick<Project, 'goal' | 'status' | 'next_step' | 'blockers'>>;

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((body as { error?: string }).error || r.statusText);
  }
  return r.json() as Promise<T>;
}

const post = (url: string, body: unknown, method = 'POST') =>
  fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const api = {
  tasks: () => fetch('/api/tasks').then((r) => j<Task[]>(r)),
  detail: (id: number) => fetch(`/api/tasks/${id}`).then((r) => j<TaskDetail>(r)),
  activity: (limit = 40) => fetch(`/api/activity?limit=${limit}`).then((r) => j<Activity[]>(r)),
  create: (input: Partial<Task>) => post('/api/tasks', input).then((r) => j<Task>(r)),
  // 状态变更（可带 note）和字段更新共用 PATCH
  patch: (id: number, fields: Partial<Task> & { note?: string }) =>
    post(`/api/tasks/${id}`, fields, 'PATCH').then((r) => j<Task>(r)),
  comment: (id: number, content: string) =>
    post(`/api/tasks/${id}/progress`, { content, kind: 'comment' }).then((r) => j<Task>(r)),
  remove: (id: number) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),

  projects: () => fetch('/api/projects').then((r) => j<ProjectWithStats[]>(r)),
  createProject: (name: string) => post('/api/projects', { name }).then((r) => j<ProjectDetail>(r)),
  patchProject: (name: string, fields: ProjectPatch) =>
    post(`/api/projects/${encodeURIComponent(name)}`, fields, 'PATCH').then((r) => j<ProjectDetail>(r)),
  removeProject: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
};
