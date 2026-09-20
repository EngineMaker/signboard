import type { DB } from '../db/index.ts';
import { recordAudit } from '../repo/audit.ts';
import { getSettings, updateSettings as repoUpdate, type Settings } from '../repo/settings.ts';
import type { Context } from './notices.ts';

/** 設定変更。監査ログに変更前後を残す（SPEC §2.7）。 */
export function updateSettings(
  db: DB,
  patch: Partial<Settings>,
  ctx: Context,
  now = Date.now(),
): Settings {
  const { after, changed } = db.transaction(() => {
    const before = getSettings(db);
    const after = repoUpdate(db, patch, now);

    // 実際に変わった項目だけ記録する（変更なしのログでノイズを増やさない）
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter(
      (k) => k in before && before[k] !== after[k],
    );

    if (changed.length > 0) {
      recordAudit(
        db,
        {
          actor: ctx.actor,
          action: 'settings.update',
          targetType: 'settings',
          targetId: changed.join(','),
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
          source: ctx.source,
          ip: ctx.ip,
        },
        now,
      );
    }

    return { after, changed };
  })();

  // 設定が実際に変わったときだけ配信する
  if (changed.length > 0) ctx.events?.emit('settings-changed');
  return after;
}
