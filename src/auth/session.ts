import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 署名付きセッション。
 * 値は Cookie に入れて端末が保持し、サーバーは署名の検証だけを行う（DB に持たない）。
 * 住人数が少なく、失効は有効期限で足りるため。
 */

export interface SessionData {
  /** Discord のユーザーID */
  userId: string;
  /** 表示名。監査ログの actor_name に使う */
  userName: string;
  /** 発行時刻 (epoch ms) */
  issuedAt: number;
}

/** セッションの有効期限。切れたら再ログイン（＝ロールの再検証）が走る。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const base64url = (buf: Buffer) => buf.toString('base64url');

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

/** セッションを署名付き文字列にする。 */
export function encodeSession(data: SessionData, secret: string): string {
  const payload = base64url(Buffer.from(JSON.stringify(data), 'utf8'));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * 署名を検証してセッションを取り出す。
 * 改竄・期限切れ・形式不正はすべて null を返す（呼び出し側は未ログインとして扱う）。
 */
export function decodeSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionData | null {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = sign(payload, secret);

  // 長さが違うと timingSafeEqual が投げるため先に弾く
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;

  let data: SessionData;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionData;
  } catch {
    return null;
  }

  if (typeof data.userId !== 'string' || typeof data.issuedAt !== 'number') return null;
  if (now - data.issuedAt > SESSION_TTL_MS) return null;

  return data;
}

/** OAuth の state パラメータ（CSRF 対策）に使う乱数。 */
export function randomState(): string {
  return randomBytes(32).toString('base64url');
}
