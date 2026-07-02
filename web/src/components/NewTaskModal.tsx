import { useEffect, useRef, useState } from 'react';
import type { Status, Task } from '../../../src/shared/types';
import { PRIORITIES, STATUSES, STATUS_LABELS } from '../../../src/shared/types';

interface Props {
  presetStatus: Status;
  projects: string[];
  onClose: () => void;
  onCreate: (input: Partial<Task>) => void;
}

export function NewTaskModal({ presetStatus, projects, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('P2');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState<Status>(presetStatus);
  const [due, setDue] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

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
            placeholder="描述：目标、上下文、验收标准…（写清楚，AI 领取时全靠它）"
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
