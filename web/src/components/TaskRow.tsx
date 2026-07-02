import type { ReactNode } from 'react';
import type { Task } from '../../../src/shared/types';
import { isAgent, taskRef } from '../../../src/shared/types';
import { isOverdue } from '../ui';

interface Props {
  task: Task;
  onClick: () => void;
  /** 右侧自定义内容（如验收按钮）；不传则显示负责人/截止 */
  extra?: ReactNode;
  /** 第二行附注（如最新进度） */
  note?: string;
}

/** 首页用的紧凑任务行 */
export function TaskRow({ task, onClick, extra, note }: Props) {
  const overdue = isOverdue(task.due_date) && task.status !== 'done';
  return (
    <div className="trow" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <span className="card-ref">{taskRef(task.id)}</span>
      <span className={`chip chip-${task.priority.toLowerCase()}`}>{task.priority}</span>
      <span className="trow-main">
        <span className="trow-title">{task.title}</span>
        {note && <span className="trow-note">{note}</span>}
      </span>
      <span className="trow-right" onClick={(e) => extra && e.stopPropagation()}>
        {extra ?? (
          <>
            {task.due_date && (
              <span className={`due ${overdue ? 'due-over' : ''}`}>
                {overdue ? '⚠ ' : ''}
                {task.due_date.slice(5)}
              </span>
            )}
            {task.assignee && (
              <span
                className={`badge ${isAgent(task.assignee) ? 'badge-agent' : 'badge-human'}`}
                title={
                  isAgent(task.assignee) && (task.agent_tool || task.agent_model)
                    ? [task.assignee, task.agent_tool, task.agent_model].filter(Boolean).join(' · ')
                    : undefined
                }
              >
                {task.status === 'in_progress' && isAgent(task.assignee) && <span className="dot dot-pulse" />}
                {isAgent(task.assignee) ? `⚙ ${task.assignee}` : '我'}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
