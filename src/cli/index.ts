import '../shared/quiet';
import { execSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { Command } from 'commander';
import {
  Activity,
  DepSummary,
  HUMAN_ACTOR,
  KNOWLEDGE_TYPE_ALIASES,
  KNOWLEDGE_TYPE_LABELS,
  KNOWLEDGE_TYPES,
  KnowledgeEntry,
  KnowledgeType,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  ProjectWithStats,
  RESEARCH_STATUS_ALIASES,
  RESEARCH_STATUS_LABELS,
  RESEARCH_STATUSES,
  Research,
  ResearchItem,
  ResearchStatus,
  ResearchWithStats,
  STATUS_ALIASES,
  STATUS_LABELS,
  STATUSES,
  Status,
  Task,
  TaskAttachment,
  blockedIds,
  kbRef,
  parseKbRef,
  parseRef,
  parseResearchRef,
  researchRef,
  taskRef,
} from '../shared/types';
import {
  StoreError,
  TaskWithUnlocked,
  addDeps,
  addNote,
  addResearchItem,
  addTaskAttachment,
  claimTask,
  completeTask,
  createKnowledge,
  createResearch,
  createTask,
  deleteKnowledge,
  deleteResearch,
  deleteResearchItem,
  deleteTaskAttachment,
  distillResearch,
  getDependents,
  getDeps,
  getKnowledge,
  getProject,
  getResearchDetail,
  getResearchItem,
  getTask,
  getTaskActivity,
  getTaskAttachment,
  getTaskAttachments,
  listKnowledge,
  listProjectsWithStats,
  listResearch,
  listTasks,
  moveTask,
  peekNext,
  relatedKnowledge,
  removeDeps,
  unmetDeps,
  updateKnowledge,
  updateProject,
  updateResearch,
  updateResearchItem,
  updateTask,
} from '../shared/store';
import { fetchImageToFile, importLocalImage } from '../shared/files';
import { dbPath } from '../shared/db';

const program = new Command();

program
  .name('opc')
  .description('OPC Cockpit 任务看板 CLI —— 供用户和 AI Agent 领取任务、反馈进度、操作状态')
  .option('--as <actor>', '以哪个身份操作（默认: 人=me，Claude Code 会话=claude）')
  .option('--json', '以 JSON 输出结果');

interface GlobalOpts {
  as?: string;
  json?: boolean;
}

function actor(): string {
  const opts = program.opts<GlobalOpts>();
  if (opts.as) return opts.as;
  if (process.env.OPC_ACTOR) return process.env.OPC_ACTOR;
  // 识别到 agent 工具时用对应的 agent 身份，而不是回落到「人」
  const agent = detectAgentActor();
  if (agent) return agent;
  return HUMAN_ACTOR;
}

/**
 * 从检测到的工具推导 agent 身份名（claude-code → claude，gemini-cli → gemini）。
 * 没识别到 agent 工具则返回空。与 detectTool() 共用同一套环境判断，保持一致。
 */
function detectAgentActor(): string {
  const tool = detectTool();
  if (!tool) return '';
  if (tool === 'claude-code') return 'claude';
  return tool.replace(/-cli$/, ''); // codex / cursor / gemini / aider
}

/** 自动识别当前运行环境的工具名 */
function detectTool(): string {
  const env = process.env;
  if (env.OPC_TOOL) return env.OPC_TOOL;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (env.CURSOR_TRACE_ID || env.CURSOR_AGENT) return 'cursor';
  if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID) return 'codex';
  if (env.GEMINI_CLI) return 'gemini-cli';
  if (env.AIDER_MODEL) return 'aider';
  return '';
}

/**
 * 模型名兜底检测。注意 ANTHROPIC_MODEL 可能是 shell 全局配置，
 * 不一定等于当前会话真实模型 —— Agent 应显式传 --model。
 */
function detectModel(): string {
  return process.env.OPC_MODEL || process.env.ANTHROPIC_MODEL || '';
}

/**
 * 从当前 git 仓库自动识别项目名（worktree 会解析到主仓库名）。
 * 不在 git 仓库里则返回空。
 */
function detectProject(): string {
  if (process.env.OPC_PROJECT) return process.env.OPC_PROJECT;
  try {
    const out = execSync('git rev-parse --git-common-dir', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return basename(dirname(resolve(process.cwd(), out)));
  } catch {
    return '';
  }
}

function jsonMode(): boolean {
  return Boolean(program.opts<GlobalOpts>().json);
}

function out(data: unknown, human: () => void) {
  if (jsonMode()) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    human();
  }
}

function resolveStatus(input: string): Status {
  const s = STATUS_ALIASES[input.toLowerCase()];
  if (!s) {
    throw new StoreError(`无效状态: ${input}（可选: ${STATUSES.join(', ')}）`);
  }
  return s;
}

function fmtLine(t: Task): string {
  const parts = [
    taskRef(t.id).padEnd(6),
    `[${t.priority}]`,
    t.title,
  ];
  const extras: string[] = [];
  if (t.project) extras.push(`proj:${t.project}`);
  if (t.assignee) extras.push(`@${t.assignee}`);
  if (t.due_date) extras.push(`due:${t.due_date}`);
  const blocked = blockedIds(t);
  if (blocked.length) extras.push(`⛔等${blocked.map(taskRef).join(',')}`);
  if (extras.length) parts.push(`(${extras.join(' ')})`);
  return parts.join(' ');
}

/** 解析逗号/空格分隔的任务编号列表（如 "T-1,T-2"） */
function parseRefList(refs: string): number[] {
  return refs
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map(parseRef);
}

