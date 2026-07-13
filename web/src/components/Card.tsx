import type { Task } from '../../../src/shared/types';
import { blockedIds, isAgent, taskRef } from '../../../src/shared/types';
import { isOverdue } from '../ui';

interface Props {
  task: Task;
  onClick: () => void;
}

export function Card({ task, onClick }: Props) {
  const working = task.status === 'in_progress' && isAgent(task.assignee);
  const overdue = isOverdue(task.due_date) && task.status !== 'done';
  const agentInfo = [task.agent_tool, task.agent_model].filter(Boolean).join(' · ');
  const blocked = task.status !== 'done' ? blockedIds(task) : [];

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
        {blocked.length > 0 && (
          <span className="chip chip-blocked" title={`等待 ${blocked.map(taskRef).join('、')} 完成后才可领取`}>
            🔒{blocked.map(taskRef).join(' ')}
          </span>
        )}
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
    </article>
  );
}
