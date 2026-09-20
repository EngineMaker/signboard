/** `npm run bot:register` から呼ばれる。スラッシュコマンドを Discord に登録する。 */
import { authConfig } from '../config.ts';
import { registerCommands } from './index.ts';

const auth = authConfig();

await registerCommands(auth);
console.log('スラッシュコマンドを登録しました: /signboard post | list | delete');
console.log(`（ギルド ${auth.guildId} に即時反映されます）`);
