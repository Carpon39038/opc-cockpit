import { useRef, useState } from 'react';
import type { Status, Task } from '../../../src/shared/types';
import { STATUS_LABELS } from '../../../src/shared/types';
import { Card } from './Card';

const SUBLABELS: Record<Status, string> = {
  backlog: 'BACKLOG',
  todo: 'READY',
  in_progress: 'RUNNING',
  review: 'REVIEW',
  done: 'DONE',
};

const DONE_LIMIT = 30;

interface Props {
  status: Status;
  tasks: Task[];
  index: number;
  onDrop: (id: number, to: Status) => void;
  onCardClick: (id: number) => void;
  onQuickAdd: () => void;
  onApprove: (id: number) => void;
}

export function Column({ status, tasks, index, onDrop, onCardClick, onQuickAdd, onApprove }: Props) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const shown = status === 'done' ? tasks.slice(0, DONE_LIMIT) : tasks;

  return (
    <section
      className={`col col-${status} ${over ? 'col-over' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (id) onDrop(id, status);
      }}
    >
      <header className="col-head">
        <span className={`led led-${status}`} />
        <span className="col-name">{STATUS_LABELS[status]}</span>
        <span className="col-sub">{SUBLABELS[status]}</span>
        <span className="col-count">{tasks.length}</span>
        <button className="col-add" title={`新建到「${STATUS_LABELS[status]}」`} onClick={onQuickAdd}>
          ＋
        </button>
      </header>
      <div className="cards">
        {shown.map((t) => (
          <Card
            key={t.id}
            task={t}
            onClick={() => onCardClick(t.id)}
            onApprove={status === 'review' ? () => onApprove(t.id) : undefined}
          />
        ))}
        {tasks.length === 0 && <div className="col-empty">—</div>}
        {tasks.length > shown.length && (
          <div className="col-more">还有 {tasks.length - shown.length} 条更早的已完成任务</div>
        )}
      </div>
    </section>
  );
}
