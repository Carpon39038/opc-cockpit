import type { Task } from '../../../src/shared/types';
import { isAgent, taskRef } from '../../../src/shared/types';
import { isOverdue } from '../ui';

interface Props {
  task: Task;
  onClick: () => void;
  onApprove?: () => void;
}

export function Card({ task, onClick, onApprove }: Props) {
  const working = task.status === 'in_progress' && isAgent(task.assignee);
  const overdue = isOverdue(task.due_date) && task.status !== 'done';
  const agentInfo = [task.agent_tool, task.agent_model].filter(Boolean).join(' · ');

  return (
    <article
      className={`card prio-${task.priority.toLowerCase()} ${task.status === 'done' ? 'card-done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(task.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onClick}
    >
      <div className="card-top">
        <span className="card-ref">{taskRef(task.id)}</span>
        <span className={`chip chip-${task.priority.toLowerCase()}`}>{task.priority}</span>
      </div>
      <h3 className="card-title">{task.title}</h3>
      <div className="card-meta">
        {task.project && <span className="tag">{task.project}</span>}
        {task.due_date && (
          <span className={`due ${overdue ? 'due-over' : ''}`}>
            {overdue ? '⚠ ' : ''}
            {task.due_date.slice(5)}
          </span>
        )}
        <span className="spacer" />
        {task.assignee && (
          <span
            className={`badge ${isAgent(task.assignee) ? 'badge-agent' : 'badge-human'}`}
            title={isAgent(task.assignee) && agentInfo ? `${task.assignee} · ${agentInfo}` : undefined}
          >
            {working && <span className="dot dot-pulse" />}
            {isAgent(task.assignee) ? `⚙ ${task.assignee}` : '我'}
          </span>
        )}
      </div>
      {task.status === 'review' && onApprove && (
        <button
          className="approve-btn"
          title="验收通过 → 已完成"
          onClick={(e) => {
            e.stopPropagation();
            onApprove();
          }}
        >
          ✓ 验收
        </button>
      )}
    </article>
  );
}
