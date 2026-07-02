import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, Status, Task } from '../../src/shared/types';
import { isAgent } from '../../src/shared/types';
import { api, type TaskDetail } from './api';
import { Clock } from './components/Clock';
import { Drawer } from './components/Drawer';
import { NavRail } from './components/NavRail';
import { NewTaskModal } from './components/NewTaskModal';
import { BoardPage } from './pages/Board';
import { HomePage } from './pages/Home';

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
};

export default function App() {
  const route = useRoute();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [newStatus, setNewStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([api.tasks(), api.activity()]);
      setTasks(t);
      setActivity(a);
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
        setError(e instanceof Error ? e.message : String(e));
        await refresh();
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
            onOpenTask={openTask}
            onDrop={onDrop}
            onQuickAdd={(s) => setNewStatus(s)}
            onApprove={onApprove}
          />
        ) : (
          <HomePage tasks={tasks} activity={activity} onOpenTask={openTask} onApprove={onApprove} />
        )}
      </div>

      {detail && (
        <Drawer
          detail={detail}
          onClose={closeDrawer}
          onPatch={(fields) => mutate(() => api.patch(detail.id, fields))}
          onComment={(text) => mutate(() => api.comment(detail.id, text))}
          onDelete={() => {
            mutate(() => api.remove(detail.id));
            closeDrawer();
          }}
        />
      )}

      {newStatus && (
        <NewTaskModal
          presetStatus={newStatus}
          projects={[...new Set(tasks.map((t) => t.project).filter(Boolean))].sort()}
          onClose={() => setNewStatus(null)}
          onCreate={(input) => {
            setNewStatus(null);
            mutate(() => api.create(input));
          }}
        />
      )}
    </div>
  );
}
