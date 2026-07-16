import { useEffect, useRef, useState } from 'react';
import type { DepSummary, Status, Task, TaskAttachment } from '../../../src/shared/types';
import { KNOWLEDGE_TYPE_LABELS, PRIORITIES, STATUSES, STATUS_LABELS, kbRef, taskRef } from '../../../src/shared/types';
import type { TaskDetail } from '../api';
import { actionText, actorClass, actorLabel, attachmentFile, claimAgentInfo, createAgentInfo, fileUrl, rel } from '../ui';
import { Markdown } from './Markdown';

interface Props {
  detail: TaskDetail;
  /** 全部任务，用作前置候选（同项目排前） */
  allTasks: Task[];
  onClose: () => void;
  onPatch: (fields: Partial<Task> & { note?: string }) => void;
  onComment: (text: string) => void;
  onDelete: () => void;
  onDeps: (body: { add?: number[]; remove?: number[] }) => void;
  onOpenTask: (id: number) => void;
  /** 上传并挂载附件图片（完成后外层已刷新 detail） */
  onAddAttachments: (files: (File | Blob)[]) => Promise<void>;
  onPatchAttachment: (id: number, label: string) => void;
  onRemoveAttachment: (id: number) => void;
}

/** 附件大图浮层：看图 + 改说明 + 删除 */
function AttachmentLightbox({
  att,
  onSaveLabel,
  onDelete,
  onClose,
}: {
  att: TaskAttachment;
  onSaveLabel: (label: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(att.label);
  return (
    <>
      <div className="backdrop backdrop-top" onClick={onClose} />
      <div className="modal rs-lightbox att-lightbox">
        <header className="modal-head">
          <span className="modal-title">
            <span className="card-ref">#{att.id}</span>{' '}
            <input
              className="att-label-input"
              placeholder="附件说明，如「首页设计图」…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                if (label.trim() !== att.label) onSaveLabel(label.trim());
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </span>
          <span className="rs-lightbox-actions">
            <button className="btn btn-sm btn-danger" onClick={onDelete}>
              删除
            </button>
            <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
              ✕
            </button>
          </span>
        </header>
        <div className="modal-body rs-lightbox-body">
          <a href={fileUrl(att.file)} target="_blank" rel="noreferrer noopener" title="新窗口看原图">
            <img className="rs-lightbox-img" src={fileUrl(att.file)} alt={att.label || att.file} />
          </a>
          <div className="rs-lightbox-meta">
            <span className={`kb-actor ${actorClass(att.actor)}`} title={att.creator}>
              {actorLabel(att.actor)}
            </span>
            <span className="kb-time">{rel(att.created_at)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

export function Drawer({
  detail,
  allTasks,
  onClose,
  onPatch,
  onComment,
  onDelete,
  onDeps,
  onOpenTask,
  onAddAttachments,
  onPatchAttachment,
  onRemoveAttachment,
}: Props) {
  const [title, setTitle] = useState(detail.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewAttId, setViewAttId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 切换任务时重置本地编辑状态（描述查看态直接渲染 detail，轮询不会打断编辑中的草稿）
  useEffect(() => {
    setTitle(detail.title);
    setEditingDesc(false);
    setComment('');
    setViewAttId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 大图浮层开着时 Esc 先关浮层，再按才关抽屉
      if (viewAttId !== null) setViewAttId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewAttId]);

  const addFiles = async (files: (File | Blob)[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      await onAddAttachments(files);
    } finally {
      setUploading(false);
    }
  };

  // 抽屉内任意位置粘贴截图 = 挂附件
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.items]
      .filter((it) => it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const submitComment = () => {
    const text = comment.trim();
    if (!text) return;
    setComment('');
    onComment(text);
  };

  const unmet = detail.deps.filter((d) => d.status !== 'done');
  // 前置候选：排除自己、已完成、已是前置的；同项目排前
  const depCandidates = allTasks
    .filter((t) => t.id !== detail.id && t.status !== 'done' && !detail.deps.some((d) => d.id === t.id))
    .sort((a, b) => Number(b.project === detail.project) - Number(a.project === detail.project) || a.id - b.id);

  const DepRow = ({ d, removable }: { d: DepSummary; removable?: boolean }) => (
    <div className="dep-row">
      <button className="dep-link" onClick={() => onOpenTask(d.id)} title="查看该任务">
        <span className={`dep-state ${d.status === 'done' ? 'dep-done' : ''}`}>
          {d.status === 'done' ? '✓' : STATUS_LABELS[d.status]}
        </span>
        <span className="card-ref">{taskRef(d.id)}</span>
        <span className="dep-title">{d.title}</span>
      </button>
      {removable && (
        <button className="icon-btn" title="移除前置" onClick={() => onDeps({ remove: [d.id] })}>
          ✕
        </button>
      )}
    </div>
  );

  const viewAtt = detail.attachments.find((a) => a.id === viewAttId) ?? null;

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" onPaste={onPaste}>
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
            <div className="section-label">
              前置依赖
              {unmet.length > 0 && <span className="dep-blocked-hint">🔒 被 {unmet.length} 个未完成任务阻塞</span>}
            </div>
            {detail.deps.length > 0 && (
              <div className="dep-list">
                {detail.deps.map((d) => (
                  <DepRow key={d.id} d={d} removable />
                ))}
              </div>
            )}
            <select
              className="dep-add"
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) onDeps({ add: [id] });
              }}
            >
              <option value="">＋ 添加前置任务（完成后本任务才可领取）…</option>
              {depCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {taskRef(t.id)} {t.project && t.project !== detail.project ? `[${t.project}] ` : ''}{t.title}
                </option>
              ))}
            </select>
            {detail.dependents.length > 0 && (
              <>
                <div className="dep-sub">后续任务（等本任务完成后解锁）</div>
                <div className="dep-list">
                  {detail.dependents.map((d) => (
                    <DepRow key={d.id} d={d} />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="drawer-section">
            <div className="section-label">
              描述
              {!editingDesc && detail.description && (
                <button
                  className="icon-btn section-edit"
                  title="编辑描述"
                  onClick={() => {
                    setDraft(detail.description);
                    setEditingDesc(true);
                  }}
                >
                  ✎ 编辑
                </button>
              )}
            </div>
            {editingDesc ? (
              <>
                <textarea
                  className="desc-input"
                  rows={7}
                  autoFocus
                  placeholder="目标、上下文、验收标准…（支持 Markdown，AI 领取任务时会读取这里）"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="desc-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      onPatch({ description: draft });
                      setEditingDesc(false);
                    }}
                  >
                    保存描述
                  </button>
                  <button className="btn" onClick={() => setEditingDesc(false)}>
                    取消
                  </button>
                </div>
              </>
            ) : detail.description ? (
              <Markdown className="desc-view">{detail.description}</Markdown>
            ) : (
              <button
                className="desc-empty"
                onClick={() => {
                  setDraft('');
                  setEditingDesc(true);
                }}
              >
                点击添加描述…（支持 Markdown）
              </button>
            )}
          </div>

          <div
            className="drawer-section"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => {
              const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
          >
            <div className="section-label">
              附件{detail.attachments.length > 0 && <span className="rs-count">{detail.attachments.length}</span>}
            </div>
            <div className="att-grid">
              {detail.attachments.map((a) => (
                <button key={a.id} className="att-thumb" title={a.label || a.file} onClick={() => setViewAttId(a.id)}>
                  <img src={fileUrl(a.file)} alt={a.label || ''} loading="lazy" />
                  {a.label && <span className="att-thumb-label">{a.label}</span>}
                </button>
              ))}
              <button className="att-add" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '上传中…' : '＋ 图片'}
                <span className="att-add-hint">粘贴 / 拖入 / 选择</span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) addFiles(files);
                e.target.value = '';
              }}
            />
          </div>

          {detail.knowledge.length > 0 && (
            <div className="drawer-section">
              <div className="section-label">沉淀知识 · {detail.knowledge.length}</div>
              <ul className="drawer-kb">
                {detail.knowledge.map((k) => (
                  <li key={k.id}>
                    <button
                      className="drawer-kb-item"
                      title="在知识库中查看"
                      onClick={() => {
                        onClose();
                        location.hash = '#/kb';
                      }}
                    >
                      <span className={`chip kb-chip-${k.type}`}>{KNOWLEDGE_TYPE_LABELS[k.type]}</span>
                      <span className="card-ref">{kbRef(k.id)}</span>
                      <span className="drawer-kb-title">{k.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                    {attachmentFile(a) ? (
                      <a
                        className="tl-att"
                        href={fileUrl(attachmentFile(a))}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={a.content}
                      >
                        <img
                          src={fileUrl(attachmentFile(a))}
                          alt={a.content}
                          loading="lazy"
                          onError={(e) => ((e.target as HTMLImageElement).parentElement!.style.display = 'none')}
                        />
                      </a>
                    ) : a.content ? (
                      <Markdown className="tl-content">{a.content}</Markdown>
                    ) : claimAgentInfo(a) ? (
                      <div className="tl-content tl-plain">{claimAgentInfo(a)}</div>
                    ) : null}
                    {createAgentInfo(a) && (
                      <div className="tl-content tl-plain tl-creator">创建者 · {createAgentInfo(a)}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="comment-box">
              <textarea
                rows={2}
                placeholder="添加评论…（支持 Markdown，⌘/Ctrl+Enter 发送）"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitComment();
                }}
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

      {viewAtt && (
        <AttachmentLightbox
          att={viewAtt}
          onClose={() => setViewAttId(null)}
          onSaveLabel={(label) => onPatchAttachment(viewAtt.id, label)}
          onDelete={() => {
            if (confirm(`删除附件「${viewAtt.label || viewAtt.file}」？`)) {
              setViewAttId(null);
              onRemoveAttachment(viewAtt.id);
            }
          }}
        />
      )}
    </>
  );
}
