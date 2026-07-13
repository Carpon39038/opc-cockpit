import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResearchItem, ResearchStatus, ResearchWithStats } from '../../../src/shared/types';
import { RESEARCH_STATUSES, RESEARCH_STATUS_LABELS, researchRef, taskRef } from '../../../src/shared/types';
import { api, type ResearchDetail, type ResearchItemPatch, type ResearchPatch } from '../api';
import { Markdown } from '../components/Markdown';
import { actorClass, actorLabel, rel } from '../ui';

const fileUrl = (name: string) => `/files/${name}`;

/** 收起态摘要：取第一行非空文本，去掉 Markdown 标记 */
function excerpt(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^[#>\-*\s]+/, '').replace(/[*`_]/g, '').trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 星级：只读展示或点击打分（再点当前星级 = 清除） */
function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  if (!onChange && value <= 0) return null;
  return (
    <span className={`stars ${onChange ? 'stars-edit' : ''}`} title={value ? `${value} 星` : '未评级'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${n <= value ? 'on' : ''}`}
          onClick={
            onChange
              ? (e) => {
                  e.stopPropagation();
                  onChange(n === value ? 0 : n);
                }
              : undefined
          }
        >
          ★
        </span>
      ))}
    </span>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** 新建 / 编辑调研 */
function ResearchForm({
  initial,
  projects,
  title,
  onSubmit,
  onClose,
}: {
  initial: Partial<ResearchDetail>;
  projects: string[];
  title: string;
  onSubmit: (fields: ResearchPatch) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.title ?? '');
  const [question, setQuestion] = useState(initial.question ?? '');
  const [project, setProject] = useState(initial.project ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({ title: name.trim(), question, project: project.trim() });
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal">
        <header className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <input
            ref={nameRef}
            className="modal-title-input"
            placeholder="调研主题，如「绚丽特效塔防游戏参考」"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            rows={5}
            placeholder="研究问题 / 目标 / 要求（支持 Markdown）&#10;如：找 10 个以上特效表现突出的塔防游戏，每个记录链接、截图和爽点"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <input
            list="rs-project-options"
            placeholder="项目（留空 = 通用）"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
          <datalist id="rs-project-options">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            确定
          </button>
        </footer>
      </div>
    </>
  );
}

/** 新建 / 编辑资料卡（支持选择文件或直接粘贴截图） */
function ItemForm({
  item,
  onSubmit,
  onClose,
}: {
  item?: ResearchItem;
  onSubmit: (fields: ResearchItemPatch) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [tags, setTags] = useState(item?.tags ?? '');
  const [rating, setRating] = useState(item?.rating ?? 0);
  const [image, setImage] = useState(item?.image ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => titleRef.current?.focus(), []);

  const upload = async (f: File | Blob) => {
    setUploading(true);
    setUploadError('');
    try {
      const { file } = await api.uploadFile(f);
      setImage(file);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const img = [...e.clipboardData.items].find((it) => it.type.startsWith('image/'));
    const f = img?.getAsFile();
    if (f) {
      e.preventDefault();
      upload(f);
    }
  };

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), url: url.trim(), body, tags: tags.trim(), rating, image });
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal rs-item-modal" onPaste={onPaste}>
        <header className="modal-head">
          <span className="modal-title">{item ? `编辑资料 #${item.id}` : '添加资料'}</span>
          <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <input
            ref={titleRef}
            className="modal-title-input"
            placeholder="标题，如游戏名 / 文章名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input placeholder="来源链接 https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className={`rs-upload ${image ? 'has-img' : ''}`}>
            {image ? (
              <img src={fileUrl(image)} alt="" />
            ) : (
              <span className="rs-upload-hint">{uploading ? '上传中…' : '截图：粘贴到本窗口（⌘V），或'}</span>
            )}
            <div className="rs-upload-actions">
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {image ? '换图' : '选择图片'}
              </button>
              {image && (
                <button className="btn btn-sm" onClick={() => setImage('')}>
                  移除图片
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
          </div>
          {uploadError && <div className="rs-upload-error">⚠ {uploadError}</div>}
          <textarea
            rows={5}
            placeholder="摘要 / 关键摘录 / 爽点分析…（支持 Markdown）"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="rs-form-row">
            <input placeholder="标签，逗号分隔" value={tags} onChange={(e) => setTags(e.target.value)} />
            <span className="rs-rating-field">
              参考价值 <Stars value={rating} onChange={setRating} />
            </span>
          </div>
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || uploading}>
            {item ? '保存' : '添加'}
          </button>
        </footer>
      </div>
    </>
  );
}

/** 资料卡大图 / 全文浮层 */
function ItemLightbox({
  item,
  onRate,
  onEdit,
  onDelete,
  onClose,
}: {
  item: ResearchItem;
  onRate: (n: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal rs-lightbox">
        <header className="modal-head">
          <span className="modal-title">
            <span className="card-ref">#{item.id}</span> {item.title}
          </span>
          <span className="rs-lightbox-actions">
            <button className="btn btn-sm" onClick={onEdit}>
              编辑
            </button>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>
              删除
            </button>
            <button className="icon-btn" onClick={onClose} title="关闭 (Esc)">
              ✕
            </button>
          </span>
        </header>
        <div className="modal-body rs-lightbox-body">
          {item.image && (
            <a href={fileUrl(item.image)} target="_blank" rel="noreferrer noopener" title="新窗口看原图">
              <img className="rs-lightbox-img" src={fileUrl(item.image)} alt={item.title} />
            </a>
          )}
          <div className="rs-lightbox-meta">
            <Stars value={item.rating} onChange={onRate} />
            {item.tags &&
              item.tags.split(',').map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            <span className="spacer" />
            <span className={`kb-actor ${actorClass(item.actor)}`} title={item.creator}>
              {actorLabel(item.actor)}
            </span>
            <span className="kb-time">{rel(item.updated_at)}</span>
          </div>
          {item.url && (
            <a className="kb-source" href={item.url} target="_blank" rel="noreferrer noopener">
              ↗ {item.url}
            </a>
          )}
          {item.body && <Markdown className="rs-lightbox-md">{item.body}</Markdown>}
        </div>
      </div>
    </>
  );
}

/** 资料池里的一张卡 */
function ItemCard({ item, onOpen }: { item: ResearchItem; onOpen: () => void }) {
  const brief = excerpt(item.body);
  return (
    <section className="ri-card" onClick={onOpen}>
      <div className={`ri-thumb ${item.image ? '' : 'ri-thumb-none'}`}>
        {item.image ? (
          <img src={fileUrl(item.image)} alt="" loading="lazy" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M10.5 13.5 13.5 10.5" />
            <path d="M7.5 12.5 5.8 14.2a3.3 3.3 0 0 0 4.7 4.7l1.7-1.7" />
            <path d="M16.5 11.5l1.7-1.7a3.3 3.3 0 0 0-4.7-4.7l-1.7 1.7" />
          </svg>
        )}
        {item.rating > 0 && <span className="ri-thumb-stars">{'★'.repeat(item.rating)}</span>}
      </div>
      <div className="ri-info">
        <div className="ri-title" title={item.title}>
          {item.title}
        </div>
        {brief && <div className="ri-excerpt">{brief}</div>}
        <div className="ri-meta">
          {item.url && <span className="ri-domain">{domainOf(item.url)}</span>}
          {item.tags &&
            item.tags
              .split(',')
              .slice(0, 3)
              .map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
        </div>
      </div>
    </section>
  );
}

interface Props {
  list: ResearchWithStats[];
  projects: string[];
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
  onOpenTask: (id: number) => void;
}

export function ResearchPage({ list, projects, mutate, onOpenTask }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResearchStatus | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [itemForm, setItemForm] = useState<{ item?: ResearchItem } | null>(null);
  const [viewItemId, setViewItemId] = useState<number | null>(null);
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState('');

  // 选中调研后加载详情，并轮询（Agent 正在收集时资料实时冒出来）
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let alive = true;
    let missing = 0;
    const load = () =>
      api
        .researchDetail(selectedId)
        .then((d) => {
          if (alive) {
            setDetail(d);
            missing = 0;
          }
        })
        .catch(() => {
          // 连续两次取不到（被删了）才退回列表，偶发网络错误不弹
          if (alive && ++missing >= 2) setSelectedId(null);
        });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedId]);

  /** 变更 + 刷新（全局列表由 mutate 刷，详情在这里补一刀） */
  const run = (fn: () => Promise<unknown>) =>
    mutate(async () => {
      await fn();
      if (selectedId !== null) setDetail(await api.researchDetail(selectedId));
    });

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return list.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (projectFilter === '（通用）' ? r.project !== '' : projectFilter && r.project !== projectFilter) return false;
      if (kw && !`${r.title}\n${r.question}\n${r.conclusion}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [list, q, statusFilter, projectFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length, collecting: 0, concluded: 0, archived: 0 };
    for (const r of list) c[r.status] += 1;
    return c;
  }, [list]);

  const rsProjects = useMemo(
    () => [...new Set([...projects, ...list.map((r) => r.project)])].filter(Boolean).sort(),
    [projects, list]
  );

  const viewItem = detail?.items.find((i) => i.id === viewItemId) ?? null;

  // ---------------- 详情视图 ----------------
  if (selectedId !== null && detail) {
    const r = detail;
    return (
      <div className="rs-page">
        <div className="toolbar rs-detail-head">
          <button className="btn" onClick={() => setSelectedId(null)}>
            ← 调研
          </button>
          <span className="card-ref">{researchRef(r.id)}</span>
          <b className="rs-detail-title">{r.title}</b>
          <select
            className="proj-select"
            value={r.status}
            onChange={(e) => run(() => api.patchResearch(r.id, { status: e.target.value as ResearchStatus }))}
          >
            {RESEARCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RESEARCH_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <span className="rs-detail-meta">
            {r.project || '通用'}
            {r.task_id > 0 && (
              <button className="kb-task-link" onClick={() => onOpenTask(r.task_id)} title={r.task_title || ''}>
                {taskRef(r.task_id)}
              </button>
            )}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="编辑主题 / 研究问题" onClick={() => setEditingMeta(true)}>
            ✎
          </button>
          <button
            className="icon-btn"
            title="删除调研"
            onClick={() => {
              if (confirm(`删除 ${researchRef(r.id)}「${r.title}」？资料池 ${r.items.length} 条和截图会一并删除。`)) {
                setSelectedId(null);
                mutate(() => api.removeResearch(r.id));
              }
            }}
          >
            ✕
          </button>
        </div>

        <div className="rs-scroll">
          {r.question && (
            <section className="rs-question">
              <div className="rs-sec-label">研究问题</div>
              <Markdown>{r.question}</Markdown>
            </section>
          )}

          <div className="rs-sec-head">
            <span className="rs-sec-label">资料池</span>
            <span className="rs-count">{r.items.length}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setItemForm({})}>
              ＋ 添加资料
            </button>
          </div>

          {r.items.length === 0 ? (
            <div className="panel-empty">
              资料池还是空的。点「＋ 添加资料」，或让 Agent 执行：
              <code className="rs-cmd">
                opc research item {researchRef(r.id)} "标题" --url … --image-url … -d "摘要/爽点"
              </code>
            </div>
          ) : (
            <div className="rs-items">
              {r.items.map((i) => (
                <ItemCard key={i.id} item={i} onOpen={() => setViewItemId(i.id)} />
              ))}
            </div>
          )}

          <div className="rs-sec-head">
            <span className="rs-sec-label">结论</span>
            <span className="spacer" />
            {r.conclusion && r.status !== 'archived' && (
              <button
                className="btn btn-sm"
                title="把结论沉淀为知识库条目，调研转入已归档"
                onClick={() => {
                  if (confirm(`把 ${researchRef(r.id)} 的结论沉淀到知识库并归档？`)) {
                    run(() => api.distillResearch(r.id));
                  }
                }}
              >
                ⇣ 沉淀到知识库
              </button>
            )}
            {!editingConclusion && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setConclusionDraft(r.conclusion);
                  setEditingConclusion(true);
                }}
              >
                {r.conclusion ? '✎ 编辑' : '✎ 写结论'}
              </button>
            )}
          </div>

          <section className="rs-conclusion">
            {editingConclusion ? (
              <div className="rs-conclusion-edit">
                <textarea
                  rows={10}
                  autoFocus
                  placeholder="综合结论 / 总结（支持 Markdown）"
                  value={conclusionDraft}
                  onChange={(e) => setConclusionDraft(e.target.value)}
                />
                <div className="kb-form-actions">
                  <button className="btn" onClick={() => setEditingConclusion(false)}>
                    取消
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setEditingConclusion(false);
                      run(() =>
                        api.patchResearch(r.id, {
                          conclusion: conclusionDraft,
                          // 收集中写完结论自动收口；已归档等状态不动
                          status: r.status === 'collecting' && conclusionDraft.trim() ? 'concluded' : undefined,
                        })
                      );
                    }}
                  >
                    保存结论
                  </button>
                </div>
              </div>
            ) : r.conclusion ? (
              <Markdown>{r.conclusion}</Markdown>
            ) : (
              <div className="rs-conclusion-empty">
                还没有结论。收集完点「✎ 写结论」，或让 Agent 执行 opc research conclude {researchRef(r.id)} -m "总结"
              </div>
            )}
          </section>
        </div>

        {editingMeta && (
          <ResearchForm
            initial={r}
            projects={rsProjects}
            title={`编辑 ${researchRef(r.id)}`}
            onClose={() => setEditingMeta(false)}
            onSubmit={(fields) => {
              setEditingMeta(false);
              run(() => api.patchResearch(r.id, fields));
            }}
          />
        )}

        {itemForm && (
          <ItemForm
            item={itemForm.item}
            onClose={() => setItemForm(null)}
            onSubmit={(fields) => {
              const editing = itemForm.item;
              setItemForm(null);
              run(() =>
                editing ? api.patchResearchItem(editing.id, fields) : api.addResearchItem(r.id, fields)
              );
            }}
          />
        )}

        {viewItem && !itemForm && (
          <ItemLightbox
            item={viewItem}
            onClose={() => setViewItemId(null)}
            onRate={(n) => run(() => api.patchResearchItem(viewItem.id, { rating: n }))}
            onEdit={() => setItemForm({ item: viewItem })}
            onDelete={() => {
              if (confirm(`删除资料 #${viewItem.id}「${viewItem.title}」？`)) {
                setViewItemId(null);
                run(() => api.removeResearchItem(viewItem.id));
              }
            }}
          />
        )}
      </div>
    );
  }

  // ---------------- 列表视图 ----------------
  return (
    <div className="rs-page">
      <div className="toolbar">
        <input className="search" placeholder="搜索主题 / 问题 / 结论…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(['all', ...RESEARCH_STATUSES] as const).map((s) => (
            <button key={s} className={`seg-btn ${statusFilter === s ? 'on' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? '全部' : RESEARCH_STATUS_LABELS[s]} {counts[s] > 0 ? counts[s] : ''}
            </button>
          ))}
        </div>
        <select className="proj-select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">全部项目</option>
          <option value="（通用）">（通用）</option>
          {rsProjects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          ＋ 发起调研
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="panel-empty rs-empty">
          {list.length === 0
            ? '还没有调研。点「＋ 发起调研」提出研究问题，Agent 会用 opc research 收集链接、截图和摘要，最后沉淀结论。'
            : '没有匹配的调研。'}
        </div>
      ) : (
        <div className="rs-grid">
          {filtered.map((r) => (
            <section key={r.id} className="rs-card" onClick={() => setSelectedId(r.id)}>
              <div className={`rs-cover ${r.cover ? '' : 'rs-cover-none'}`}>
                {r.cover ? (
                  <img src={fileUrl(r.cover)} alt="" loading="lazy" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 3h4" />
                    <path d="M10 3v6l-4.6 8.2A2 2 0 0 0 7.2 20h9.6a2 2 0 0 0 1.8-2.8L14 9V3" />
                    <path d="M8 14h8" />
                  </svg>
                )}
                <span className={`chip rs-chip-${r.status}`}>{RESEARCH_STATUS_LABELS[r.status]}</span>
              </div>
              <div className="rs-card-body">
                <div className="rs-card-title">
                  <span className="card-ref">{researchRef(r.id)}</span> {r.title}
                </div>
                {r.question && <div className="rs-card-q">{excerpt(r.question)}</div>}
                <footer className="rs-card-meta">
                  <span className={r.item_count ? 'rs-count' : 'rs-count rs-count-zero'}>{r.item_count} 条资料</span>
                  <span className="kb-proj">{r.project || '通用'}</span>
                  <span className="spacer" />
                  <span className={`kb-actor ${actorClass(r.actor)}`} title={r.creator}>
                    {actorLabel(r.actor)}
                  </span>
                  <span className="kb-time">{rel(r.updated_at)}</span>
                </footer>
              </div>
            </section>
          ))}
        </div>
      )}

      {creating && (
        <ResearchForm
          initial={{ project: projectFilter === '（通用）' ? '' : projectFilter }}
          projects={rsProjects}
          title="发起调研"
          onClose={() => setCreating(false)}
          onSubmit={async (fields) => {
            setCreating(false);
            // 建完直接进详情开始收集
            await mutate(async () => {
              const r = await api.createResearch(fields);
              setSelectedId(r.id);
            });
          }}
        />
      )}
    </div>
  );
}
