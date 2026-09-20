import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { testDb } from './helpers.ts';

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await createApp(testDb()).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
