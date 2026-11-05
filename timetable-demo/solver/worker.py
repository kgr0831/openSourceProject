"""One UTF-8 JSON request on stdin, one JSON response on stdout; no shell."""
import json
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

try:
    from engine import run
except ImportError:
    print(json.dumps({'error': {'code': 'ENGINE_UNAVAILABLE', 'message': 'OR-Tools가 설치되지 않았습니다. npm run setup:solver를 실행해 주세요.'}}, ensure_ascii=False))
    sys.exit(1)

try:
    raw = sys.stdin.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError('솔버 입력이 너무 큽니다.')
    result = run(json.loads(raw))
except (ValueError, TypeError, KeyError) as error:
    result = {'error': {'code': 'INVALID_INPUT', 'message': str(error)}}
except Exception as error:
    print(type(error).__name__, file=sys.stderr)
    result = {'error': {'code': 'ENGINE_ERROR', 'message': 'CP-SAT 엔진 실행 중 오류가 발생했습니다.'}}
print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':')))
if 'error' in result:
    sys.exit(1)
