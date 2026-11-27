import argparse
import json
import os
import sys
from .collector import run, now_kst
from .source import Client


def main(argv=None):
    parser = argparse.ArgumentParser(description='SSU-PATH 공개 비교과 목록·설명 수집 (로그인 불필요)')
    parser.add_argument('--output', default=os.environ.get('SSU_COLLECTOR_OUTPUT', './output'))
    parser.add_argument('--delay', type=float, default=0.6, help='요청 간 최소 대기 초 (기본 0.6)')
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--attempts', type=int, default=3)
    parser.add_argument('--max-pages', type=int, help='샘플 수집용 페이지 상한. 미완료이면 종료 코드 2')
    parser.add_argument('--detail-limit', type=int, help='샘플 수집용 상세 요청 상한')
    parser.add_argument('--refresh-days', type=int, default=7, help='활동 종료 후 상세 재확인 일수')
    parser.add_argument('--include-archived-details', action='store_true', help='과거 종료 프로그램의 상세도 요청')
    args = parser.parse_args(argv)
    if (not 0.2 <= args.delay <= 60 or not 1 <= args.timeout <= 120 or not 1 <= args.attempts <= 5 or
        args.refresh_days < 0 or (args.max_pages is not None and args.max_pages < 1) or
        (args.detail_limit is not None and args.detail_limit < 0)):
        parser.error('대기·제한 설정 범위를 확인해 주세요.')

    def emit(**event):
        print(json.dumps({'at': now_kst(), **event}, ensure_ascii=False), file=sys.stderr, flush=True)

    try:
        result = run(Client(args.delay, args.timeout, args.attempts), args.output,
                     max_pages=args.max_pages, detail_limit=args.detail_limit, refresh_days=args.refresh_days,
                     include_archived_details=args.include_archived_details, emit=emit)
        print(json.dumps({'output': os.path.abspath(args.output), **result['run']}, ensure_ascii=False))
        return 0 if result['run']['outcome'] == 'success' else 2
    except KeyboardInterrupt:
        emit(event='cancelled', message='중단했습니다. 마지막으로 저장된 파일은 유지됩니다.')
        return 130
    except Exception as error:
        emit(event='failed', message=str(error))
        return 1


if __name__ == '__main__':
    sys.exit(main())