function fmtDep(d: DepSummary): string {
  const mark = d.status === 'done' ? '✓' : '·';
  return `${mark} ${taskRef(d.id).padEnd(6)} [${STATUS_LABELS[d.status]}] ${d.title}`;
}

function printUnlocked(t: TaskWithUnlocked) {
  if (t.unlocked?.length) {
    console.log(`  🔓 解锁了后续任务: ${t.unlocked.map((d) => `${taskRef(d.id)} ${d.title}`).join('、')}`);
  }
}

function fmtActivity(a: Activity): string {
  const time = a.created_at.replace('T', ' ').slice(0, 16);
  const meta = a.meta ? safeParse(a.meta) : {};
  let action: string;
  switch (a.kind) {
    case 'created':
      action = '创建了任务';
      break;
    case 'claimed':
      action = '领取了任务';
      break;
    case 'status':
      action = `状态 ${fmtStatusChange(meta)}`;
      break;
    case 'progress':
      action = '进度';
      break;
    case 'comment':
      action = '评论';
      break;
    case 'updated':
      action = `更新了 ${(meta.changed as string[])?.join(', ') || '字段'}`;
      break;
    case 'completed':
      action = meta.to === 'review' ? '提交完成，等待审核' : '完成了任务';
      break;
    case 'knowledge':
      action = '沉淀了知识';
      break;
    case 'research':
      action = '调研';
      break;
    case 'dep':
      action = '调整前置';
      break;
    case 'attachment':
      action = '挂了附件';
      break;
    default:
      action = a.kind;
  }
  const content = a.content ? `: ${a.content}` : '';
  return `  ${time}  ${a.actor}  ${action}${content}`;
}

