import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { runHook } from '../src/codex.js';

const item = (payload: object) => ({ type: 'response_item', payload });
const message = (text: string) => item({ type: 'message', role: 'user', content: [{ text }] });
const records = [
  message('STALE'),
  { type: 'compacted', payload: { replacement_history: [message('CURRENT').payload] } },
  ...['keep', 'drop'].flatMap((name) => [
    item({ type: 'function_call', call_id: name, name, arguments: '{}' }),
    item({
      type: 'function_call_output',
      call_id: name,
      output: name === 'keep' ? 'OUTPUT_keep' + 'x'.repeat(16_000) + 'KEEP_TAIL' : 'OUTPUT_drop',
    }),
  ]),
  ...Array.from({ length: 6 }, (_, index) => message(`Recent prompt ${index}`)),
];

test('restores selected evidence once after native compaction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-test-'));
  try {
    const transcript = join(directory, 'rollout.jsonl');
    await writeFile(transcript, records.map((record) => JSON.stringify(record)).join('\n'));
    const event = { session_id: 'fake-session', transcript_path: transcript };
    const cache = join(directory, 'cache');
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
      expect(init?.redirect).toBe('error');
      const body = JSON.parse(String(init?.body));
      expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
      expect(String(init?.body)).toContain('CURRENT');
      expect(String(init?.body)).not.toMatch(/STALE|OUTPUT_/);
      return Response.json({
        answers: Object.fromEntries(Object.keys(body.questions).map((key) => [
          key, { noul: key.endsWith('_t1') ? 1 : 0 },
        ])),
      });
    });
    const options = { cache, apiKey: 'test-key', fetcher };
    const restore = { ...event, hook_event_name: 'SessionStart', source: 'compact' };
    await runHook({ ...event, hook_event_name: 'PreCompact' }, options);
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await stat(cache)).mode & 0o777).toBe(0o700);
    const context = JSON.stringify(await runHook(restore, options));
    expect(context).toContain('OUTPUT_keep');
    expect(context).toContain('KEEP_TAIL');
    expect(context).toContain('shortened');
    expect(context).not.toMatch(/OUTPUT_drop|CURRENT/);
    expect(await runHook(restore, options)).toEqual({});
    expect(await readFile(transcript, 'utf8')).toContain('STALE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('leaves native compaction running when OpenRouter rejects the request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-test-'));
  try {
    const transcript = join(directory, 'rollout.jsonl');
    await writeFile(transcript, records.map((record) => JSON.stringify(record)).join('\n'));
    const event = { session_id: 'fake-session', transcript_path: transcript };
    const fetcher = vi.fn<typeof fetch>(async () => new Response('upstream detail', { status: 403 }));
    const options = { cache: join(directory, 'cache'), apiKey: 'test-key', fetcher };
    expect(await runHook({ ...event, hook_event_name: 'PreCompact' }, options)).toEqual({});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await runHook({ ...event, hook_event_name: 'SessionStart', source: 'compact' }, options)).toEqual({});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('skips OpenRouter when its configured key is in the transcript', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-test-'));
  try {
    const transcript = join(directory, 'rollout.jsonl');
    const apiKey = 'synthetic-key-in-a-prompt';
    await writeFile(transcript, [...records, message(apiKey)].map((record) => JSON.stringify(record)).join('\n'));
    const fetcher = vi.fn<typeof fetch>();
    await runHook({ session_id: 'fake-session', transcript_path: transcript, hook_event_name: 'PreCompact' }, {
      cache: join(directory, 'cache'),
      apiKey,
      fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
