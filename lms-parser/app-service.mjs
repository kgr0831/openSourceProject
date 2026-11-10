import path from 'node:path';
import os from 'node:os';
import {collectLms} from './collect.mjs';
import {createOutputDirectory, downloadResources} from './download.mjs';
import {writeExport} from './export.mjs';
import {LmsError, friendlyError} from './errors.mjs';
import {LmsConnection} from './connection.mjs';
export {friendlyError} from './errors.mjs';

function issueText(code) {
  return ({FORBIDDEN: '학교에서 접근을 허용하지 않은 자료가 있어요.', AUTH_REQUIRED: '추가 로그인이 필요한 자료가 있어요.',
    NO_MEDIA: '직접 저장할 수 없는 자료가 있어요. LMS에서 확인해 주세요.', HOST_NOT_ALLOWED: '다른 자료 서버에 있는 파일은 저장하지 못했어요.',
    TOO_LARGE: '2 GB를 넘는 파일은 저장하지 않았어요.', AMBIGUOUS_DATE: '날짜를 확인할 수 없는 일정은 캘린더에서 제외했어요.',
    STREAM_ONLY: '스트리밍 전용 영상은 LMS에서 시청해 주세요.', CANCELLED: '저장을 중단했어요.',
    NOT_FOUND: 'LMS에서 사라졌거나 열 수 없는 자료가 있어요.'})[code] || '일부 자료를 가져오지 못했어요. 다시 저장하거나 LMS에서 확인해 주세요.';
}

export class LmsApp extends LmsConnection {
  constructor({collect = collectLms, download = downloadResources, exportData = writeExport,
    outputBase = path.join(os.homedir(), 'Downloads', 'LMS 모아'), ...connectionOptions} = {}) {
    super(connectionOptions);
    Object.assign(this, {collect, download, exportData, outputBase});
  }

  start({courseIds, mode = 'files'} = {}) {
    this.validateSelection(courseIds);
    if (!['none', 'files', 'all'].includes(mode)) throw new LmsError('OPTIONS', 'mode');
    this.jobController = new AbortController(); this.resultDirectory = null;
    this.update({notice: null, result: null, job: {phase: 'collecting', current: 0, total: courseIds.length, name: '', mode, courseIds, startedAt: Date.now()}});
    this.jobTask = this.runJob(courseIds, mode);
  }

  async runJob(courseIds, mode) {
    let snapshot, directory;
    const client = this.createClient(this.session, this.jobController.signal);
    const progress = (_, detail) => {
      if (this.state.job.phase !== 'cancelling' && detail) this.update({job: {...this.state.job, bytes: null, totalBytes: null, ...detail}});
    };
    try {
      const checkLogin = this.session.ensureLogin || this.session.checkLogin;
      if (checkLogin && !await checkLogin.call(this.session)) throw new LmsError('AUTH_REQUIRED', 'session expired');
      client.checkCancelled?.();
      const data = await this.collect({client, browser: this.session, courseIds, progress});
      client.checkCancelled?.(); snapshot = data.snapshot;
      directory = await createOutputDirectory(this.outputBase, snapshot.accountKey);
      this.update({job: {...this.state.job, phase: 'downloading', current: 0, total: 0, name: ''}});
      await this.download({snapshot, assets: data.assets, client, directory, mode, maxBytes: 2 * 1024 ** 3, progress});
      client.checkCancelled?.();
      this.update({job: {...this.state.job, phase: 'exporting', name: ''}});
      const counts = await this.exportData(snapshot, directory);
      this.resultDirectory = directory;
      this.update({job: {...this.state.job, phase: 'complete'}, result: this.result(snapshot, counts, mode)});
    } catch (error) {
      const cancelled = this.jobController.signal.aborted || error.code === 'CANCELLED';
      let result = null;
      if (cancelled && snapshot && directory) {
        snapshot.cancelled = true;
        try {
          const counts = await this.exportData(snapshot, directory);
          this.resultDirectory = directory; result = this.result(snapshot, counts, mode);
        } catch { /* Do not advertise result files that could not be written. */ }
      }
      this.update({job: {...this.state.job, phase: cancelled ? 'cancelled' : 'error', reconnect: ['AUTH_REQUIRED', 'BROWSER_CLOSED', 'API_REDIRECT'].includes(error.code)}, result,
        notice: cancelled ? '저장을 중단했어요. 완료된 파일은 그대로 보관됩니다.' : friendlyError(error)});
    } finally {
      const session = this.session;
      await session?.save?.();
      if (session && session === this.session) this.update({remembered: Boolean(session.remembered)});
    }
  }

  result(snapshot, counts, mode) {
    const issues = new Map();
    for (const warning of snapshot.warnings) {
      const course = snapshot.courses.find(row => row.id === warning.courseId);
      const text = issueText(warning.code), title = course?.name || '과목 목록';
      issues.set(title + text, {title, text, sourceUrl: course?.sourceUrl || 'https://lms.ssu.ac.kr'});
    }
    const streams = snapshot.resources.filter(row => row.status === 'stream_only');
    if (streams.length && mode === 'all') issues.set('streams', {title: `영상 ${streams.length}개`, text: issueText('STREAM_ONLY'), sourceUrl: 'https://lms.ssu.ac.kr'});
    return {counts, mode, collectedAt: snapshot.collectedAt, issues: [...issues.values()],
      cancelled: Boolean(snapshot.cancelled), folderLabel: '다운로드 › LMS 모아', hasSummary: counts.summaryChunks > 0};
  }

  cancel() {
    if (!['collecting', 'downloading'].includes(this.state.job?.phase)) throw new LmsError('BUSY', 'busy');
    this.update({job: {...this.state.job, phase: 'cancelling'}}); this.jobController.abort();
  }

}
