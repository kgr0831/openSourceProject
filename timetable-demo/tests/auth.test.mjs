import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_BASE_URL, login, signup, getMe, logout, getCachedUser, saveUser, clearUser } from '../public/auth.js';

test('AUTH_BASE_URL keeps account requests on the same origin', () => {
  assert.equal(AUTH_BASE_URL, '');
});

test('login requires studentId and password', async () => {
  await assert.rejects(async () => {
    await login({ studentId: '', password: '123' });
  }, { message: '학번을 입력해 주세요.' });

  await assert.rejects(async () => {
    await login({ studentId: '20240001', password: '' });
  }, { message: '비밀번호를 입력해 주세요.' });
});

test('signup requires studentId and password', async () => {
  await assert.rejects(async () => {
    await signup({ studentId: '', password: '123' });
  }, { message: '학번을 입력해 주세요.' });

  await assert.rejects(async () => {
    await signup({ studentId: '20240001', password: '' });
  }, { message: '비밀번호를 입력해 주세요.' });
});

test('localStorage caching works safely', () => {
  // Test in Node environment where localStorage is not defined or mock it
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
  }

  saveUser({ id: '1', studentId: '20241234' });
  const user = getCachedUser();
  assert.equal(user?.studentId, '20241234');

  clearUser();
  assert.equal(getCachedUser(), null);
});
