import { useState } from 'react';
import type { ProjectStatus, ProjectWithStats, Status } from '../../../src/shared/types';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, STATUSES, STATUS_LABELS } from '../../../src/shared/types';
import type { Task } from '../../../src/shared/types';
import type { ProjectPatch } from '../api';
import { TaskRow } from '../components/TaskRow';
import { rel } from '../ui';

const ACTIVE_LIMIT = 6;

interface Props {
  projects: ProjectWithStats[];
  tasks: Task[];
  onOpenTask: (id: number) => void;
  onPatchProject: (name: string, fields: ProjectPatch) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onJumpBoard: (project: string) => void;
}

/** 自动保存的项目字段：失焦时有变化才提交；updated_at 变化触发重挂载同步外部更新 */
function Field({
  label,
  value,
  version,
  placeholder,
  warn,
  onSave,
}: {
  label: string;
  value: string;
  version: string;
  placeholder: string;
  warn?: boolean;
  onSave: (v: string) => void;
}) {
  return (
    <label className={`pfield ${warn && value ? 'pfield-warn' : ''}`}>
      <span>{label}</span>
      <textarea
        key={version}
        defaultValue={value}
        placeholder={placeholder}
        rows={value ? Math.min(4, value.split('\n').length) : 1}
        onBlur={(e) => {
          if (e.target.value.trim() !== value) onSave(e.target.value.trim());
        }}
      />
    </label>
  );
}

function StatsChips({ p, onJump }: { p: ProjectWithStats; onJump: () => void }) {
  const label: Record<Status, string> = {
    backlog: '待规划',
    todo: '待领取',
    in_progress: '进行中',
    review: '待审核',
    done: '已完成',
  };
  if (p.total === 0) return <div className="pstats pstats-empty">还没有任务</div>;
  return (
    <div className="pstats" role="button" title="在看板中查看" onClick={onJump}>
      {STATUSES.filter((s) => p.by_status[s] > 0).map((s) => (
        <span key={s} className={`pstat pstat-${s}`}>
          {label[s]} {p.by_status[s]}
          {s === 'in_progress' && p.agents_working > 0 && <span className="dot dot-pulse" />}
        </span>
      ))}
    </div>
  );
}

export function ProjectsPage({
  projects,
  tasks,
  onOpenTask,
  onPatchProject,
  onCreateProject,
  onDeleteProject,
  onJumpBoard,
}: Props) {
  const [newName, setNewName] = useState('');

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    onCreateProject(name);
  };

  const activeTasksOf = (name: string) =>
    tasks
      .filter((t) => t.project === name && t.status !== 'done')
      .sort((a, b) => a.priority.localeCompare(b.priority) || b.updated_at.localeCompare(a.updated_at));

  return (
    <div className="projects-page">
      <div className="toolbar">
        <input
          className="search"
          placeholder="新项目名称…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn btn-primary" onClick={create} disabled={!newName.trim()}>
          ＋ 建档项目
        </button>
        <span className="toolbar-hint">登记任务时带 --project 也会自动建档</span>
      </div>

      <div className="projects">
        {projects.length === 0 && (
          <div className="panel-empty projects-empty">还没有项目。建一个，或在任务上填项目名自动建档。</div>
        )}
        {projects.map((p) => {
          const active = activeTasksOf(p.name);
          const shown = active.slice(0, ACTIVE_LIMIT);
          return (
            <section key={p.name} className={`proj-card proj-${p.status}`}>
              <header className="proj-head">
                <span className={`led led-${p.status === 'active' ? 'in_progress' : p.status === 'paused' ? 'review' : 'done'}`} />
                <b className="proj-name">{p.name}</b>
                <select
                  className="proj-status"
                  value={p.status}
                  onChange={(e) => onPatchProject(p.name, { status: e.target.value as ProjectStatus })}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <span className="proj-updated">{p.last_update ? rel(p.last_update) : rel(p.updated_at)}</span>
                {p.total === 0 && (
                  <button
                    className="icon-btn"
                    title="删除项目档案"
                    onClick={() => {
                      if (confirm(`删除项目「${p.name}」档案？（没有关联任务，可安全删除）`)) onDeleteProject(p.name);
                    }}
                  >
                    ✕
                  </button>
                )}
              </header>

              <div className="proj-fields">
                <Field
                  label="目标"
                  value={p.goal}
                  version={`g-${p.updated_at}`}
                  placeholder="这个项目要达成什么？"
                  onSave={(v) => onPatchProject(p.name, { goal: v })}
                />
                <Field
                  label="下一步"
                  value={p.next_step}
                  version={`n-${p.updated_at}`}
                  placeholder="当前最该推进的一件事"
                  onSave={(v) => onPatchProject(p.name, { next_step: v })}
                />
                <Field
                  label="阻塞"
                  value={p.blockers}
                  version={`b-${p.updated_at}`}
                  placeholder="卡在哪里 / 风险（无则留空）"
                  warn
                  onSave={(v) => onPatchProject(p.name, { blockers: v })}
                />
              </div>

              <StatsChips p={p} onJump={() => onJumpBoard(p.name)} />

              {shown.length > 0 && (
                <div className="proj-tasks">
                  {shown.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onClick={() => onOpenTask(t.id)}
                      extra={<span className="trow-status">{STATUS_LABELS[t.status]}</span>}
                    />
                  ))}
                  {active.length > shown.length && (
                    <button className="proj-more" onClick={() => onJumpBoard(p.name)}>
                      还有 {active.length - shown.length} 个未完成任务，在看板中查看 →
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
