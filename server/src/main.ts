import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoreboard } from './app.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const board = await createScoreboard({
  saveDirectory: process.env.D2_SAVE_DIR ?? path.join(root, 'save'),
  clientDirectory: path.join(root, 'client/dist'),
});
const port = await board.listen(Number(process.env.PORT ?? 8000));
console.log(`D2ロボコン2026 得点板: http://localhost:${port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void board.close().then(() => process.exit()); });
