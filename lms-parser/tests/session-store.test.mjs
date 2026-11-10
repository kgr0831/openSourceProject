import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionStore} from '../session-store.mjs';

// Synthetic credentials only. Never touch the real application's saved login.
const state = {cookies: [{name: 'session', value: 'synthetic-session-only', domain: 'canvas.ssu.ac.kr', path: '/', expires: -1, secure: true, httpOnly: true, sameSite: 'Lax'}],
  origins: [{origin: 'https://canvas.ssu.ac.kr', localStorage: [{name: 'fixture', value: '한글 합성 자료'}]}]};

test('Windows 계정 암호화로 세션 쿠키를 재시작 후 복원하고 로그아웃하면 지운다', {skip: process.platform !== 'win32'}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lms-session-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new SessionStore({directory});
  assert.equal(await store.load(), null);
  await store.save(state);
  const bytes = await readFile(store.filename);
  assert.equal(bytes.includes(Buffer.from('synthetic-session-only')), false);
  assert.equal(bytes.includes(Buffer.from('canvas.ssu.ac.kr')), false);
  assert.deepEqual(await new SessionStore({directory}).load(), state);
  assert.deepEqual(await readdir(directory), ['login.dpapi']);
  // Flush an in-flight save before clearing, so it cannot resurrect the login.
  const pending = store.save(state);
  await store.clear(); await pending;
  assert.equal(await store.load(), null);
  await writeFile(store.filename, Buffer.from('broken synthetic fixture'));
  await assert.rejects(store.load(), error => error.code === 'SESSION_STORAGE' && !error.message.includes('fixture'));
});

test('암호화 실패 시 평문 파일을 만들지 않고 기존 암호화 파일을 보존한다', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lms-session-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new SessionStore({directory, supported: true, protect: async () => { throw new Error('synthetic-session-only'); }});
  await writeFile(store.filename, Buffer.from('previous-encrypted-fixture'));
  await assert.rejects(store.save(state), error => error.code === 'SESSION_STORAGE' && !error.message.includes('synthetic'));
  assert.equal(await readFile(store.filename, 'utf8'), 'previous-encrypted-fixture');
  assert.deepEqual(await readdir(directory), ['login.dpapi']);
});
