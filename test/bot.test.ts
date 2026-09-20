import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db/index.ts';
import { EventBus } from '../src/events/bus.ts';
import { handleDelete, handleList, handlePost } from '../src/bot/handlers.ts';
import { commands, signboardCommand } from '../src/bot/commands.ts';
import { listAuditLogs } from '../src/repo/audit.ts';
import { listActiveNotices } from '../src/repo/notices.ts';
import { updateSettings } from '../src/service/settings.ts';
import { HOUR, T0, testDb } from './helpers.ts';

let db: DB;
let events: EventBus;
let seen: string[];

beforeEach(() => {
  db = testDb();
  events = new EventBus();
  seen = [];
  events.subscribe((e) => seen.push(e.name));
});

const deps = () => ({ db, events });
const actor = { id: '111', name: 'けーえむ' };

describe('/signboard post', () => {
  it('投稿でき、掲示板に出る', () => {
    const reply = handlePost(deps(), actor, { text: 'ゴミ出し当番' }, T0);

    expect(reply.ephemeral).toBe(false);
    expect(reply.content).toContain('掲示板に流しました');
    expect(listActiveNotices(db, T0).map((n) => n.body)).toEqual(['ゴミ出し当番']);
  });

  it('監査ログに bot として残る', () => {
    handlePost(deps(), actor, { text: 'test' }, T0);

    const log = listAuditLogs(db)[0]!;
    expect(log.action).toBe('notice.create');
    expect(log.source).toBe('bot');
    expect(log.actor_name).toBe('けーえむ');
  });

  it('SSE イベントが発行される（iPad に即反映）', () => {
    handlePost(deps(), actor, { text: 'test' }, T0);
    expect(seen).toEqual(['notices-changed']);
  });

  it('期限を指定できる', () => {
    handlePost(deps(), actor, { text: 'test', hours: 3 }, T0);
    expect(listActiveNotices(db, T0)[0]!.expires_at).toBe(T0 + 3 * HOUR);
  });

  it('期限未指定なら24時間', () => {
    const reply = handlePost(deps(), actor, { text: 'test' }, T0);
    expect(listActiveNotices(db, T0)[0]!.expires_at).toBe(T0 + 24 * HOUR);
    expect(reply.content).toContain('24時間');
  });

  it('空文字は拒否し、本人にだけ見せる', () => {
    const reply = handlePost(deps(), actor, { text: '   ' }, T0);
    expect(reply.ephemeral).toBe(true);
    expect(listActiveNotices(db, T0)).toHaveLength(0);
    expect(seen).toEqual([]);
  });

  it('長すぎる本文は拒否する', () => {
    const reply = handlePost(deps(), actor, { text: 'あ'.repeat(201) }, T0);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('200文字以内');
    expect(listActiveNotices(db, T0)).toHaveLength(0);
  });

  it('前後の空白を取り除く', () => {
    handlePost(deps(), actor, { text: '  余白あり  ' }, T0);
    expect(listActiveNotices(db, T0)[0]!.body).toBe('余白あり');
  });
});

describe('/signboard list', () => {
  it('流れている内容を番号付きで返す', () => {
    handlePost(deps(), actor, { text: '1件目' }, T0);
    handlePost(deps(), actor, { text: '2件目' }, T0 + 1000);

    const reply = handleList(deps(), T0 + 2000);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('2件');
    expect(reply.content).toContain('1件目');
    expect(reply.content).toContain('2件目');
  });

  it('0件ならフォールバック文言を伝える', () => {
    updateSettings(db, { fallbackText: '平和です' }, { actor, source: 'web' }, T0);
    const reply = handleList(deps(), T0);

    expect(reply.content).toContain('ありません');
    expect(reply.content).toContain('平和です');
  });

  it('期限切れは出さない', () => {
    handlePost(deps(), actor, { text: '切れる', hours: 1 }, T0);
    expect(handleList(deps(), T0 + 2 * HOUR).content).toContain('ありません');
  });

  it('本人にだけ見せる（チャンネルを汚さない）', () => {
    handlePost(deps(), actor, { text: 'test' }, T0);
    expect(handleList(deps(), T0).ephemeral).toBe(true);
  });
});

describe('/signboard delete', () => {
  it('削除でき、掲示板から消える', () => {
    handlePost(deps(), actor, { text: '消す内容' }, T0);
    const id = listActiveNotices(db, T0)[0]!.id;
    seen.length = 0;

    const reply = handleDelete(deps(), actor, { id }, T0 + 1000);

    expect(reply.content).toContain('消しました');
    expect(reply.content).toContain('消す内容');
    expect(listActiveNotices(db, T0 + 1000)).toHaveLength(0);
    expect(seen).toEqual(['notices-changed']);
  });

  it('監査ログに本文が残る', () => {
    handlePost(deps(), actor, { text: '消える本文' }, T0);
    const id = listActiveNotices(db, T0)[0]!.id;
    handleDelete(deps(), actor, { id }, T0 + 1000);

    const log = listAuditLogs(db, { action: 'notice.delete' })[0]!;
    expect(JSON.parse(log.before_json!).body).toBe('消える本文');
    expect(log.source).toBe('bot');
  });

  it('存在しない番号は本人にだけエラーを返す', () => {
    const reply = handleDelete(deps(), actor, { id: 9999 }, T0);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('見つかりません');
    expect(seen).toEqual([]);
  });

  it('二重削除は2回目がエラー', () => {
    handlePost(deps(), actor, { text: 'test' }, T0);
    const id = listActiveNotices(db, T0)[0]!.id;
    handleDelete(deps(), actor, { id }, T0 + 1000);

    expect(handleDelete(deps(), actor, { id }, T0 + 2000).ephemeral).toBe(true);
  });
});

describe('コマンド定義', () => {
  it('post / list / delete の3つを持つ', () => {
    const json = signboardCommand.toJSON();
    expect(json.name).toBe('signboard');
    expect(json.options?.map((o) => o.name)).toEqual(['post', 'list', 'delete']);
  });

  it('Discord に登録できる形になっている', () => {
    expect(commands).toHaveLength(1);
    expect(() => JSON.stringify(commands)).not.toThrow();
  });

  it('本文の上限がアプリ側と揃っている', () => {
    const post = signboardCommand.toJSON().options?.[0] as {
      options?: { name: string; max_length?: number }[];
    };
    expect(post.options?.find((o) => o.name === 'text')?.max_length).toBe(200);
  });
});
