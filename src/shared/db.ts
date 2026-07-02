import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 从当前模块位置向上找包含 package.json 的目录，作为仓库根 */
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function dbPath(): string {
  return process.env.OPC_DB || join(findRepoRoot(), 'data', 'opc.db');
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'P2',
      project TEXT NOT NULL DEFAULT '',
      assignee TEXT NOT NULL DEFAULT '',
      agent_tool TEXT NOT NULL DEFAULT '',
      agent_model TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      actor TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
    CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
  migrate(db);
  return db;
}

/** 旧库补列（幂等） */
function migrate(db: DatabaseSync) {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name)
  );
  if (!cols.has('agent_tool')) db.exec("ALTER TABLE tasks ADD COLUMN agent_tool TEXT NOT NULL DEFAULT ''");
  if (!cols.has('agent_model')) db.exec("ALTER TABLE tasks ADD COLUMN agent_model TEXT NOT NULL DEFAULT ''");
}