function fmtStatusChange(meta: Record<string, unknown>): string {
  const from = STATUS_LABELS[meta.from as Status] ?? meta.from;
  const to = STATUS_LABELS[meta.to as Status] ?? meta.to;
  return `${from} → ${to}`;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function fmtAttachment(a: TaskAttachment): string {
  const who = a.actor ? ` · ${a.actor}` : '';
  return `#${a.id} ${a.label ? `${a.label}（${a.file}）` : a.file}${who}`;
}

function printDetail(t: Task, activity: Activity[], kb: KnowledgeEntry[] = [], deps: DepSummary[] = [], dependents: DepSummary[] = [], attachments: TaskAttachment[] = []) {
  console.log(`${taskRef(t.id)} [${t.priority}] ${t.title}`);
  const agentInfo = [t.agent_tool, t.agent_model].filter(Boolean).join(' · ');
  const who = t.assignee ? `${t.assignee}${agentInfo ? `（${agentInfo}）` : ''}` : '未分配';
  console.log(`状态: ${STATUS_LABELS[t.status]}  负责: ${who}${t.project ? `  项目: ${t.project}` : ''}${t.due_date ? `  截止: ${t.due_date}` : ''}`);
  if (t.creator) console.log(`创建: ${t.creator}`);
  if (t.description) {
    console.log('---');
    console.log(t.description);
  }
  if (attachments.length) {
    console.log(`--- 附件（${attachments.length} 张，看板任务详情可预览）---`);
    for (const a of attachments) console.log('  ' + fmtAttachment(a));
  }
  if (deps.length) {
    const unmet = deps.filter((d) => d.status !== 'done');
    console.log(`--- 前置任务（${unmet.length ? `${unmet.length} 个未完成，本任务被阻塞` : '已全部完成'}）---`);
    for (const d of deps) console.log('  ' + fmtDep(d));
  }
  if (dependents.length) {
    console.log('--- 后续任务（等本任务完成后解锁）---');
    for (const d of dependents) console.log('  ' + fmtDep(d));
  }
  if (activity.length) {
    console.log('--- 动态 ---');
    for (const a of activity) console.log(fmtActivity(a));
  }
  if (kb.length) {
    console.log(`--- 相关知识（${t.project ? `项目 ${t.project} + 通用` : '通用'}，最近 ${kb.length} 条）---`);
    for (const k of kb) console.log('  ' + fmtKbLine(k));
    console.log(`  （opc kb show K-x 看详情，opc kb search <词> 搜更多）`);
  }
}

function resolveKbType(input: string): KnowledgeType {
  const t = KNOWLEDGE_TYPE_ALIASES[input.toLowerCase()];
  if (!t) {
    throw new StoreError(`无效知识类型: ${input}（可选: ${KNOWLEDGE_TYPES.join(', ')}）`);
  }
  return t;
}

function fmtKbLine(k: KnowledgeEntry): string {
  const extras: string[] = [k.project ? `proj:${k.project}` : '通用'];
  if (k.tags) extras.push('#' + k.tags.split(',').join(' #'));
  if (k.task_id) extras.push(taskRef(k.task_id));
  return `${kbRef(k.id).padEnd(6)} [${KNOWLEDGE_TYPE_LABELS[k.type]}] ${k.title} (${extras.join(' ')})`;
}

function printKbDetail(k: KnowledgeEntry) {
  console.log(`${kbRef(k.id)} [${KNOWLEDGE_TYPE_LABELS[k.type]}] ${k.title}`);
  const meta: string[] = [k.project ? `项目: ${k.project}` : '项目: （通用）'];
  if (k.tags) meta.push(`标签: ${k.tags.split(',').join(', ')}`);
  if (k.task_id) meta.push(`关联: ${taskRef(k.task_id)}${k.task_title ? ` ${k.task_title}` : ''}`);
  console.log(meta.join('  '));
  if (k.source_url) console.log(`来源: ${k.source_url}`);
  const who = k.actor ? `${k.actor}${k.creator ? `（${k.creator}）` : ''}` : k.creator || '—';
  console.log(`记录: ${who} · ${k.created_at.slice(0, 10)}${k.updated_at !== k.created_at ? `（更新于 ${k.updated_at.slice(0, 10)}）` : ''}`);
  if (k.body) {
    console.log('---');
    console.log(k.body);
  }
}

program
  .command('list')
  .alias('ls')
  .description('列出任务（默认不含已完成）')
  .option('-s, --status <status>', '按状态过滤（backlog/todo/in_progress/review/done/all）')
  .option('--project <project>', '按项目过滤')
  .option('--assignee <assignee>', '按负责人过滤（me/claude/none/agent）')
  .option('-q, --query <q>', '搜索标题和描述')
  .action((opts: { status?: string; project?: string; assignee?: string; query?: string }) => {
    const status = opts.status ? (opts.status === 'all' ? 'all' : resolveStatus(opts.status)) : undefined;
    let tasks = listTasks({
      status,
      project: opts.project,
      assignee: opts.assignee,
      q: opts.query,
    });
    if (!opts.status) tasks = tasks.filter((t) => t.status !== 'done');
    out(tasks, () => {
      if (!tasks.length) {
        console.log('（没有匹配的任务）');
        return;
      }
      for (const s of STATUSES) {
        const group = tasks.filter((t) => t.status === s);
        if (!group.length) continue;
        console.log(`\n## ${STATUS_LABELS[s]} (${group.length})`);
        for (const t of group) console.log('  ' + fmtLine(t));
      }
    });
  });

program
  .command('next')
  .description('查看下一个可领取的任务（不领取）')
  .action(() => {
    const t = peekNext();
    out(t, () => {
      if (!t) console.log('当前没有可领取的任务');
      else {
        console.log('下一个可领取:');
        console.log('  ' + fmtLine(t));
        if (t.description) console.log('  ' + t.description.split('\n')[0]);
      }
    });
  });

program
  .command('show <ref>')
  .description('查看任务详情和全部动态（领任务前先看上下文）')
  .action((ref: string) => {
    const id = parseRef(ref);
    const t = getTask(id);
    const activity = getTaskActivity(id);
    const kb = relatedKnowledge(t.project);
    const deps = getDeps(id);
    const dependents = getDependents(id);
    const attachments = getTaskAttachments(id);
    out({ ...t, deps, dependents, activity, related_knowledge: kb, attachments }, () =>
      printDetail(t, activity, kb, deps, dependents, attachments)
    );
  });

program
  .command('add <title>')
  .description('创建任务')
  .option('-d, --desc <desc>', '任务描述（目标、上下文、验收标准）')
  .option('-p, --priority <priority>', '优先级 P0-P3', 'P2')
  .option('--project <project>', '所属项目')
  .option('-s, --status <status>', '初始状态', 'todo')
  .option('--due <date>', '截止日期 YYYY-MM-DD')
  .option('--after <refs>', '前置任务（逗号分隔，如 T-1,T-2），全部完成后本任务才可领取')
  .option('--tool <tool>', '创建者工具名（默认自动识别，如 claude-code）')
  .option('--model <model>', '创建者模型 ID（AI 创建时传自己的模型，如 claude-fable-5）')
  .action((title: string, opts: { desc?: string; priority: string; project?: string; status: string; due?: string; after?: string; tool?: string; model?: string }) => {
    const autoProject = opts.project === undefined ? detectProject() : '';
    const tool = opts.tool ?? detectTool();
    const model = opts.model ?? '';
    // 模型优先、工具其次：AI 显式传 --model 时以模型为主，工具名补充
    const creator = [model, tool].filter(Boolean).join(' · ');
    const t = createTask(
      {
        title,
        description: opts.desc,
        priority: opts.priority.toUpperCase(),
        project: opts.project ?? autoProject,
        status: resolveStatus(opts.status),
        due_date: opts.due,
        creator,
        deps: opts.after ? parseRefList(opts.after) : undefined,
      },
      actor()
    );
    out(t, () => {
      console.log(`✓ 已创建 ${fmtLine(t)} → ${STATUS_LABELS[t.status]}`);
      const blocked = blockedIds(t);
      if (blocked.length) console.log(`  前置: ${blocked.map(taskRef).join('、')} 完成后才可领取`);
      if (autoProject) console.log(`  （项目 ${autoProject} 自动识别自 git 仓库，--project 可覆盖）`);
    });
  });

program
  .command('claim [ref]')
  .description('领取任务并开始（不带编号 = 自动领取优先级最高的待领取任务）')
  .option('--tool <tool>', '工具名（默认自动识别，如 claude-code）')
  .option('--model <model>', '模型名（Agent 必须显式传自己的模型 ID，如 claude-fable-5）')
  .action((ref: string | undefined, opts: { tool?: string; model?: string }) => {
    const id = ref ? parseRef(ref) : null;
    const tool = opts.tool ?? detectTool();
    const model = opts.model ?? detectModel();
    // 自动领取时优先当前项目（忽略大小写），本项目无可领则全局兜底
    const preferProject = id === null ? detectProject() : '';
    const t = claimTask(id, actor(), { tool, model }, preferProject);
    const activity = getTaskActivity(t.id);
    const kb = relatedKnowledge(t.project);
    const deps = getDeps(t.id);
    const dependents = getDependents(t.id);
    const attachments = getTaskAttachments(t.id);
    out({ ...t, deps, dependents, activity, related_knowledge: kb, attachments }, () => {
      const info = [tool, model].filter(Boolean).join(' · ');
      const crossProject =
        preferProject && t.project && t.project.toLowerCase() !== preferProject.toLowerCase();
      console.log(`✓ ${actor()}${info ? `（${info}）` : ''} 已领取 ${taskRef(t.id)}，状态 → ${STATUS_LABELS[t.status]}`);
      if (crossProject) {
        console.log(`  （当前项目 ${preferProject} 无可领任务，已跨项目领取 ${t.project}）`);
      }
      console.log('');
      printDetail(t, activity, kb, deps, dependents, attachments);
    });
  });

program
  .command('progress <ref> <message>')
  .description('反馈任务进度（追加一条进度记录）')
  .action((ref: string, message: string) => {
    const t = addNote(parseRef(ref), actor(), message, 'progress');
    out(t, () => console.log(`✓ ${taskRef(t.id)} 进度已记录: ${message}`));
  });

program
  .command('comment <ref> <message>')
  .description('添加评论')
  .action((ref: string, message: string) => {
    const t = addNote(parseRef(ref), actor(), message, 'comment');
    out(t, () => console.log(`✓ ${taskRef(t.id)} 评论已添加`));
  });

program
  .command('move <ref> <status>')
  .description('移动任务状态（移回 todo/backlog 会释放认领）')
  .option('-m, --message <message>', '附加说明')
  .action((ref: string, status: string, opts: { message?: string }) => {
    const t = moveTask(parseRef(ref), resolveStatus(status), actor(), opts.message || '');
    out(t, () => {
      console.log(`✓ ${taskRef(t.id)} → ${STATUS_LABELS[t.status]}`);
      printUnlocked(t);
    });
  });

program
  .command('done <ref>')
  .description('完成任务（Agent 默认进入待审核，人直接完成）')
  .option('-m, --message <message>', '完成说明/交付摘要')
  .option('--skip-review', 'Agent 跳过审核直接完成')
  .action((ref: string, opts: { message?: string; skipReview?: boolean }) => {
    const t = completeTask(parseRef(ref), actor(), opts.message || '', Boolean(opts.skipReview));
    out(t, () => {
      const hint = t.status === 'review' ? '（等待用户在看板上审核确认）' : '';
      console.log(`✓ ${taskRef(t.id)} → ${STATUS_LABELS[t.status]} ${hint}`);
      printUnlocked(t);
      console.log(`  这次有踩坑/搜到关键资料/值得复用的经验？opc kb add "标题" -d "细节" --type pitfall --task ${taskRef(t.id)} 沉淀下来`);
    });
  });

program
  .command('edit <ref>')
  .description('编辑任务字段')
  .option('--title <title>', '标题')
  .option('-d, --desc <desc>', '描述')
  .option('-p, --priority <priority>', '优先级 P0-P3')
  .option('--project <project>', '项目')
  .option('--due <date>', '截止日期 YYYY-MM-DD')
  .option('--assignee <assignee>', '负责人')
  .action((ref: string, opts: { title?: string; desc?: string; priority?: string; project?: string; due?: string; assignee?: string }) => {
    const t = updateTask(
      parseRef(ref),
      {
        title: opts.title,
        description: opts.desc,
        priority: opts.priority?.toUpperCase(),
        project: opts.project,
        due_date: opts.due,
        assignee: opts.assignee,
      },
      actor()
    );
    out(t, () => console.log(`✓ 已更新 ${fmtLine(t)}`));
  });

program
  .command('dep <ref>')
  .description('查看/管理前置依赖：不带选项查看，--on 添加，--rm 移除')
  .option('--on <refs>', '添加前置任务，逗号分隔，如 T-1,T-2')
  .option('--rm <refs>', '移除前置任务，逗号分隔')
  .action((ref: string, opts: { on?: string; rm?: string }) => {
    const id = parseRef(ref);
    let t = getTask(id);
    if (opts.on) t = addDeps(id, parseRefList(opts.on), actor());
    if (opts.rm) t = removeDeps(id, parseRefList(opts.rm), actor());
    const deps = getDeps(id);
    const dependents = getDependents(id);
    const blocked = unmetDeps(id).length > 0;
    out({ ...t, deps, dependents, blocked }, () => {
      if (opts.on || opts.rm) console.log(`✓ 已更新 ${taskRef(id)} 的前置依赖\n`);
      console.log(`${taskRef(t.id)} [${STATUS_LABELS[t.status]}] ${t.title}`);
      if (!deps.length && !dependents.length) {
        console.log('（没有依赖关系；opc dep ' + taskRef(id) + ' --on T-x 添加前置）');
        return;
      }
      if (deps.length) {
        console.log(`前置任务${blocked ? '（有未完成，本任务被阻塞）' : '（已全部完成）'}:`);
        for (const d of deps) console.log('  ' + fmtDep(d));
      }
      if (dependents.length) {
        console.log('后续任务（等本任务完成后解锁）:');
        for (const d of dependents) console.log('  ' + fmtDep(d));
      }
    });
  });

program
  .command('attach <ref> [image]')
  .description('给任务挂附件图片（设计图/预览图/截图）：带本地文件路径或 --url 挂载，不带参数列出，--rm 删除')
  .option('--url <url>', '网络图片（下载进附件目录）')
  .option('--label <label>', '说明，如「首页设计图」')
  .option('--rm <id>', '删除附件（编号见列表，如 5）')
  .option('--tool <tool>', '上传者工具名（默认自动识别）')
  .option('--model <model>', '上传者模型 ID（AI 上传时传自己的模型，如 claude-fable-5）')
  .action(async (ref: string, image: string | undefined, opts: { url?: string; label?: string; rm?: string; tool?: string; model?: string }) => {
    const taskId = parseRef(ref);
    if (opts.rm) {
      const rmId = Number(opts.rm.replace(/^#/, ''));
      const att = getTaskAttachment(rmId);
      if (att.task_id !== taskId) throw new StoreError(`附件 #${rmId} 不属于 ${taskRef(taskId)}`);
      deleteTaskAttachment(rmId);
      out({ ok: true, id: rmId }, () => console.log(`✓ 已删除 ${taskRef(taskId)} 的附件 #${rmId}「${att.label || att.file}」`));
      return;
    }
    if (!image && !opts.url) {
      // 不带参数 = 列出附件
      const t = getTask(taskId);
      const attachments = getTaskAttachments(taskId);
      out(attachments, () => {
        console.log(`${taskRef(t.id)}「${t.title}」的附件（${attachments.length} 张）:`);
        if (!attachments.length) console.log(`  （无，opc attach ${taskRef(t.id)} <图片路径> 或 --url <链接> 挂载）`);
        for (const a of attachments) console.log('  ' + fmtAttachment(a));
      });
      return;
    }
    const file = image ? importLocalImage(image) : await fetchImageToFile(opts.url!);
    const tool = opts.tool ?? detectTool();
    const creator = [opts.model ?? '', tool].filter(Boolean).join(' · ');
    const att = addTaskAttachment(taskId, { file, label: opts.label, creator }, actor());
    out(att, () => console.log(`✓ ${taskRef(taskId)} 附件 +1: ${fmtAttachment(att)}`));
  });

function fmtProjectStats(p: ProjectWithStats): string {
  const parts: string[] = [];
  const label: Record<Status, string> = {
    backlog: '规划',
    todo: '待领',
    in_progress: '进行',
    review: '待审',
    done: '完成',
  };
  for (const s of STATUSES) {
    if (p.by_status[s] > 0) parts.push(`${label[s]}${p.by_status[s]}`);
  }
  const agents = p.agents_working > 0 ? ` ⚙${p.agents_working}` : '';
  return parts.length ? parts.join(' ') + agents : '无任务';
}

program
  .command('projects')
  .description('项目列表（含任务统计，推进中在前）')
  .action(() => {
    const projects = listProjectsWithStats();
    out(projects, () => {
      if (!projects.length) {
        console.log('（还没有项目，登记任务时带 --project 会自动建档）');
        return;
      }
      for (const status of PROJECT_STATUSES) {
        const group = projects.filter((p) => p.status === status);
        if (!group.length) continue;
        console.log(`\n## ${PROJECT_STATUS_LABELS[status]} (${group.length})`);
        for (const p of group) {
          console.log(`  ${p.name.padEnd(16)} ${fmtProjectStats(p)}`);
          if (p.next_step) console.log(`  ${''.padEnd(16)} 下一步: ${p.next_step.split('\n')[0]}`);
        }
      }
    });
  });

program
  .command('project <name>')
  .description('查看项目详情；带选项则更新（目标/下一步/阻塞/状态）')
  .option('--goal <goal>', '目标')
  .option('--next <next>', '下一步')
  .option('--blockers <blockers>', '阻塞与风险（清空传空串）')
  .option('--status <status>', '状态 active/paused/done')
  .action((name: string, opts: { goal?: string; next?: string; blockers?: string; status?: string }) => {
    const hasUpdate =
      opts.goal !== undefined || opts.next !== undefined || opts.blockers !== undefined || opts.status !== undefined;
    const p = hasUpdate
      ? updateProject(name, { goal: opts.goal, next_step: opts.next, blockers: opts.blockers, status: opts.status })
      : getProject(name);
    out(p, () => {
      if (hasUpdate) console.log(`✓ 项目「${p.name}」已更新\n`);
      console.log(`${p.name} [${PROJECT_STATUS_LABELS[p.status]}]`);
      if (p.goal) console.log(`目标: ${p.goal}`);
      if (p.next_step) console.log(`下一步: ${p.next_step}`);
      if (p.blockers) console.log(`阻塞: ${p.blockers}`);
      const active = p.tasks.filter((t) => t.status !== 'done');
      const done = p.tasks.length - active.length;
      console.log(`任务: ${active.length} 个进行 + ${done} 个完成`);
      for (const t of active) console.log('  ' + fmtLine(t) + `  [${STATUS_LABELS[t.status]}]`);
    });
  });

// ---------------- 知识库 ----------------

const kb = program
  .command('kb')
  .description('知识库：沉淀执行中遇到的问题、搜到的知识、踩过的坑（领任务时自动带出）');

kb.command('add <title>')
  .description('记一条知识（问题/知识/坑）')
  .option('-d, --desc <desc>', '详情：现象、原因、解法、摘录…（支持 Markdown）')
  .option('-t, --type <type>', '类型 issue（未决问题）/ knowledge（资料结论）/ pitfall（踩过的坑）', 'knowledge')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--project <project>', '关联项目（默认自动识别当前 git 仓库）')
  .option('--global', '通用知识，不挂项目（任何项目领任务都会带出）')
  .option('--task <ref>', '关联任务，如 T-3（会在任务动态里留痕）')
  .option('--url <url>', '来源链接（搜到的知识记出处）')
  .option('--tool <tool>', '记录者工具名（默认自动识别）')
  .option('--model <model>', '记录者模型 ID（AI 记录时传自己的模型，如 claude-fable-5）')
  .action((title: string, opts: { desc?: string; type: string; tags?: string; project?: string; global?: boolean; task?: string; url?: string; tool?: string; model?: string }) => {
    const project = opts.global ? '' : (opts.project ?? detectProject());
    const tool = opts.tool ?? detectTool();
    const model = opts.model ?? '';
    const creator = [model, tool].filter(Boolean).join(' · ');
    const k = createKnowledge(
      {
        title,
        body: opts.desc,
        type: resolveKbType(opts.type),
        tags: opts.tags,
        project,
        task_id: opts.task ? parseRef(opts.task) : 0,
        source_url: opts.url,
        creator,
      },
      actor()
    );
    out(k, () => console.log(`✓ 已记录 ${fmtKbLine(k)}`));
  });

kb.command('list')
  .alias('ls')
  .description('列出知识条目（最近更新在前）')
  .option('-t, --type <type>', '按类型过滤 issue/knowledge/pitfall')
  .option('--project <project>', '按项目过滤')
  .option('--tag <tag>', '按标签过滤')
  .option('-q, --query <q>', '搜索标题/正文/标签')
  .action((opts: { type?: string; project?: string; tag?: string; query?: string }) => {
    const entries = listKnowledge({
      type: opts.type ? resolveKbType(opts.type) : undefined,
      project: opts.project,
      tag: opts.tag,
      q: opts.query,
    });
    out(entries, () => {
      if (!entries.length) {
        console.log('（没有匹配的知识条目，opc kb add 记一条）');
        return;
      }
      for (const k of entries) console.log('  ' + fmtKbLine(k));
    });
  });

kb.command('search <keyword>')
  .description('全文搜索知识库（标题/正文/标签）')
  .option('--project <project>', '限定项目')
  .action((keyword: string, opts: { project?: string }) => {
    const entries = listKnowledge({ q: keyword, project: opts.project });
    out(entries, () => {
      if (!entries.length) {
        console.log(`（没搜到「${keyword}」相关的知识）`);
        return;
      }
      for (const k of entries) console.log('  ' + fmtKbLine(k));
    });
  });

kb.command('show <ref>')
  .description('查看知识条目全文')
  .action((ref: string) => {
    const k = getKnowledge(parseKbRef(ref));
    out(k, () => printKbDetail(k));
  });

kb.command('edit <ref>')
  .description('编辑知识条目（问题解决后可 --type pitfall 转成坑并补结论）')
  .option('--title <title>', '标题')
  .option('-d, --desc <desc>', '详情')
  .option('-t, --type <type>', '类型 issue/knowledge/pitfall')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--project <project>', '关联项目')
  .option('--global', '改为通用知识（清空项目）')
  .option('--task <ref>', '关联任务，如 T-3')
  .option('--url <url>', '来源链接')
  .action((ref: string, opts: { title?: string; desc?: string; type?: string; tags?: string; project?: string; global?: boolean; task?: string; url?: string }) => {
    const k = updateKnowledge(
      parseKbRef(ref),
      {
        title: opts.title,
        body: opts.desc,
        type: opts.type ? resolveKbType(opts.type) : undefined,
        tags: opts.tags,
        project: opts.global ? '' : opts.project,
        task_id: opts.task ? parseRef(opts.task) : undefined,
        source_url: opts.url,
      },
      actor()
    );
    out(k, () => console.log(`✓ 已更新 ${fmtKbLine(k)}`));
  });

kb.command('rm <ref>')
  .description('删除知识条目')
  .action((ref: string) => {
    const id = parseKbRef(ref);
    const k = getKnowledge(id);
    deleteKnowledge(id);
    out({ ok: true, id }, () => console.log(`✓ 已删除 ${kbRef(id)}「${k.title}」`));
  });

// ---------------- 调研 ----------------

function resolveResearchStatus(input: string): ResearchStatus {
  const s = RESEARCH_STATUS_ALIASES[input.toLowerCase()];
  if (!s) {
    throw new StoreError(`无效调研状态: ${input}（可选: ${RESEARCH_STATUSES.join(', ')}）`);
  }
  return s;
}

/** 资料条目编号：接受 7 / #7 */
function parseItemId(ref: string): number {
  const m = /^#?(\d+)$/.exec(ref.trim());
  if (!m) throw new StoreError(`无法识别的资料条目编号: ${ref}（期望形如 7 或 #7）`);
  return Number(m[1]);
}

function stars(rating: number): string {
  return rating > 0 ? '★'.repeat(rating) : '';
}

function fmtResearchLine(r: ResearchWithStats): string {
  const extras: string[] = [`${r.item_count} 条资料`, r.project ? `proj:${r.project}` : '通用'];
  if (r.task_id) extras.push(taskRef(r.task_id));
  return `${researchRef(r.id).padEnd(6)} [${RESEARCH_STATUS_LABELS[r.status]}] ${r.title} (${extras.join(' ')})`;
}

function fmtItemLines(i: ResearchItem): string[] {
  const head = [`#${i.id}`.padEnd(5), stars(i.rating), i.title].filter(Boolean).join(' ');
  const lines = [head];
  if (i.url) lines.push(`      ${i.url}`);
  if (i.image) lines.push(`      图: ${i.image}`);
  const firstLine = i.body.split('\n').find((l) => l.trim());
  if (firstLine) lines.push(`      ${firstLine.trim()}${i.body.trim().includes('\n') ? ' …' : ''}`);
  if (i.tags) lines.push(`      #${i.tags.split(',').join(' #')}`);
  return lines;
}

function printResearchDetail(r: Research, items: ResearchItem[]) {
  console.log(`${researchRef(r.id)} [${RESEARCH_STATUS_LABELS[r.status]}] ${r.title}`);
  const meta: string[] = [r.project ? `项目: ${r.project}` : '项目: （通用）'];
  if (r.task_id) meta.push(`关联: ${taskRef(r.task_id)}${r.task_title ? ` ${r.task_title}` : ''}`);
  const who = r.actor ? `${r.actor}${r.creator ? `（${r.creator}）` : ''}` : '—';
  meta.push(`发起: ${who} · ${r.created_at.slice(0, 10)}`);
  console.log(meta.join('  '));
  if (r.question) {
    console.log('--- 研究问题 ---');
    console.log(r.question);
  }
  console.log(`--- 资料池（${items.length} 条）---`);
  if (!items.length) {
    console.log(`  （空，opc research item ${researchRef(r.id)} "标题" --url … --image-url … -d "摘要" 添加）`);
  }
  for (const i of items) for (const line of fmtItemLines(i)) console.log('  ' + line);
  if (r.conclusion) {
    console.log('--- 结论 ---');
    console.log(r.conclusion);
  } else if (r.status === 'collecting') {
    console.log(`（还没有结论，收集完用 opc research conclude ${researchRef(r.id)} -m "总结" 收口）`);
  }
}

const research = program
  .command('research')
  .alias('rs')
  .description('调研：围绕研究问题收集链接/截图/摘要，形成结论后沉淀到知识库');

research
  .command('add <title>')
  .description('发起一次调研')
  .option('-d, --question <question>', '研究问题/目标/要求（支持 Markdown，如「找 10 个以上…每个记录爽点」）')
  .option('--project <project>', '关联项目（默认自动识别当前 git 仓库）')
  .option('--global', '通用调研，不挂项目')
  .option('--task <ref>', '关联任务，如 T-3（会在任务动态里留痕）')
  .option('--tool <tool>', '发起者工具名（默认自动识别）')
  .option('--model <model>', '发起者模型 ID（AI 发起时传自己的模型，如 claude-fable-5）')
  .action((title: string, opts: { question?: string; project?: string; global?: boolean; task?: string; tool?: string; model?: string }) => {
    const project = opts.global ? '' : (opts.project ?? detectProject());
    const tool = opts.tool ?? detectTool();
    const creator = [opts.model ?? '', tool].filter(Boolean).join(' · ');
    const r = createResearch(
      {
        title,
        question: opts.question,
        project,
        task_id: opts.task ? parseRef(opts.task) : 0,
        creator,
      },
      actor()
    );
    out(r, () => {
      console.log(`✓ 已发起调研 ${researchRef(r.id)}「${r.title}」${r.project ? `（项目 ${r.project}）` : ''}`);
      console.log(`  收集资料: opc research item ${researchRef(r.id)} "标题" --url <链接> --image-url <图> -d "摘要/爽点"`);
    });
  });

research
  .command('list')
  .alias('ls')
  .description('列出调研（最近推进在前）')
  .option('-s, --status <status>', '按状态过滤 collecting/concluded/archived/all')
  .option('--project <project>', '按项目过滤')
  .option('-q, --query <q>', '搜索标题/问题/结论')
  .action((opts: { status?: string; project?: string; query?: string }) => {
    const entries = listResearch({
      status: opts.status && opts.status !== 'all' ? resolveResearchStatus(opts.status) : opts.status,
      project: opts.project,
      q: opts.query,
    });
    out(entries, () => {
      if (!entries.length) {
        console.log('（没有匹配的调研，opc research add "主题" -d "研究问题" 发起一个）');
        return;
      }
      for (const r of entries) console.log('  ' + fmtResearchLine(r));
    });
  });

research
  .command('show <ref>')
  .description('查看调研全文：研究问题、资料池、结论')
  .action((ref: string) => {
    const detail = getResearchDetail(parseResearchRef(ref));
    out(detail, () => printResearchDetail(detail, detail.items));
  });

research
  .command('item <ref> <title>')
  .description('往资料池加一条资料卡（链接/截图/摘要/标签/星级可任意组合）')
  .option('--url <url>', '来源链接')
  .option('-d, --desc <desc>', '摘要、关键摘录、爽点分析…（支持 Markdown）')
  .option('--image <path>', '本地截图/图片文件（复制进附件目录）')
  .option('--image-url <url>', '网络图片（下载进附件目录）')
  .option('--tags <tags>', '标签，逗号分隔（可用来给条目分组，如 塔防/幸存者like）')
  .option('--rating <n>', '参考价值 1-5 星')
  .option('--tool <tool>', '记录者工具名（默认自动识别）')
  .option('--model <model>', '记录者模型 ID（AI 记录时传自己的模型）')
  .action(async (ref: string, title: string, opts: { url?: string; desc?: string; image?: string; imageUrl?: string; tags?: string; rating?: string; tool?: string; model?: string }) => {
    const researchId = parseResearchRef(ref);
    let image: string | undefined;
    if (opts.image) image = importLocalImage(opts.image);
    else if (opts.imageUrl) image = await fetchImageToFile(opts.imageUrl);
    const tool = opts.tool ?? detectTool();
    const creator = [opts.model ?? '', tool].filter(Boolean).join(' · ');
    const item = addResearchItem(
      researchId,
      {
        title,
        url: opts.url,
        body: opts.desc,
        image,
        tags: opts.tags,
        rating: opts.rating !== undefined ? Number(opts.rating) : undefined,
        creator,
      },
      actor()
    );
    out(item, () => {
      console.log(`✓ ${researchRef(researchId)} 资料 +1:`);
      for (const line of fmtItemLines(item)) console.log('  ' + line);
    });
  });

research
  .command('edit-item <id>')
  .description('编辑资料条目（编号见 research show，如 7）')
  .option('--title <title>', '标题')
  .option('--url <url>', '来源链接')
  .option('-d, --desc <desc>', '摘要/摘录')
  .option('--image <path>', '换本地图片')
  .option('--image-url <url>', '换网络图片')
  .option('--tags <tags>', '标签，逗号分隔')
  .option('--rating <n>', '参考价值 0-5（0 = 清除评级）')
  .action(async (id: string, opts: { title?: string; url?: string; desc?: string; image?: string; imageUrl?: string; tags?: string; rating?: string }) => {
    let image: string | undefined;
    if (opts.image) image = importLocalImage(opts.image);
    else if (opts.imageUrl) image = await fetchImageToFile(opts.imageUrl);
    const item = updateResearchItem(
      parseItemId(id),
      {
        title: opts.title,
        url: opts.url,
        body: opts.desc,
        image,
        tags: opts.tags,
        rating: opts.rating !== undefined ? Number(opts.rating) : undefined,
      },
      actor()
    );
    out(item, () => {
      console.log(`✓ 已更新资料 #${item.id}:`);
      for (const line of fmtItemLines(item)) console.log('  ' + line);
    });
  });

research
  .command('rm-item <id>')
  .description('删除资料条目（附带清理截图文件）')
  .action((id: string) => {
    const itemId = parseItemId(id);
    const item = getResearchItem(itemId);
    deleteResearchItem(itemId);
    out({ ok: true, id: itemId }, () => console.log(`✓ 已删除资料 #${itemId}「${item.title}」`));
  });

research
  .command('conclude <ref>')
  .description('写综合结论，调研转入「已有结论」')
  .requiredOption('-m, --message <conclusion>', '结论/总结全文（支持 Markdown）')
  .action((ref: string, opts: { message: string }) => {
    const id = parseResearchRef(ref);
    const r = updateResearch(id, { conclusion: opts.message, status: 'concluded' }, actor());
    out(r, () => {
      console.log(`✓ ${researchRef(r.id)}「${r.title}」→ ${RESEARCH_STATUS_LABELS[r.status]}`);
      console.log(`  值得长期复用？opc research distill ${researchRef(r.id)} 一键沉淀到知识库`);
    });
  });

research
  .command('edit <ref>')
  .description('编辑调研字段')
  .option('--title <title>', '标题')
  .option('-d, --question <question>', '研究问题/目标/要求')
  .option('-s, --status <status>', '状态 collecting/concluded/archived')
  .option('--project <project>', '关联项目')
  .option('--global', '改为通用调研（清空项目）')
  .option('--task <ref>', '关联任务，如 T-3')
  .action((ref: string, opts: { title?: string; question?: string; status?: string; project?: string; global?: boolean; task?: string }) => {
    const r = updateResearch(
      parseResearchRef(ref),
      {
        title: opts.title,
        question: opts.question,
        status: opts.status ? resolveResearchStatus(opts.status) : undefined,
        project: opts.global ? '' : opts.project,
        task_id: opts.task ? parseRef(opts.task) : undefined,
      },
      actor()
    );
    out(r, () => console.log(`✓ 已更新 ${researchRef(r.id)} [${RESEARCH_STATUS_LABELS[r.status]}] ${r.title}`));
  });

research
  .command('distill <ref>')
  .description('把结论沉淀为知识库条目（调研是生产线，知识库是仓库），调研转入已归档')
  .option('-t, --type <type>', '知识类型 issue/knowledge/pitfall', 'knowledge')
  .option('--global', '沉淀为通用知识，不挂项目')
  .option('--tool <tool>', '记录者工具名（默认自动识别）')
  .option('--model <model>', '记录者模型 ID')
  .action((ref: string, opts: { type: string; global?: boolean; tool?: string; model?: string }) => {
    const tool = opts.tool ?? detectTool();
    const creator = [opts.model ?? '', tool].filter(Boolean).join(' · ');
    const { research: r, entry } = distillResearch(parseResearchRef(ref), actor(), {
      type: resolveKbType(opts.type),
      global: opts.global,
      creator,
    });
    out({ research: r, knowledge: entry }, () => {
      console.log(`✓ ${researchRef(r.id)} 已沉淀为 ${fmtKbLine(entry)}`);
      console.log(`  调研转入「${RESEARCH_STATUS_LABELS[r.status]}」`);
    });
  });

research
  .command('rm <ref>')
  .description('删除调研（连同资料池和截图文件）')
  .action((ref: string) => {
    const id = parseResearchRef(ref);
    const r = getResearchDetail(id);
    deleteResearch(id);
    out({ ok: true, id }, () =>
      console.log(`✓ 已删除 ${researchRef(id)}「${r.title}」（含 ${r.items.length} 条资料）`)
    );
  });

program
  .command('info')
  .description('显示数据库位置和身份识别结果')
  .action(() => {
    const tool = detectTool();
    const model = detectModel();
    out({ db: dbPath(), actor: actor(), tool, model }, () => {
      console.log(`数据库: ${dbPath()}`);
      console.log(`当前身份: ${actor()}`);
      console.log(`工具识别: ${tool || '（未识别）'}`);
      console.log(`模型兜底: ${model || '（无）'}  ← 环境变量仅供参考，claim 时请用 --model 显式指定`);
    });
  });

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof StoreError) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
