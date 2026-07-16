import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, KnowledgeEntry, ProjectWithStats, ResearchWithStats, Status, Task } from '../../src/shared/types';
import { isAgent } from '../../src/shared/types';
import { api, type KbPatch, type ProjectPatch, type TaskDetail } from './api';
import { Clock } from './components/Clock';
import { Drawer } from './components/Drawer';
import { NavRail } from './components/NavRail';
import { NewTaskModal } from './components/NewTaskModal';
import { BoardPage } from './pages/Board';
import { HomePage } from './pages/Home';
import { KnowledgePage } from './pages/Knowledge';
import { ProjectsPage } from './pages/Projects';
import { ResearchPage } from './pages/Research';

function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

const PAGE_TITLES: Record<string, [string, string]> = {
  '/': ['驾驶舱', 'DAILY OPS'],
  '/board': ['任务看板', 'TASK BOARD'],
  '/projects': ['项目中心', 'PROJECTS'],
  '/kb': ['知识库', 'KNOWLEDGE'],
  '/research': ['调研', 'RESEARCH'],
};

export default function App() {
  const route = useRoute();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [kb, setKb] = useState<KnowledgeEntry[]>([]);
  const [research, setResearch] = useState<ResearchWithStats[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [newStatus, setNewStatus] = useState<Status | null>(null);
  const [boardJump, setBoardJump] = useState<{ project: string; n: number }>({ project: '', n: 0 });
  const [error, setError] = useState('');
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const [t, a, p, k, r] = await Promise.all([
        api.tasks(),
        api.activity(),
        api.projects(),
        api.kb(),
        api.research(),
      ]);
      setTasks(t);
      setActivity(a);
      setProjects(p);
      setKb(k);
      setResearch(r);
      if (selectedRef.current !== null) {
        setDetail(await api.detail(selectedRef.current));
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3000);
    const onFocus = () => refresh();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const openTask = useCallback(async (id: number) => {
    setSelectedId(id);
    try {
      setDetail(await api.detail(id));
    } catch {
      setSelectedId(null);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
  }, []);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await refresh();
      } catch (e) {
        // 先刷新再设错误：refresh 成功路径会清空 error，顺序反了错误会被立即冲掉
        await refresh();
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh]
  );

  const onDrop = useCallback(
    (id: number, to: Status) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
      mutate(() => api.patch(id, { status: to }));
    },
    [mutate]
  );

  const onApprove = useCallback(
    (id: number) => mutate(() => api.patch(id, { status: 'done', note: '验收通过' })),
    [mutate]
  );

  const agentWorking = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && isAgent(t.assignee)).length,
    [tasks]
  );

  const [titleZh, titleEn] = PAGE_TITLES[route] ?? PAGE_TITLES['/'];

  return (
    <div className="app">
      <NavRail route={route} />
      <div className="content">
        <header className="topbar">
          <div className="page-title">
            <b>{titleZh}</b>
            <span>{titleEn}</span>
          </div>
          <div className="topbar-right">
            {agentWorking > 0 && (
              <span className="ai-indicator">
                <span className="dot dot-pulse" />
                AI 工作中 ×{agentWorking}
              </span>
            )}
            <Clock />
            <button className="btn btn-primary" onClick={() => setNewStatus('todo')}>
              ＋ 新建任务
            </button>
          </div>
        </header>

        {error && <div className="error-bar">⚠ {error}</div>}

        {route === '/board' ? (
          <BoardPage
            tasks={tasks}
            activity={activity}
            jump={boardJump}
            onOpenTask={openTask}
            onDrop={onDrop}
            onQuickAdd={(s) => setNewStatus(s)}
          />
        ) : route === '/kb' ? (
          <KnowledgePage
            entries={kb}
            projects={projects.map((p) => p.name)}
            onCreate={(input: KbPatch) => mutate(() => api.createKb(input))}
            onPatch={(id, fields) => mutate(() => api.patchKb(id, fields))}
            onDelete={(id) => mutate(() => api.removeKb(id))}
            onOpenTask={openTask}
          />
        ) : route === '/research' ? (
          <ResearchPage
            list={research}
            projects={projects.map((p) => p.name)}
            mutate={mutate}
            onOpenTask={openTask}
          />
        ) : route === '/projects' ? (
          <ProjectsPage
            projects={projects}
            tasks={tasks}
            onOpenTask={openTask}
            onPatchProject={(name, fields: ProjectPatch) => mutate(() => api.patchProject(name, fields))}
            onCreateProject={(name) => mutate(() => api.createProject(name))}
            onDeleteProject={(name) => mutate(() => api.removeProject(name))}
            onJumpBoard={(project) => {
              setBoardJump((prev) => ({ project, n: prev.n + 1 }));
              location.hash = '#/board';
            }}
          />
        ) : (
          <HomePage tasks={tasks} activity={activity} onOpenTask={openTask} onApprove={onApprove} />
        )}
      </div>

      {detail && (
        <Drawer
          detail={detail}
          allTasks={tasks}
          onClose={closeDrawer}
          onPatch={(fields) => mutate(() => api.patch(detail.id, fields))}
          onComment={(text) => mutate(() => api.comment(detail.id, text))}
          onDelete={() => {
            mutate(() => api.remove(detail.id));
            closeDrawer();
          }}
          onDeps={(body) => mutate(() => api.setDeps(detail.id, body))}
          onOpenTask={openTask}
          onAddAttachments={(files) =>
            mutate(async () => {
              for (const f of files) {
                const { file } = await api.uploadFile(f);
                await api.addAttachment(detail.id, file);
              }
            })
          }
          onPatchAttachment={(id, label) => mutate(() => api.patchAttachment(id, label))}
          onRemoveAttachment={(id) => mutate(() => api.removeAttachment(id))}
        />
      )}

      {newStatus && (
        <NewTaskModal
          presetStatus={newStatus}
          projects={[...new Set([...projects.map((p) => p.name), ...tasks.map((t) => t.project)])].filter(Boolean).sort()}
          tasks={tasks}
          onClose={() => setNewStatus(null)}
          onCreate={(input, files) => {
            setNewStatus(null);
            mutate(async () => {
              const t = await api.create(input);
              for (const f of files) await api.addAttachment(t.id, f);
            });
          }}
        />
      )}
    </div>
  );
}
