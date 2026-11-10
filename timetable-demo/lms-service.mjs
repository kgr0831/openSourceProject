import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LmsConnection, SessionStore, collectLms, calendarEvents, LmsError, friendlyError} from '../lms-parser/index.mjs';

// The project and the personal download app share code, not login stores or jobs.
export class LmsCalendarService extends LmsConnection {
  constructor({collect = collectLms, ...options} = {}) {
    super({...options, sessionStore: options.sessionStore || (!options.createSession ? new SessionStore({
      directory: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SSU Timetable LMS'),
    }) : null)});
    this.collect = collect;
  }

  start({courseIds} = {}) {
    this.validateSelection(courseIds);
    this.jobController = new AbortController();
    this.update({notice: null, result: null, job: {phase: 'collecting', current: 0, total: courseIds.length, name: '', courseIds: [...courseIds]}});
    this.jobTask = this.runJob([...courseIds]);
  }

  async runJob(courseIds) {
    const session = this.session, controller = this.jobController;
    try {
      const client = this.createClient(session, controller.signal);
      const check = session.ensureLogin || session.checkLogin;
      if (check && !await check.call(session)) throw new LmsError('AUTH_REQUIRED', 'expired');
      client.checkCancelled?.();
      const {snapshot} = await this.collect({client, browser: session, courseIds, includeMaterials: false,
        progress: (_, detail) => { if (!controller.signal.aborted && detail) this.update({job: {...this.state.job, ...detail}}); }});
      client.checkCancelled?.();
      if (controller.signal.aborted) throw new LmsError('CANCELLED', 'cancelled');
      if (snapshot.accountKey !== this.state.accountKey) throw new LmsError('AUTH_REQUIRED', 'account changed');
      const result = {id: randomUUID(), accountKey: snapshot.accountKey, collectedAt: snapshot.collectedAt,
        courseIds, courses: snapshot.courses.map(({id, name}) => ({id, name})), events: calendarEvents(snapshot),
        warnings: snapshot.warnings.map(({courseId, stage, code}) => ({courseId, stage, code}))};
      this.update({job: {...this.state.job, phase: 'complete'}, result});
    } catch (error) {
      const cancelled = controller.signal.aborted || error.code === 'CANCELLED';
      this.update({job: {...this.state.job, phase: cancelled ? 'cancelled' : 'error',
        reconnect: ['AUTH_REQUIRED', 'BROWSER_CLOSED', 'API_REDIRECT'].includes(error.code)},
        notice: cancelled ? '가져오기를 중단했어요. 이전에 저장한 일정은 그대로예요.' : friendlyError(error)});
    } finally {
      await session?.save?.();
      if (session === this.session) this.update({remembered: Boolean(session?.remembered)});
    }
  }

  cancel() {
    if (this.state.job?.phase !== 'collecting') throw new LmsError('BUSY', 'busy');
    this.update({job: {...this.state.job, phase: 'cancelling'}});
    this.jobController.abort();
  }
}
