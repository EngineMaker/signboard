import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db/index.ts';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../src/repo/settings.ts';
import { T0, testDb } from './helpers.ts';

let db: DB;
beforeEach(() => {
  db = testDb();
});

describe('getSettings', () => {
  it('未設定なら既定値を返す', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('0件時のフォールバック文言に既定がある', () => {
    expect(getSettings(db).fallbackText).toBe('お知らせ募集中');
  });

  it('壊れた値は既定値に倒れる（掲示板を落とさない）', () => {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('scrollSpeed', 'not-json', T0);
    expect(getSettings(db).scrollSpeed).toBe(DEFAULT_SETTINGS.scrollSpeed);
  });

  it('型が違う値は既定値に倒れる', () => {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('scrollSpeed', '"速め"', T0);
    expect(getSettings(db).scrollSpeed).toBe(DEFAULT_SETTINGS.scrollSpeed);
  });

  it('未知のキーは無視する', () => {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('unknownKey', '"x"', T0);
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('updateSettings', () => {
  it('指定した項目だけ変わる', () => {
    const s = updateSettings(db, { scrollSpeed: 200 }, T0);
    expect(s.scrollSpeed).toBe(200);
    expect(s.fontScale).toBe(DEFAULT_SETTINGS.fontScale);
    expect(s.fallbackText).toBe(DEFAULT_SETTINGS.fallbackText);
  });

  it('複数回の更新が積み重なる', () => {
    updateSettings(db, { scrollSpeed: 200 }, T0);
    const s = updateSettings(db, { fallbackText: '平和です' }, T0 + 1000);
    expect(s.scrollSpeed).toBe(200);
    expect(s.fallbackText).toBe('平和です');
  });

  it('同じキーを上書きできる', () => {
    updateSettings(db, { theme: 'led' }, T0);
    expect(updateSettings(db, { theme: 'dark' }, T0 + 1000).theme).toBe('dark');
    expect(db.prepare('SELECT COUNT(*) c FROM settings WHERE key = ?').get('theme')).toEqual({ c: 1 });
  });
});
