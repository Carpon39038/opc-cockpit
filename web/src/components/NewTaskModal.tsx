import { useEffect, useRef, useState } from 'react';
import type { Status, Task } from '../../../src/shared/types';
import { PRIORITIES, STATUSES, STATUS_LABELS, taskRef } from '../../../src/shared/types';

interface Props {
  presetStatus: Status;
  projects: string[];
  /** 未完成任务，用作前置候选 */
  tasks: Task[];
  onClose: () => void;
  onCreate: (input: Partial<Task> & { deps?: number[] }) => void;
}

export function NewTaskModal({ presetStatus, projects, tasks, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('P2');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState<Status>(presetStatus);
  const [due, setDue] = useState('');
  const [deps, setDeps] = useState<number[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  // 前置候选：未完成的任务，当前填的项目排前
  const depCandidates = tasks
    .filter((t) => t.status !== 'done' && !deps.includes(t.id))
    .sort((a, b) => Number(b.project === project.trim()) - Number(a.project === project.trim()) || a.id - b.id);
  const depOf = (id: number) => tasks.find((t) => t.id === id);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: desc,
      priority,
      project: project.trim(),
      status,
      due_date: due,
      deps: deps.length ? deps : undefined,
    });
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal">
        <header className="modal-head">
          <span className="modal-title">新建任务</span>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <input
            ref={titleRef}
            className="modal-title-input"
            placeholder="任务标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <textarea
            rows={4}
            placeholder="描述：目标、上下文、验收标准…（支持 Markdown，写清楚，AI 领取时全靠它）"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div className="field-grid">
            <label className="field">
              <span>状态</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>优先级</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>项目</span>
              <input
                list="project-options"
                placeholder="无"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
              <datalist id="project-options">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>截止</span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>前置任务（全部完成后才可领取，防止并发做出依赖冲突）</span>
            <select
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) setDeps((d) => [...d, id]);
              }}
            >
              <option value="">＋ 添加前置任务…</option>
              {depCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {taskRef(t.id)} {t.project ? `[${t.project}] ` : ''}{t.title}
                </option>
              ))}
            </select>
          </label>
          {deps.length > 0 && (
            <div className="dep-chips">
              {deps.map((id) => (
                <button
                  key={id}
                  className="dep-chip"
                  title="点击移除"
                  onClick={() => setDeps((d) => d.filter((x) => x !== id))}
                >
                  🔒 {taskRef(id)} {depOf(id)?.title.slice(0, 18) ?? ''} ✕
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>
            创建
          </button>
        </footer>
      </div>
    </>
  );
}
