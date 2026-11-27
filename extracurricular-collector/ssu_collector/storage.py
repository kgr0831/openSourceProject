import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        os.fchmod(handle, 0o640)  # A separate web service may read via the collector group.
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_snapshot(path):
    path = Path(path)
    if not path.exists():
        return None
    with path.open(encoding='utf-8') as source:
        value = json.load(source)
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('source') != 'ssu-path-public' or not isinstance(value.get('programs'), list):
        raise ValueError('기존 저장 파일의 형식·버전을 확인해 주세요. 덮어쓰지 않습니다.')
    ids = []
    for item in value['programs']:
        if (not isinstance(item, dict) or not isinstance(item.get('id'), str) or
            item['id'] != 'ssu-path:' + str(item.get('sourceId', '')) or
            not isinstance(item.get('title'), str) or not item['title'] or
            not isinstance(item.get('sourceStatus'), str)):
            raise ValueError('기존 프로그램 ID가 유효하지 않습니다.')
        ids.append(item['id'])
    if len(set(ids)) != len(ids):
        raise ValueError('기존 저장 파일에 중복 ID가 있습니다.')
    return value


@contextmanager
def collection_lock(directory):
    # Kernel-owned lock releases on crashes; never remove a possibly active lock file.
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if os.name != 'posix':
        raise RuntimeError('예약 수집은 Linux/macOS 또는 WSL에서 실행해 주세요.')
    import fcntl
    with (directory / '.collector.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('같은 저장 경로의 수집기가 이미 실행 중입니다.') from error
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
