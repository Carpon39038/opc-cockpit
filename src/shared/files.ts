import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { dbPath } from './db';
import { StoreError } from './store';

/** 附件目录：跟数据库同级的 files/（OPC_DB 指到别处时附件跟着走） */
export function filesDir(): string {
  return join(dirname(dbPath()), 'files');
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

/** 从原文件名或 MIME 推断扩展名，认不出默认 png（截图场景最常见） */
function inferExt(hint: string): string {
  const byMime = EXT_BY_MIME[hint.split(';')[0].trim().toLowerCase()];
  if (byMime) return byMime;
  const ext = extname(hint.split(/[?#]/)[0]).slice(1).toLowerCase();
  return IMAGE_EXTS.has(ext) ? ext : 'png';
}

function newFileName(ext: string): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.${ext}`;
}

/** 保存图片数据到附件目录，返回存储文件名（hint = 原文件名 / MIME / URL） */
export function saveImageBuffer(data: Uint8Array, hint = ''): string {
  if (!data.byteLength) throw new StoreError('图片内容为空');
  const dir = filesDir();
  mkdirSync(dir, { recursive: true });
  const name = newFileName(inferExt(hint));
  writeFileSync(join(dir, name), data);
  return name;
}

/** 复制本地图片到附件目录，返回存储文件名 */
export function importLocalImage(path: string): string {
  if (!existsSync(path)) throw new StoreError(`图片文件不存在: ${path}`);
  const dir = filesDir();
  mkdirSync(dir, { recursive: true });
  const name = newFileName(inferExt(path));
  copyFileSync(path, join(dir, name));
  return name;
}

/** 下载网络图片到附件目录，返回存储文件名 */
export async function fetchImageToFile(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new StoreError(`下载图片失败: ${url}（${e instanceof Error ? e.message : e}）`);
  }
  if (!res.ok) throw new StoreError(`下载图片失败: ${url}（HTTP ${res.status}）`);
  const data = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  return saveImageBuffer(data, EXT_BY_MIME[type.split(';')[0].trim()] ? type : url);
}

/** 删除附件（条目/调研删除时清理，文件不存在则忽略） */
export function deleteFiles(names: (string | undefined)[]): void {
  const dir = filesDir();
  for (const name of names) {
    if (!name || name.includes('/') || name.includes('..')) continue;
    rmSync(join(dir, name), { force: true });
  }
}
