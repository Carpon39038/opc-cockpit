import type { Activity, Status } from '../../src/shared/types';
import { STATUS_LABELS, isAgent } from '../../src/shared/types';

/** 相对时间（中文） */
export function rel(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}天前`;
  return iso.slice(0, 10);
}

export function actorClass(actor: string): string {
  return isAgent(actor) ? 'actor-agent' : 'actor-human';
}

export function actorLabel(actor: string): string {
  return actor === 'me' ? '我' : actor || '—';
}

function safeMeta(a: Activity): Record<string, unknown> {
  try {
    return JSON.parse(a.meta || '{}');
  } catch {
    return {};
  }
}

/** 领取动态里记录的工具/模型（如 claude-code · claude-fable-5） */
export function claimAgentInfo(a: Activity): string {
  if (a.kind !== 'claimed') return '';
  const meta = safeMeta(a);
  return [meta.tool, meta.model].filter(Boolean).join(' · ');
}

/** 动态条目的动作描述 */
export function actionText(a: Activity): string {
  const meta = safeMeta(a);
  switch (a.kind) {
    case 'created':
      return '创建了任务';
    case 'claimed':
      return '领取了任务';
    case 'status': {
      const to = STATUS_LABELS[meta.to as Status] ?? meta.to;
      return `移动到「${to}」`;
    }
    case 'progress':
      return '汇报进度';
    case 'comment':
      return '评论';
    case 'updated': {
      const changed = (meta.changed as string[]) ?? [];
      return `更新了 ${changed.join('、') || '字段'}`;
    }
    case 'completed':
      return meta.to === 'review' ? '提交完成 · 待审核' : '完成了任务';
    default:
      return a.kind;
  }
}

/** ISO 时间戳对应的本地日期 YYYY-MM-DD */
export function localDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地时区的今天 YYYY-MM-DD */
export function localToday(): string {
  return localDate(new Date());
}

export function isOverdue(due: string): boolean {
  if (!due) return false;
  return due < localToday();
}
