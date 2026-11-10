export class LmsError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'LmsError';
    this.code = code;
    this.status = status;
  }
}

// Never forward fetch/Playwright errors: they can contain cookies or signed URLs.
export function publicError(error) {
  return error instanceof LmsError
    ? {code: error.code, message: error.message, status: error.status}
    : {code: 'UNEXPECTED', message: '처리하지 못했습니다. 연결과 출력 폴더를 확인해 주세요.', status: null};
}

export function friendlyError(error) {
  const messages = {
    BROWSER: 'Chrome 또는 Microsoft Edge를 설치한 뒤 다시 연결해 주세요.',
    BROWSER_CLOSED: '학교 연결이 끊겼어요. 다시 연결해 주세요.',
    AUTH_REQUIRED: '학교 로그인이 만료되었어요. 다시 연결해 주세요.',
    SESSION_STORAGE: '이 PC에 로그인 상태를 보관하지 못했어요. 다음 실행 때 다시 연결해 주세요.',
    API_REDIRECT: '학교 로그인 시간이 만료되었어요. 다시 연결해 주세요.',
    NETWORK: '인터넷 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.',
    NO_COURSES: '수강 과목을 찾지 못했어요. LMS에서 과목이 보이는지 확인한 뒤 다시 연결해 주세요.',
    SELECTION: '가져올 과목을 하나 이상 선택해 주세요.',
    COURSE_NOT_FOUND: '수강 목록이 바뀌었어요. 다시 연결한 뒤 과목을 선택해 주세요.',
    BUSY: '진행 중인 작업을 마치거나 중단한 뒤 다시 시도해 주세요.',
    NOT_CONNECTED: '먼저 학교 계정을 연결해 주세요.',
    FOLDER: '폴더를 열지 못했어요. 파일 탐색기의 다운로드 폴더에서 LMS 모아를 찾아 주세요.',
    NO_RESULT: '아직 저장된 결과가 없어요. 과목을 선택하고 저장해 주세요.',
    OPTIONS: '저장할 내용을 다시 선택해 주세요.',
  };
  return messages[error?.code] || '작업을 마치지 못했어요. 인터넷 연결과 저장 공간을 확인한 뒤 다시 시도해 주세요.';
}
