import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, Status, Task } from '../../src/shared/types';
import { STATUSES, isAgent, taskRef } from '../../src/shared/types';
import { api, type TaskDetail } from './api';
import { Column } from './components/Column';
import { Drawer } from './components/Drawer';
import { ActivityRail } from './components/ActivityRail';
import { NewTaskModal } from './components/NewTaskModal';
import { Clock } from './components/Clock';

type AssigneeFilter = 'all' | 'me' | 'agent' | 'none';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [q, setQ] = useState('');
  const [who, setWho] = useState<AssigneeFilter>('all');
  const [project, setProject] = useState('all');
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

  // 打开/切换任务详情
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

  // 变更包装：执行 → 刷新，出错显示
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

  // 拖拽换列：先乐观更新再提交
  const onDrop = useCallback(
    (id: number, to: Status) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
      mutate(() => api.patch(id, { status: to }));
    },
    [mutate]
  );

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.project) set.add(t.project);
    return [...set].sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (project !== 'all' && t.project !== project) return false;
      if (who === 'me' && t.assignee !== 'me') return false;
      if (who === 'agent' && !isAgent(t.assignee)) return false;
      if (who === 'none' && t.assignee !== '') return false;
      if (kw) {
        const hay = `${taskRef(t.id)} ${t.title} ${t.description} ${t.project}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasks, q, who, project]);

  const byStatus = useMemo(() => {
    const map = new Map<Status, Task[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const t of filtered) map.get(t.status)?.push(t);
    // 已完成列按完成时间倒序
    map.get('done')?.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    return map;
  }, [filtered]);

  const agentWorking = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && isAgent(t.assignee)).length,
    [tasks]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
            <path d="M16 5 27 16 16 27 5 16Z" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <circle cx="16" cy="16" r="3.2" fill="currentColor" />
          </svg>
          <span className="brand-name">OPC COCKPIT</span>
          <span className="brand-sub">任务看板 · TASK BOARD</span>
        </div>

        <input
          className="search"
          placeholder="搜索任务…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="seg" role="tablist" aria-label="按负责人过滤">
          {(
            [
              ['all', '全部'],
              ['me', '我'],
              ['agent', 'AI'],
              ['none', '未分配'],
            ] as [AssigneeFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`seg-btn ${who === key ? 'on' : ''}`}
              onClick={() => setWho(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <select className="proj-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">全部项目</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

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

      <div className="main">
        <main className="board">
          {STATUSES.map((s, i) => (
            <Column
              key={s}
              status={s}
              tasks={byStatus.get(s) ?? []}
              index={i}
              onDrop={onDrop}
              onCardClick={openTask}
              onQuickAdd={() => setNewStatus(s)}
              onApprove={(id) => mutate(() => api.patch(id, { status: 'done', note: '验收通过' }))}
            />
          ))}
        </main>
        <ActivityRail items={activity} onSelect={openTask} />
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
          projects={projects}
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
