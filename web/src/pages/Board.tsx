import { useMemo, useState } from 'react';
import type { Activity, Status, Task } from '../../../src/shared/types';
import { STATUSES, isAgent, taskRef } from '../../../src/shared/types';
import { ActivityRail } from '../components/ActivityRail';
import { Column } from '../components/Column';

type AssigneeFilter = 'all' | 'me' | 'agent' | 'none';

interface Props {
  tasks: Task[];
  activity: Activity[];
  onOpenTask: (id: number) => void;
  onDrop: (id: number, to: Status) => void;
  onQuickAdd: (status: Status) => void;
  onApprove: (id: number) => void;
}

export function BoardPage({ tasks, activity, onOpenTask, onDrop, onQuickAdd, onApprove }: Props) {
  const [q, setQ] = useState('');
  const [who, setWho] = useState<AssigneeFilter>('all');
  const [project, setProject] = useState('all');

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
    map.get('done')?.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    return map;
  }, [filtered]);

  return (
    <div className="board-page">
      <div className="toolbar">
        <input className="search" placeholder="搜索任务…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="tablist" aria-label="按负责人过滤">
          {(
            [
              ['all', '全部'],
              ['me', '我'],
              ['agent', 'AI'],
              ['none', '未分配'],
            ] as [AssigneeFilter, string][]
          ).map(([key, label]) => (
            <button key={key} className={`seg-btn ${who === key ? 'on' : ''}`} onClick={() => setWho(key)}>
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
      </div>
      <div className="main">
        <main className="board">
          {STATUSES.map((s) => (
            <Column
              key={s}
              status={s}
              tasks={byStatus.get(s) ?? []}
              onDrop={onDrop}
              onCardClick={onOpenTask}
              onQuickAdd={() => onQuickAdd(s)}
              onApprove={onApprove}
            />
          ))}
        </main>
        <ActivityRail items={activity} onSelect={onOpenTask} />
      </div>
    </div>
  );
}
