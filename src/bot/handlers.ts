import type { DB } from '../db/index.ts';
import type { EventBus } from '../events/bus.ts';
import { listActiveNotices } from '../repo/notices.ts';
import { getSettings } from '../repo/settings.ts';
import { createNotice, deleteNotice } from '../service/notices.ts';

/**
 * スラッシュコマンドの中身。
 * discord.js の型に依存させず、入力と出力だけを扱う純粋な関数にしておく
 * （テストから Discord を起動せずに検証できる）。
 */

export interface CommandActor {
  id: string;
  name: string;
}

export interface CommandDeps {
  db: DB;
  events?: EventBus;
}

const HOUR_MS = 3600000;
const MAX_BODY_LENGTH = 200;

/** Discord に返す文面。ephemeral は本人にだけ見せるかどうか。 */
export interface CommandReply {
  content: string;
  ephemeral: boolean;
}

export function handlePost(
  deps: CommandDeps,
  actor: CommandActor,
  input: { text: string; hours?: number | null },
  now = Date.now(),
): CommandReply {
  const body = input.text.trim();

  if (body === '') {
    return { content: '本文が空です。', ephemeral: true };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return { content: `本文は${MAX_BODY_LENGTH}文字以内にしてください。`, ephemeral: true };
  }

  const notice = createNotice(
    deps.db,
    {
      body,
      expiresAt: input.hours ? now + input.hours * HOUR_MS : undefined,
    },
    { actor, source: 'bot', events: deps.events },
    now,
  );

  const hours = Math.round((notice.expires_at - now) / HOUR_MS);
  return {
    content: `掲示板に流しました（#${notice.id}・約${hours}時間表示）\n> ${body}`,
    ephemeral: false,
  };
}

export function handleList(deps: CommandDeps, now = Date.now()): CommandReply {
  const notices = listActiveNotices(deps.db, now);

  if (notices.length === 0) {
    const { fallbackText } = getSettings(deps.db);
    return {
      content: `いま流れているお知らせはありません。\n（掲示板には「${fallbackText}」と表示されています）`,
      ephemeral: true,
    };
  }

  const lines = notices.map((n) => {
    const hours = Math.max(0, Math.round((n.expires_at - now) / HOUR_MS));
    const remaining = hours >= 24 ? `あと${Math.floor(hours / 24)}日` : `あと${hours}時間`;
    return `**#${n.id}** ${n.body}\n　${n.author_name}・${remaining}`;
  });

  return {
    content: `いま流れているお知らせ（${notices.length}件）\n\n${lines.join('\n')}`,
    ephemeral: true,
  };
}

export function handleDelete(
  deps: CommandDeps,
  actor: CommandActor,
  input: { id: number },
  now = Date.now(),
): CommandReply {
  const deleted = deleteNotice(
    deps.db,
    input.id,
    { actor, source: 'bot', events: deps.events },
    now,
  );

  if (!deleted) {
    return {
      content: `#${input.id} は見つかりませんでした。/signboard list で番号を確認してください。`,
      ephemeral: true,
    };
  }

  return { content: `#${input.id} を消しました。\n> ${deleted.body}`, ephemeral: false };
}
