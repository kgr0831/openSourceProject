import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {HttpClient} from './http.mjs';
import {loadCourses} from './collect.mjs';
import {cleanText, stableId} from './parse.mjs';
import {LmsError, friendlyError} from './errors.mjs';
import {SessionStore} from './session-store.mjs';

// Shared connection lifecycle; no HTTP listener, UI, downloads or exports.
export class LmsConnection {
  constructor({createSession, createClient, sessionStore, loginInterval = 1200, demo = false} = {}) {
    this.sessionStore = sessionStore || (!createSession ? new SessionStore() : null);
    this.createSession = createSession || (async () => (await import('./browser.mjs')).browserSession({channel: 'auto', store: this.sessionStore}));
    this.createClient = createClient || ((session, signal) => new HttpClient({cookies: session.cookies,
      receiveCookies: session.receiveCookies, refreshAuth: session.ensureLogin, learningxAuth: session.learningxAuth, signal}));
    this.loginInterval = loginInterval;
    this.session = null; this.generation = 0; this.resultDirectory = null;
    this.state = {revision: 0, instanceId: randomUUID(), accountKey: null, demo, connection: 'disconnected', remembered: false, courses: [], notice: null, job: null, result: null};
  }

  update(patch) { Object.assign(this.state, patch); this.state.revision++; }
  view() { return structuredClone(this.state); }
  get running() { return ['collecting', 'downloading', 'exporting', 'cancelling'].includes(this.state.job?.phase); }

  resume() { this.connect({interactive: false}); }

  connect({interactive = true} = {}) {
    if (this.running || ['restoring', 'opening', 'waiting', 'checking', 'loading', 'background', 'disconnecting'].includes(this.state.connection)) throw new LmsError('BUSY', 'busy');
    const generation = ++this.generation;
    this.loginController?.abort(); this.loginController = new AbortController();
    const previous = this.session; this.session = null;
    this.resultDirectory = null;
    this.update({connection: 'restoring', accountKey: null, courses: [], notice: null, job: null, result: null});
    this.loginTask = this.runConnection(generation, previous, this.loginController, interactive);
  }

  async runConnection(generation, previous, controller, interactive) {
    try {
      await previous?.close().catch(() => {});
      if (generation !== this.generation) return;
      const session = await this.createSession();
      if (generation !== this.generation) { await session.close(); return; }
      this.session = session;
      const restored = await session.restore?.();
      if (generation !== this.generation) return;
      if (restored) { await this.finishConnection(session, generation, controller); return; }
      if (!interactive) {
        const notice = session.storageWarning ? friendlyError({code: 'SESSION_STORAGE'}) : session.hadSavedLogin ? friendlyError({code: 'AUTH_REQUIRED'}) : null;
        await session.close();
        if (generation !== this.generation) return;
        this.session = null;
        this.update({connection: 'disconnected', remembered: Boolean(session.hadSavedLogin), notice});
        return;
      }
      this.update({connection: 'opening'});
      await session.openLogin();
      if (generation !== this.generation) return;
      this.update({connection: 'waiting'});
      const deadline = Date.now() + 10 * 60 * 1000;
      while (generation === this.generation && Date.now() < deadline) {
        const identity = !this.manualChecking && await session.checkLogin();
        if (generation !== this.generation) return;
        if (identity) {
          await this.finishConnection(session, generation, controller);
          return;
        }
        await delay(this.loginInterval, undefined, {signal: controller.signal});
      }
      if (generation === this.generation) throw new LmsError('AUTH_REQUIRED', 'timeout');
    } catch (error) {
      if (generation !== this.generation) return;
      const session = this.session; this.session = null;
      await session?.close().catch(() => {});
      if (generation !== this.generation) return;
      this.update({connection: 'error', notice: friendlyError(error)});
    }
  }

  async finishConnection(session, generation, controller) {
    this.update({connection: 'background', notice: null});
    await session.useInBackground?.();
    if (generation !== this.generation) return;
    this.update({connection: 'loading'});
    const client = this.createClient(session, controller.signal);
    const {user, rawCourses, warnings} = await loadCourses({client, browser: session});
    if (generation !== this.generation) return;
    const courses = rawCourses.filter(row => /^\d+$/.test(String(row.id)) && row.name).map(row => ({
      id: String(row.id), name: cleanText(row.name), code: cleanText(row.course_code),
      termId: row.term?.id ? String(row.term.id) : '', termName: cleanText(row.term?.name) || '학기 정보 없음',
    }));
    if (!courses.length) throw new LmsError('NO_COURSES', 'empty');
    await session.save?.();
    if (generation !== this.generation) return;
    this.update({connection: 'connected', accountKey: stableId(client.canvas, String(user.id)), remembered: Boolean(session.remembered), courses,
      notice: session.storageWarning ? friendlyError({code: 'SESSION_STORAGE'}) : warnings.length ? '학교 화면에서 과목을 확인했어요. 일부 상세 자료는 가져오지 못할 수 있어요.' : null});
  }

  async confirmLogin() {
    if (this.state.connection !== 'waiting' || !this.session || this.manualChecking) throw new LmsError('BUSY', 'busy');
    const generation = this.generation;
    this.manualChecking = true; this.update({connection: 'checking', notice: null});
    try { await this.session.completeLogin(); }
    catch (error) { if (generation === this.generation) this.update({notice: friendlyError(error)}); }
    finally {
      this.manualChecking = false;
      if (generation === this.generation) this.update({connection: 'waiting'});
    }
  }

  async focusLogin() {
    if (!this.session) throw new LmsError('NOT_CONNECTED', 'missing');
    await this.session.focusLogin();
  }

  async disconnect({forget = false} = {}) {
    if (this.running || this.state.connection === 'disconnecting') throw new LmsError('BUSY', 'busy');
    ++this.generation; this.loginController?.abort();
    const session = this.session; this.session = null;
    this.resultDirectory = null;
    this.update({connection: 'disconnecting', accountKey: null, courses: [], notice: null, job: null, result: null});
    await session?.close().catch(() => {});
    try { if (forget) await this.sessionStore?.clear(); }
    catch { this.update({connection: 'error', remembered: true, notice: '저장된 로그인을 지우지 못했어요. 다시 시도해 주세요.'}); return; }
    this.update({connection: 'disconnected', remembered: forget ? false : Boolean(session?.remembered || this.state.remembered)});
  }

  validateSelection(courseIds) {
    if (this.running) throw new LmsError('BUSY', 'busy');
    if (this.state.connection !== 'connected' || !this.session) throw new LmsError('NOT_CONNECTED', 'missing');
    if (!Array.isArray(courseIds) || !courseIds.length || courseIds.length > this.state.courses.length ||
      new Set(courseIds).size !== courseIds.length || courseIds.some(id => !this.state.courses.some(course => course.id === id))) throw new LmsError('SELECTION', 'invalid');
  }

  async close() {
    ++this.generation; this.loginController?.abort(); this.jobController?.abort();
    await this.session?.close().catch(() => {}); this.session = null;
    await Promise.allSettled([this.jobTask, this.loginTask]);
  }
}
