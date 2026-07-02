import { useMemo, type ReactNode } from 'react';
import type { Activity, Task } from '../../../src/shared/types';
import { isAgent } from '../../../src/shared/types';
import { ActivityList } from '../components/ActivityRail';
import { TaskRow } from '../components/TaskRow';
import { isOverdue, localDate, localToday } from '../ui';

interface Props {
  tasks: Task[];
  activity: Activity[];
  onOpenTask: (id: number) => void;
  onApprove: (id: number) => void;
}

interface Suggestion {
  tone: 'red' | 'amber' | 'green' | 'cyan' | 'dim';
  text: string;
  taskId?: number;
  go?: string;
}

function buildSuggestions(input: {
  review: Task[];
  overdue: Task[];
  queue: Task[];
  backlog: Task[];
  running: Task[];
  agentRunning: Task[];
  total: number;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const { review, overdue, queue, backlog, running, agentRunning, total } = input;
  if (total === 0) {
    return [{ tone: 'green', text: '看板还是空的。从今天最重要的一件事开始，建一个任务。', go: '/board' }];
  }
  if (review.length) {
    out.push({
      tone: 'amber',
      text: `${review.length} 个任务等你验收，验收后 AI 的工作才算落地`,
      taskId: review[0].id,
    });
  }
  if (overdue.length) {
    out.push({ tone: 'red', text: `${overdue.length} 个任务已逾期，处理掉或改期`, taskId: overdue[0].id });
  }
  if (!queue.length && backlog.length) {
    out.push({
      tone: 'cyan',
      text: `待领取队列空了，从待规划（${backlog.length} 个）挑几个放进去，AI 才有活干`,
      go: '/board',
    });
  }
  if (queue.length && !agentRunning.length) {
    out.push({ tone: 'green', text: `队列里有 ${queue.length} 个任务，终端跑 ./opc claim 让 AI 开工` });
  }
  if (running.length > 4) {
    out.push({ tone: 'dim', text: `${running.length} 条战线同时进行，考虑收敛到 2-3 条` });
  }
  if (!out.length) {
    out.push({ tone: 'green', text: '状态良好，专注进行中的任务即可' });
  }
  return out.slice(0, 4);
}

function Panel({
  zh,
  en,
  count,
  tone,
  className,
  children,
}: {
  zh: string;
  en: string;
  count?: number;
  tone?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      <header className="panel-head">
        <span className={`led led-${tone ?? 'backlog'}`} />
        <span className="panel-zh">{zh}</span>
        <span className="panel-en">{en}</span>
        {count !== undefined && <span className="col-count">{count}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export function HomePage({ tasks, activity, onOpenTask, onApprove }: Props) {
  const today = localToday();

  const d = useMemo(() => {
    const review = tasks.filter((t) => t.status === 'review');
    const overdue = tasks.filter((t) => t.status !== 'done' && isOverdue(t.due_date));
    const p0idle = tasks.filter((t) => t.priority === 'P0' && t.status !== 'done' && t.status !== 'in_progress' && t.status !== 'review' && !t.assignee);
    // 待你处理 = 待验收 + 逾期 + 无人认领的 P0（去重，保持优先级顺序）
    const seen = new Set<number>();
    const attend = [...review, ...overdue, ...p0idle].filter((t) => !seen.has(t.id) && seen.add(t.id));
    const running = tasks
      .filter((t) => t.status === 'in_progress')
      .sort((a, b) => (isAgent(a.assignee) ? 1 : 0) - (isAgent(b.assignee) ? 1 : 0));
    const agentRunning = running.filter((t) => isAgent(t.assignee));
    const queue = tasks
      .filter((t) => t.status === 'todo')
      .sort((a, b) => a.priority.localeCompare(b.priority) || a.created_at.localeCompare(b.created_at));
    const backlog = tasks.filter((t) => t.status === 'backlog');
    const doneToday = tasks.filter((t) => t.status === 'done' && t.completed_at && localDate(t.completed_at) === today).length;
    return { review, overdue, attend, running, agentRunning, queue, backlog, doneToday };
  }, [tasks, today]);

  const suggestions = useMemo(
    () =>
      buildSuggestions({
        review: d.review,
        overdue: d.overdue,
        queue: d.queue,
        backlog: d.backlog,
        running: d.running,
        agentRunning: d.agentRunning,
        total: tasks.length,
      }),
    [d, tasks.length]
  );

  // 每个进行中任务的最新一条进度/评论（activity 按时间倒序）
  const lastNote = (taskId: number) =>
    activity.find((a) => a.task_id === taskId && (a.kind === 'progress' || a.kind === 'comment'))?.content;

  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-greet">
          <b>{greeting()}</b>
          <span className="hero-date">
            {String(now.getMonth() + 1).padStart(2, '0')}-{String(now.getDate()).padStart(2, '0')} 周{week}
          </span>
        </div>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-num stat-cyan">{d.running.length}</span>
            <span className="stat-label">进行中</span>
          </div>
          <div className="stat">
            <span className="stat-num stat-amber">{d.review.length}</span>
            <span className="stat-label">待审核</span>
          </div>
          <div className="stat">
            <span className="stat-num stat-green">{d.queue.length}</span>
            <span className="stat-label">待领取</span>
          </div>
          {d.overdue.length > 0 && (
            <div className="stat">
              <span className="stat-num stat-red">{d.overdue.length}</span>
              <span className="stat-label">已逾期</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-num stat-dim">{d.doneToday}</span>
            <span className="stat-label">今日完成</span>
          </div>
        </div>
      </div>

      <Panel zh="待你处理" en="NEEDS YOU" count={d.attend.length} tone={d.attend.length ? 'review' : 'done'} className="area-attend">
        {d.attend.length === 0 && <div className="panel-empty">没有等你处理的事 ✓</div>}
        {d.attend.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onClick={() => onOpenTask(t.id)}
            extra={
              t.status === 'review' ? (
                <button className="btn btn-primary btn-sm" onClick={() => onApprove(t.id)}>
                  ✓ 验收
                </button>
              ) : undefined
            }
            note={t.status === 'review' ? lastNote(t.id) : undefined}
          />
        ))}
      </Panel>

      <Panel zh="下一步建议" en="NEXT ACTIONS" tone="todo" className="area-suggest">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className={`sug sug-${s.tone} ${s.taskId || s.go ? 'sug-click' : ''}`}
            onClick={() => {
              if (s.taskId) onOpenTask(s.taskId);
              else if (s.go) location.hash = `#${s.go}`;
            }}
          >
            <span className="sug-dot" />
            {s.text}
          </div>
        ))}
      </Panel>

      <Panel zh="进行中" en="RUNNING" count={d.running.length} tone="in_progress" className="area-running">
        {d.running.length === 0 && <div className="panel-empty">没有进行中的任务</div>}
        {d.running.map((t) => (
          <TaskRow key={t.id} task={t} onClick={() => onOpenTask(t.id)} note={lastNote(t.id)} />
        ))}
      </Panel>

      <Panel zh="AI 领取队列" en="READY QUEUE" count={d.queue.length} tone="todo" className="area-queue">
        {d.queue.length === 0 && <div className="panel-empty">队列为空 · 从待规划补充任务</div>}
        {d.queue.map((t, i) => (
          <TaskRow key={t.id} task={t} onClick={() => onOpenTask(t.id)} extra={<span className="queue-pos">#{i + 1}</span>} />
        ))}
      </Panel>

      <Panel zh="运行日志" en="ACTIVITY" tone="backlog" className="area-log">
        <ActivityList items={activity} onSelect={onOpenTask} />
      </Panel>
    </div>
  );
}
