import type { DB } from '../db/index.ts';

/**
 * 掲示板の表示設定（SPEC §2.3）。
 * 管理画面から変更でき、iPad の表示に反映される。
 */
export interface Settings {
  /** 横スクロールの速度（px/秒）。文字が大きいほど速くしないと一周が長くなる。 */
  scrollSpeed: number;
  /**
   * 文字サイズ（画面高さに対する割合 %）。
   * 9.7インチ(1024x768 CSS px)では 12 で約92px。リビングの距離から読めて、
   * かつ1画面に十数文字入る妥協点。管理画面から調整できる。
   */
  fontScale: number;
  /** テーマ。MVP は dark のみ。将来 'led' を追加する余地を残す。 */
  theme: string;
  /** お知らせが0件のときに流す文言 */
  fallbackText: string;
  /**
   * 新着が届いたときの光り方。
   * 'white'（白で2回）/ 'amber'（琥珀で3回）/ 'fade'（じわっと1回）/ 'off'（光らせない）
   */
  flashStyle: string;
}

/** 選べる光り方。管理画面の選択肢と、検証の両方で使う。 */
export const FLASH_STYLES = ['white', 'amber', 'fade', 'off'] as const;

export const DEFAULT_SETTINGS: Settings = {
  scrollSpeed: 220,
  fontScale: 12,
  theme: 'dark',
  fallbackText: 'お知らせ募集中',
  flashStyle: 'white',
};

/**
 * 設定を取得する。DBに無い項目は既定値で埋める。
 * 値が壊れていた場合も既定値に倒し、掲示板が落ちないようにする。
 */
export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];

  const result: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue; // 壊れた値は無視して既定値のまま。
    }

    // 既定値と型が一致するものだけ採用する。
    switch (row.key as keyof Settings) {
      case 'scrollSpeed':
        if (typeof parsed === 'number') result.scrollSpeed = parsed;
        break;
      case 'fontScale':
        if (typeof parsed === 'number') result.fontScale = parsed;
        break;
      case 'theme':
        if (typeof parsed === 'string') result.theme = parsed;
        break;
      case 'fallbackText':
        if (typeof parsed === 'string') result.fallbackText = parsed;
        break;
      case 'flashStyle':
        // 知らない値が入っていても既定に倒す。掲示板を壊さないため。
        if (typeof parsed === 'string' && (FLASH_STYLES as readonly string[]).includes(parsed)) {
          result.flashStyle = parsed;
        }
        break;
    }
  }
  return result;
}

/** 与えられた項目だけ更新し、更新後の全設定を返す。 */
export function updateSettings(db: DB, patch: Partial<Settings>, now = Date.now()): Settings {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
      stmt.run(key, JSON.stringify(value), now);
    }
  })();

  return getSettings(db);
}
