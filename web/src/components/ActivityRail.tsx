import type { Activity } from '../../../src/shared/types';
import { taskRef } from '../../../src/shared/types';
import { actionText, actorClass, actorLabel, rel } from '../ui';

interface Props {
  items: Activity[];
  onSelect: (taskId: number) => void;
}

export function ActivityRail({ items, onSelect }: Props) {
  return (
    <aside className="rail">
      <header className="rail-head">
        <span className="rail-title">运行日志</span>
        <span className="rail-sub">ACTIVITY LOG</span>
      </header>
      <div className="rail-list">
        {items.length === 0 && <div className="rail-empty">暂无动态</div>}
        {items.map((a) => (
          <button key={a.id} className="rail-item" onClick={() => onSelect(a.task_id)}>
            <span className={`rail-dot ${actorClass(a.actor)}`} />
            <span className="rail-body">
              <span className="rail-line">
                <b className={actorClass(a.actor)}>{actorLabel(a.actor)}</b> {actionText(a)}{' '}
                <span className="rail-ref">{taskRef(a.task_id)}</span>
              </span>
              {a.content && <span className="rail-content">{a.content}</span>}
              <span className="rail-meta">
                {a.task_title && <span className="rail-task">{a.task_title}</span>}
                <span className="rail-time">{rel(a.created_at)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
