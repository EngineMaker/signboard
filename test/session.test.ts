import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_MS,
  decodeSession,
  encodeSession,
  randomState,
} from '../src/auth/session.ts';
import { T0 } from './helpers.ts';

const SECRET = 'test-secret-do-not-use-in-production';
const data = { userId: '111', userName: 'けーえむ', issuedAt: T0 };

describe('encodeSession / decodeSession', () => {
  it('往復できる', () => {
    const token = encodeSession(data, SECRET);
    expect(decodeSession(token, SECRET, T0)).toEqual(data);
  });

  it('署名が違えば拒否する（別の秘密鍵）', () => {
    const token = encodeSession(data, SECRET);
    expect(decodeSession(token, 'another-secret', T0)).toBeNull();
  });

  it('本文を改竄すると拒否する', () => {
    const token = encodeSession(data, SECRET);
    const [payload, sig] = token.split('.');
    // userId を書き換えた payload を作り、元の署名を付け直す
    const forged = Buffer.from(
      JSON.stringify({ ...data, userId: '999' }),
      'utf8',
    ).toString('base64url');
    expect(decodeSession(`${forged}.${sig}`, SECRET, T0)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it('期限切れは拒否する', () => {
    const token = encodeSession(data, SECRET);
    expect(decodeSession(token, SECRET, T0 + SESSION_TTL_MS + 1)).toBeNull();
    expect(decodeSession(token, SECRET, T0 + SESSION_TTL_MS - 1)).toEqual(data);
  });

  it('未定義・空・形式不正は拒否する', () => {
    expect(decodeSession(undefined, SECRET, T0)).toBeNull();
    expect(decodeSession('', SECRET, T0)).toBeNull();
    expect(decodeSession('no-dot', SECRET, T0)).toBeNull();
    expect(decodeSession('.sig', SECRET, T0)).toBeNull();
    expect(decodeSession('payload.', SECRET, T0)).toBeNull();
  });

  it('JSON として壊れた本文は拒否する', () => {
    const payload = Buffer.from('not json', 'utf8').toString('base64url');
    const token = encodeSession(data, SECRET);
    const sig = token.split('.')[1];
    expect(decodeSession(`${payload}.${sig}`, SECRET, T0)).toBeNull();
  });
});

describe('randomState', () => {
  it('毎回異なる十分な長さの値を返す', () => {
    const a = randomState();
    const b = randomState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
});
