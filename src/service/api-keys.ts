import type { DB } from '../db/index.ts';
import type { ApiKeyRow } from '../db/schema.ts';
import { recordAudit } from '../repo/audit.ts';
import {
  issueApiKey as repoIssue,
  revokeApiKey as repoRevoke,
  type IssuedKey,
} from '../repo/api-keys.ts';
import type { Context } from './notices.ts';

/** 監査ログに載せる情報。**平文もハッシュも載せない。** */
function snapshot(row: ApiKeyRow) {
  return {
    id: row.id,
    label: row.label,
    prefix: row.key_prefix,
    ownerName: row.owner_name,
  };
}

export function issueApiKey(
  db: DB,
  input: { label: string },
  ctx: Context,
  now = Date.now(),
): IssuedKey {
  return db.transaction(() => {
    const issued = repoIssue(
      db,
      { label: input.label, ownerId: ctx.actor.id, ownerName: ctx.actor.name },
      now,
    );

    recordAudit(
      db,
      {
        actor: ctx.actor,
        action: 'apikey.create',
        targetType: 'api_key',
        targetId: issued.row.id,
        after: snapshot(issued.row),
        source: ctx.source,
        ip: ctx.ip,
      },
      now,
    );

    return issued;
  })();
}

export function revokeApiKey(
  db: DB,
  id: number,
  ctx: Context,
  now = Date.now(),
): ApiKeyRow | undefined {
  return db.transaction(() => {
    const revoked = repoRevoke(db, id, now);
    if (!revoked) return undefined;

    recordAudit(
      db,
      {
        actor: ctx.actor,
        action: 'apikey.revoke',
        targetType: 'api_key',
        targetId: id,
        before: snapshot(revoked),
        source: ctx.source,
        ip: ctx.ip,
      },
      now,
    );

    return revoked;
  })();
}
