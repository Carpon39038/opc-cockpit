import type {
  Activity,
  DepSummary,
  KnowledgeEntry,
  Project,
  ProjectWithStats,
  Research,
  ResearchItem,
  ResearchWithStats,
  Task,
} from '../../src/shared/types';

export type TaskDetail = Task & {
  activity: Activity[];
  knowledge: KnowledgeEntry[];
  deps: DepSummary[];
  dependents: DepSummary[];
};
export type ProjectDetail = Project & { tasks: Task[] };
export type ProjectPatch = Partial<Pick<Project, 'goal' | 'status' | 'next_step' | 'blockers'>>;
export type KbPatch = Partial<
  Pick<KnowledgeEntry, 'type' | 'title' | 'body' | 'tags' | 'project' | 'task_id' | 'source_url'>
>;
export type ResearchDetail = Research & { items: ResearchItem[] };
export type ResearchPatch = Partial<
  Pick<Research, 'title' | 'question' | 'status' | 'conclusion' | 'project' | 'task_id'>
>;
export type ResearchItemPatch = Partial<
  Pick<ResearchItem, 'title' | 'url' | 'image' | 'body' | 'tags' | 'rating'>
>;

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
  create: (input: Partial<Task> & { deps?: number[] }) => post('/api/tasks', input).then((r) => j<Task>(r)),
  // 增删前置依赖
  setDeps: (id: number, body: { add?: number[]; remove?: number[] }) =>
    post(`/api/tasks/${id}/deps`, body).then((r) => j<Task>(r)),
  // 状态变更（可带 note）和字段更新共用 PATCH
  patch: (id: number, fields: Partial<Task> & { note?: string }) =>
    post(`/api/tasks/${id}`, fields, 'PATCH').then((r) => j<Task>(r)),
  comment: (id: number, content: string) =>
    post(`/api/tasks/${id}/progress`, { content, kind: 'comment' }).then((r) => j<Task>(r)),
  remove: (id: number) => fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),

  kb: () => fetch('/api/kb').then((r) => j<KnowledgeEntry[]>(r)),
  createKb: (input: KbPatch) => post('/api/kb', input).then((r) => j<KnowledgeEntry>(r)),
  patchKb: (id: number, fields: KbPatch) => post(`/api/kb/${id}`, fields, 'PATCH').then((r) => j<KnowledgeEntry>(r)),
  removeKb: (id: number) => fetch(`/api/kb/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),

  research: () => fetch('/api/research').then((r) => j<ResearchWithStats[]>(r)),
  researchDetail: (id: number) => fetch(`/api/research/${id}`).then((r) => j<ResearchDetail>(r)),
  createResearch: (input: ResearchPatch) => post('/api/research', input).then((r) => j<Research>(r)),
  patchResearch: (id: number, fields: ResearchPatch) =>
    post(`/api/research/${id}`, fields, 'PATCH').then((r) => j<Research>(r)),
  removeResearch: (id: number) =>
    fetch(`/api/research/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  distillResearch: (id: number) =>
    post(`/api/research/${id}/distill`, {}).then((r) => j<{ research: Research; knowledge: KnowledgeEntry }>(r)),
  addResearchItem: (researchId: number, fields: ResearchItemPatch) =>
    post(`/api/research/${researchId}/items`, fields).then((r) => j<ResearchItem>(r)),
  patchResearchItem: (id: number, fields: ResearchItemPatch) =>
    post(`/api/research-items/${id}`, fields, 'PATCH').then((r) => j<ResearchItem>(r)),
  removeResearchItem: (id: number) =>
    fetch(`/api/research-items/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  // 截图/图片上传：返回附件文件名，UI 经 /files/<name> 访问
  uploadFile: (file: File | Blob) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/files', { method: 'POST', body: fd }).then((r) => j<{ file: string }>(r));
  },

  projects: () => fetch('/api/projects').then((r) => j<ProjectWithStats[]>(r)),
  createProject: (name: string) => post('/api/projects', { name }).then((r) => j<ProjectDetail>(r)),
  patchProject: (name: string, fields: ProjectPatch) =>
    post(`/api/projects/${encodeURIComponent(name)}`, fields, 'PATCH').then((r) => j<ProjectDetail>(r)),
  removeProject: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
};
