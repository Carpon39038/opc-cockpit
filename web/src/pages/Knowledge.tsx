import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeEntry, KnowledgeType } from '../../../src/shared/types';
import { KNOWLEDGE_TYPES, KNOWLEDGE_TYPE_LABELS, kbRef, taskRef } from '../../../src/shared/types';
import type { KbPatch } from '../api';
import { Markdown } from '../components/Markdown';
import { actorClass, actorLabel, rel } from '../ui';

/** 收起态摘要：取第一行非空文本，去掉 Markdown 标记 */
function excerpt(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^[#>\-*\s]+/, '').replace(/[*`_]/g, '').trim();
}

interface Props {
  entries: KnowledgeEntry[];
  projects: string[];
  onCreate: (input: KbPatch) => void;
  onPatch: (id: number, fields: KbPatch) => void;
  onDelete: (id: number) => void;
  onOpenTask: (id: number) => void;
}

/** 新建 / 编辑共用的表单 */
function KbForm({
  initial,
  projects,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Partial<KnowledgeEntry>;
  projects: string[];
  submitLabel: string;
  onSubmit: (fields: KbPatch) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [type, setType] = useState<KnowledgeType>(initial.type ?? 'knowledge');
  const [body, setBody] = useState(initial.body ?? '');
  const [tags, setTags] = useState(initial.tags ?? '');
  const [project, setProject] = useState(initial.project ?? '');
  const [url, setUrl] = useState(initial.source_url ?? '');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      type,
      body,
      tags: tags.trim(),
      project: project.trim(),
      source_url: url.trim(),
    });
  };

  return (
    <div className="kb-form">
      <div className="kb-form-row">
        <select value={type} onChange={(e) => setType(e.target.value as KnowledgeType)}>
          {KNOWLEDGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {KNOWLEDGE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          ref={titleRef}
          className="kb-form-title"
          placeholder="一句话说清这条知识…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <textarea
        rows={6}
        placeholder="详情：现象、原因、解法、摘录…（支持 Markdown）"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="kb-form-row">
        <input
          placeholder="标签，逗号分隔"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <input
          list="kb-project-options"
          placeholder="项目（留空 = 通用）"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <datalist id="kb-project-options">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <input placeholder="来源链接" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="kb-form-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function KnowledgePage({ entries, projects, onCreate, onPatch, onDelete, onOpenTask }: Props) {
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<KnowledgeType | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return entries.filter((k) => {
      if (typeFilter !== 'all' && k.type !== typeFilter) return false;
      if (projectFilter === '（通用）' ? k.project !== '' : projectFilter && k.project !== projectFilter) return false;
      if (kw && !`${k.title}\n${k.body}\n${k.tags}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [entries, q, typeFilter, projectFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length, issue: 0, knowledge: 0, pitfall: 0 };
    for (const k of entries) c[k.type] += 1;
    return c;
  }, [entries]);

  const kbProjects = useMemo(
    () => [...new Set([...projects, ...entries.map((k) => k.project)])].filter(Boolean).sort(),
    [projects, entries]
  );

  return (
    <div className="kb-page">
      <div className="toolbar">
        <input
          className="search"
          placeholder="搜索标题 / 正文 / 标签…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg">
          {(['all', ...KNOWLEDGE_TYPES] as const).map((t) => (
            <button
              key={t}
              className={`seg-btn ${typeFilter === t ? 'on' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all' ? '全部' : KNOWLEDGE_TYPE_LABELS[t]} {counts[t] > 0 ? counts[t] : ''}
            </button>
          ))}
        </div>
        <select className="proj-select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">全部项目</option>
          <option value="（通用）">（通用）</option>
          {kbProjects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          ＋ 记一条
        </button>
      </div>

      <div className="kb-list">
        {creating && (
          <section className="kb-card kb-card-open">
            <KbForm
              initial={{ project: projectFilter === '（通用）' ? '' : projectFilter }}
              projects={kbProjects}
              submitLabel="记录"
              onSubmit={(fields) => {
                setCreating(false);
                onCreate(fields);
              }}
              onCancel={() => setCreating(false)}
            />
          </section>
        )}

        {filtered.length === 0 && !creating && (
          <div className="panel-empty kb-empty">
            {entries.length === 0
              ? '知识库还是空的。AI 干活时会用 opc kb add 沉淀问题、知识和坑；你也可以点「＋ 记一条」。'
              : '没有匹配的条目。'}
          </div>
        )}

        {filtered.map((k) => {
          const open = openId === k.id;
          const editing = editingId === k.id;
          return (
            <section
              key={k.id}
              className={`kb-card kb-${k.type} ${open ? 'kb-card-open' : ''}`}
              onClick={() => {
                if (!open) setOpenId(k.id);
              }}
            >
              <header className="kb-head">
                <span className={`chip kb-chip-${k.type}`}>{KNOWLEDGE_TYPE_LABELS[k.type]}</span>
                <span className="card-ref">{kbRef(k.id)}</span>
                <b className="kb-title">{k.title}</b>
                <span className="spacer" />
                {open && !editing && (
                  <>
                    <button
                      className="icon-btn"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(k.id);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`删除 ${kbRef(k.id)}「${k.title}」？`)) onDelete(k.id);
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
                <button
                  className="icon-btn kb-toggle"
                  title={open ? '收起' : '展开'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenId(open ? null : k.id);
                    if (editing) setEditingId(null);
                  }}
                >
                  {open ? '▴' : '▾'}
                </button>
              </header>

              {open ? (
                editing ? (
                  <KbForm
                    initial={k}
                    projects={kbProjects}
                    submitLabel="保存"
                    onSubmit={(fields) => {
                      setEditingId(null);
                      onPatch(k.id, fields);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="kb-detail">
                    {k.body ? (
                      <Markdown className="kb-body">{k.body}</Markdown>
                    ) : (
                      <div className="kb-body kb-body-empty">（没有详情）</div>
                    )}
                    {k.source_url && (
                      <a className="kb-source" href={k.source_url} target="_blank" rel="noreferrer noopener">
                        ↗ {k.source_url}
                      </a>
                    )}
                  </div>
                )
              ) : (
                k.body && <div className="kb-excerpt">{excerpt(k.body)}</div>
              )}

              <footer className="kb-meta">
                {k.tags &&
                  k.tags.split(',').map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                <span className="kb-proj">{k.project || '通用'}</span>
                {k.task_id > 0 && (
                  <button
                    className="kb-task-link"
                    title={k.task_title || ''}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTask(k.task_id);
                    }}
                  >
                    {taskRef(k.task_id)}
                  </button>
                )}
                <span className="spacer" />
                <span className={`kb-actor ${actorClass(k.actor)}`} title={k.creator}>
                  {actorLabel(k.actor)}
                </span>
                <span className="kb-time">{rel(k.updated_at)}</span>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
