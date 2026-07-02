import { useEffect, useState } from 'react';
import type { Status, Task } from '../../../src/shared/types';
import { PRIORITIES, STATUSES, STATUS_LABELS, taskRef } from '../../../src/shared/types';
import type { TaskDetail } from '../api';
import { actionText, actorClass, actorLabel, claimAgentInfo, rel } from '../ui';

interface Props {
  detail: TaskDetail;
  onClose: () => void;
  onPatch: (fields: Partial<Task> & { note?: string }) => void;
  onComment: (text: string) => void;
  onDelete: () => void;
}

export function Drawer({ detail, onClose, onPatch, onComment, onDelete }: Props) {
  const [title, setTitle] = useState(detail.title);
  const [desc, setDesc] = useState(detail.description);
  const [descDirty, setDescDirty] = useState(false);
  const [comment, setComment] = useState('');

  // 切换任务时重置本地编辑状态；轮询更新时仅在未编辑时同步
  useEffect(() => {
    setTitle(detail.title);
    setDescDirty(false);
    setDesc(detail.description);
    setComment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  useEffect(() => {
    if (!descDirty) setDesc(detail.description);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.description]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitComment = () => {
    const text = comment.trim();
    if (!text) return;
    setComment('');
    onComment(text);
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <span className="card-ref">{taskRef(detail.id)}</span>
          <span className={`chip chip-${detail.priority.toLowerCase()}`}>{detail.priority}</span>
          <span className="drawer-status">{STATUS_LABELS[detail.status]}</span>
          <button className="icon-btn drawer-close" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <input
            className="drawer-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim();
              if (t && t !== detail.title) onPatch({ title: t });
              else setTitle(detail.title);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />

          <div className="field-grid">
            <label className="field">
              <span>状态</span>
              <select
                value={detail.status}
                onChange={(e) => onPatch({ status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>优先级</span>
              <select value={detail.priority} onChange={(e) => onPatch({ priority: e.target.value as Task['priority'] })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>负责人</span>
              <input
                list="assignee-options"
                defaultValue={detail.assignee}
                key={`a-${detail.id}-${detail.assignee}`}
                placeholder="未分配"
                onBlur={(e) => {
                  if (e.target.value !== detail.assignee) onPatch({ assignee: e.target.value.trim() });
                }}
              />
              <datalist id="assignee-options">
                <option value="me" />
                <option value="claude" />
              </datalist>
              {(detail.agent_tool || detail.agent_model) && (
                <span className="agent-sub">
                  {[detail.agent_tool, detail.agent_model].filter(Boolean).join(' · ')}
                </span>
              )}
            </label>
            <label className="field">
              <span>项目</span>
              <input
                defaultValue={detail.project}
                key={`p-${detail.id}-${detail.project}`}
                placeholder="无"
                onBlur={(e) => {
                  if (e.target.value !== detail.project) onPatch({ project: e.target.value.trim() });
                }}
              />
            </label>
            <label className="field">
              <span>截止</span>
              <input
                type="date"
                defaultValue={detail.due_date}
                key={`d-${detail.id}-${detail.due_date}`}
                onChange={(e) => onPatch({ due_date: e.target.value })}
              />
            </label>
            <div className="field">
              <span>创建于</span>
              <div className="field-static">{rel(detail.created_at)}</div>
            </div>
          </div>

          {detail.status === 'review' && (
            <div className="review-bar">
              <span>AI 已提交完成，等待你审核</span>
              <button className="btn btn-primary" onClick={() => onPatch({ status: 'done', note: '验收通过' })}>
                ✓ 验收通过
              </button>
              <button
                className="btn"
                onClick={() => onPatch({ status: 'in_progress', note: '打回修改' })}
              >
                ↩ 打回
              </button>
            </div>
          )}

          <div className="drawer-section">
            <div className="section-label">描述</div>
            <textarea
              className="desc-input"
              rows={5}
              placeholder="目标、上下文、验收标准…（AI 领取任务时会读取这里）"
              value={desc}
              onChange={(e) => {
                setDesc(e.target.value);
                setDescDirty(true);
              }}
            />
            {descDirty && desc !== detail.description && (
              <div className="desc-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onPatch({ description: desc });
                    setDescDirty(false);
                  }}
                >
                  保存描述
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setDesc(detail.description);
                    setDescDirty(false);
                  }}
                >
                  取消
                </button>
              </div>
            )}
          </div>

          <div className="drawer-section">
            <div className="section-label">动态 · {detail.activity.length}</div>
            <ol className="timeline">
              {detail.activity.map((a) => (
                <li key={a.id} className="tl-item">
                  <span className={`rail-dot ${actorClass(a.actor)}`} />
                  <div className="tl-body">
                    <div className="tl-line">
                      <b className={actorClass(a.actor)}>{actorLabel(a.actor)}</b> {actionText(a)}
                      <span className="tl-time">{rel(a.created_at)}</span>
                    </div>
                    {(a.content || claimAgentInfo(a)) && (
                      <div className="tl-content">{a.content || claimAgentInfo(a)}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="comment-box">
              <input
                placeholder="添加评论 / 补充说明…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
              />
              <button className="btn" onClick={submitComment} disabled={!comment.trim()}>
                发送
              </button>
            </div>
          </div>

          <div className="drawer-footer">
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirm(`确定删除 ${taskRef(detail.id)}「${detail.title}」？该操作不可恢复。`)) onDelete();
              }}
            >
              删除任务
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
