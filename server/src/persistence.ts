import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { State } from '../../shared/model.js';
import { initialState } from '../../shared/model.js';
import { stateSchema } from '../../shared/validation.js';

/** Serialized by the caller. Only complete, validated snapshots replace current.json. */
export async function saveState(directory: string, state: State): Promise<void> {
  await mkdir(directory, { recursive: true });
  const dest = path.join(directory, 'current.json');
  const temp = path.join(directory, 'current.tmp');
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  try { await copyFile(dest, path.join(directory, 'previous.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await rename(temp, dest);
}
export async function loadState(directory: string): Promise<{ state: State; error: string | null }> {
  let invalidFile = false;
  for (const [index, name] of ['current.json', 'previous.json'].entries()) {
    try {
      const state = stateSchema.parse(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
      return { state, error: index === 0 ? null : '最新の保存データを読み込めなかったため、直前のバックアップを復元しました。' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') invalidFile = true;
    }
  }
  if (!invalidFile) return { state: initialState(), error: null };
  // Do not overwrite unreadable records with an empty match.
  throw new Error('保存データとバックアップを読み込めません。saveフォルダーを保全して内容を確認してください。');
}
