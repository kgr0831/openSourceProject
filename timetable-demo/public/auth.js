// Same-origin auth client: the hosted nginx and the local timetable server both route /auth to the community API.
export const AUTH_BASE_URL = '';

async function request(endpoint, options = {}) {
  const url = `${AUTH_BASE_URL}${endpoint}`;
  let response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
  } catch (err) {
    throw new Error('로그인 서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorMsg = data?.message || data?.error || `요청 처리 중 오류가 발생했습니다. (상태 코드: ${response.status})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function login({ studentId, password }) {
  if (!studentId?.trim()) throw new Error('학번을 입력해 주세요.');
  if (!password?.trim()) throw new Error('비밀번호를 입력해 주세요.');

  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ studentId: studentId.trim(), password })
  });

  if (res?.user) {
    saveUser(res.user);
  }
  return res;
}

export async function signup({ studentId, password }) {
  if (!studentId?.trim()) throw new Error('학번을 입력해 주세요.');
  if (!password?.trim()) throw new Error('비밀번호를 입력해 주세요.');

  const res = await request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ studentId: studentId.trim(), password })
  });
  return res;
}

export async function getMe() {
  try {
    const res = await request('/auth/me', {
      method: 'GET'
    });
    if (res?.user) {
      saveUser(res.user);
      return res.user;
    }
    // 백엔드가 명시적으로 "로그인 안 됨"이라고 응답한 경우에만 캐시 삭제
    clearUser();
    return null;
  } catch (err) {
    // 백엔드 서버가 꺼져있거나 네트워크 에러인 경우 → 기존 캐시 유지
    // 401(인증 만료) 등 서버가 명시적으로 거부한 경우에만 캐시 삭제
    if (err.status === 401 || err.status === 403) {
      clearUser();
      return null;
    }
    // 네트워크 에러: localStorage에 저장된 사용자 정보 그대로 유지
    return getCachedUser();
  }
}

export async function logout() {
  try {
    await request('/auth/logout', {
      method: 'POST'
    });
  } catch (err) {
    console.warn('Logout error:', err);
  } finally {
    clearUser();
  }
}

const STORAGE_KEY = 'ssu-auth-user';

export function getCachedUser() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function saveUser(user) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {}
}

export function clearUser() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
