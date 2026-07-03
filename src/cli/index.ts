import '../shared/quiet';
import { execSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { Command } from 'commander';
import {
  Activity,
  HUMAN_ACTOR,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  ProjectWithStats,
  STATUS_ALIASES,
  STATUS_LABELS,
  STATUSES,
  Status,
  Task,
  parseRef,
  taskRef,
} from '../shared/types';
import {
  StoreError,
  addNote,
  claimTask,
  completeTask,
  createTask,
  getProject,
  getTask,
  getTaskActivity,
  listProjectsWithStats,
  listTasks,
  moveTask,
  peekNext,
  updateProject,
  updateTask,
} from '../shared/store';
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
  if (process.env.CLAUDECODE) return 'claude';
  return HUMAN_ACTOR;
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
  if (extras.length) parts.push(`(${extras.join(' ')})`);
  return parts.join(' ');
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

function printDetail(t: Task, activity: Activity[]) {
  console.log(`${taskRef(t.id)} [${t.priority}] ${t.title}`);
  const agentInfo = [t.agent_tool, t.agent_model].filter(Boolean).join(' · ');
  const who = t.assignee ? `${t.assignee}${agentInfo ? `（${agentInfo}）` : ''}` : '未分配';
  console.log(`状态: ${STATUS_LABELS[t.status]}  负责: ${who}${t.project ? `  项目: ${t.project}` : ''}${t.due_date ? `  截止: ${t.due_date}` : ''}`);
  if (t.creator) console.log(`创建: ${t.creator}`);
  if (t.description) {
    console.log('---');
    console.log(t.description);
  }
  if (activity.length) {
    console.log('--- 动态 ---');
    for (const a of activity) console.log(fmtActivity(a));
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
    out({ ...t, activity }, () => printDetail(t, activity));
  });

program
  .command('add <title>')
  .description('创建任务')
  .option('-d, --desc <desc>', '任务描述（目标、上下文、验收标准）')
  .option('-p, --priority <priority>', '优先级 P0-P3', 'P2')
  .option('--project <project>', '所属项目')
  .option('-s, --status <status>', '初始状态', 'todo')
  .option('--due <date>', '截止日期 YYYY-MM-DD')
  .option('--tool <tool>', '创建者工具名（默认自动识别，如 claude-code）')
  .option('--model <model>', '创建者模型 ID（AI 创建时传自己的模型，如 claude-fable-5）')
  .action((title: string, opts: { desc?: string; priority: string; project?: string; status: string; due?: string; tool?: string; model?: string }) => {
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
      },
      actor()
    );
    out(t, () => {
      console.log(`✓ 已创建 ${fmtLine(t)} → ${STATUS_LABELS[t.status]}`);
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
    const t = claimTask(id, actor(), { tool, model });
    const activity = getTaskActivity(t.id);
    out({ ...t, activity }, () => {
      const info = [tool, model].filter(Boolean).join(' · ');
      console.log(`✓ ${actor()}${info ? `（${info}）` : ''} 已领取 ${taskRef(t.id)}，状态 → ${STATUS_LABELS[t.status]}\n`);
      printDetail(t, activity);
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
    out(t, () => console.log(`✓ ${taskRef(t.id)} → ${STATUS_LABELS[t.status]}`));
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
