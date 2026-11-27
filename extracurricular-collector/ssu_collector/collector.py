import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .source import SourceError, DetailUnavailable
from .storage import atomic_json, load_snapshot, collection_lock

KST = timezone(timedelta(hours=9))


def now_kst():
    return datetime.now(KST).isoformat(timespec='seconds')


def classify(item, today):
    warnings = []
    start, end = item.get('applicationStartDate'), item.get('applicationEndDate')
    source = item['sourceStatus']
    if start and end and start > end:
        return 'unknown', ['신청기간 역전: 원문 확인 필요']
    if not start or not end:
        warnings.append('신청기간 날짜 미확인: 원문 확인 필요')
    if end and end < today:
        if source in ('신청중', '접수중', '모집중'):
            warnings.append('원문 신청중 표기와 신청 종료일 불일치')
        return 'closed', warnings
    if any(s in source for s in ('마감', '종료', '취소')):
        return 'closed', warnings
    if start and start > today:
        return 'upcoming', warnings
    if source in ('신청중', '접수중', '모집중'):
        return 'open', warnings
    if '예정' in source or '대기' in source:
        return 'upcoming', warnings
    return 'unknown', warnings


def content_hash(item):
    # Ordinal list numbers move when the website inserts/deletes posts.
    content = {k: v for k, v in item.items() if k not in {
        'firstSeenAt', 'lastSeenAt', 'lastDetailSuccessAt', 'lastDetailAttemptAt', 'lastChangedAt',
        'contentHash', 'detailError', 'listNumber'}}
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def collect(client, previous=None, *, timestamp=None, max_pages=None, detail_limit=None,
            refresh_days=7, include_archived_details=False, emit=lambda **event: None):
    timestamp = timestamp or now_kst()
    today = datetime.fromisoformat(timestamp).astimezone(KST).date().isoformat()
    previous_items = copy.deepcopy(previous['programs']) if previous else []
    old = {p['id']: p for p in previous_items}
    first = client.list(1)
    if first['pages'] > 2000:
        raise SourceError('목록 페이지 수가 안전 한도를 초과했습니다.')
    page_count = min(first['pages'], max_pages) if max_pages else first['pages']
    complete = page_count == first['pages']
    inventory = {}
    for page in range(1, page_count + 1):
        result = first if page == 1 else client.list(page)
        if result['pages'] != first['pages'] or result['total'] != first['total']:
            raise SourceError('수집 중 목록 크기가 바뀌었습니다. 기존 파일을 유지하고 다시 실행하세요.')
        for item in result['items']:
            if item['id'] in inventory:
                raise SourceError('목록 페이지 사이에 중복 ID가 있습니다. 페이지 이동 중 변경 여부를 확인하세요.')
            inventory[item['id']] = item
        emit(event='list_page', page=page, pages=first['pages'], collected=len(inventory))
    if complete:
        if len(inventory) != first['total']:
            raise SourceError('전체 목록 수와 고유 프로그램 수가 다릅니다. 기존 파일은 유지합니다.')
        check = client.list(1)
        if check['total'] != first['total'] or check['items'] != first['items']:
            raise SourceError('수집 중 첫 페이지가 변경되었습니다. 기존 파일은 유지합니다.')
    counters = {'new': 0, 'updated': 0, 'unchanged': 0, 'detailAttempts': 0,
                'detailFailures': 0, 'detailUnavailable': 0, 'detailDeferred': 0, 'unlisted': 0}
    programs = []
    emit(event='detail_phase', observedPrograms=len(inventory), inventoryComplete=complete)
    for id_, item in inventory.items():
        prior = old.get(id_, {})
        merged = {**prior, **item, 'firstSeenAt': prior.get('firstSeenAt', timestamp),
                  'lastSeenAt': timestamp, 'presentInLatestInventory': True}
        status, warnings = classify(merged, today)
        if item.get('activityStartDate') and item.get('activityEndDate') and item['activityStartDate'] > item['activityEndDate']:
            warnings.append('활동기간 역전: 원문 확인 필요')
        merged.update(effectiveStatus=status, warnings=warnings)
        cutoff = (datetime.fromisoformat(timestamp).astimezone(KST).date() - timedelta(days=refresh_days)).isoformat()
        recent = item.get('activityEndDate') and item['activityEndDate'] >= cutoff
        wanted = include_archived_details or status in ('open', 'upcoming') or bool(recent)
        if wanted:
            if detail_limit is not None and counters['detailAttempts'] >= detail_limit:
                counters['detailDeferred'] += 1
                merged['detailState'] = 'deferred'
            else:
                counters['detailAttempts'] += 1
                merged['lastDetailAttemptAt'] = timestamp
                try:
                    merged['detail'] = client.detail(item)
                    merged.update(detailState='ok', lastDetailSuccessAt=timestamp)
                    merged.pop('detailError', None)
                except DetailUnavailable as error:
                    counters['detailUnavailable'] += 1
                    merged['detailState'] = 'unavailable_cached' if prior.get('detail') else 'unavailable'
                    merged['detailError'] = str(error)
                    emit(event='detail_unavailable', programId=id_, message=str(error))
                except (SourceError, ValueError) as error:
                    counters['detailFailures'] += 1
                    merged['detailState'] = 'stale' if prior.get('detail') else 'failed'
                    merged['detailError'] = str(error)
                    emit(event='detail_failed', programId=id_, message=str(error))
                if counters['detailAttempts'] % 10 == 0:
                    emit(event='detail_progress', attempts=counters['detailAttempts'], failures=counters['detailFailures'])
        else:
            merged['detailState'] = 'archived_cached' if prior.get('detail') else 'not_requested_archived'
        merged['contentHash'] = content_hash(merged)
        if not prior:
            counters['new'] += 1
            merged['lastChangedAt'] = timestamp
        elif merged['contentHash'] != prior.get('contentHash'):
            counters['updated'] += 1
            merged['lastChangedAt'] = timestamp
        else:
            counters['unchanged'] += 1
        programs.append(merged)
    # Never delete absent programs. Only a full scan can mark a program no longer listed.
    for id_, prior in old.items():
        if id_ not in inventory:
            if complete:
                previous_hash = prior.get('contentHash')
                prior.update(presentInLatestInventory=False, effectiveStatus='unlisted',
                             warnings=['이번 전체 목록에서 미확인. 삭제·종료로 단정하지 말고 원문 확인 필요'])
                prior['contentHash'] = content_hash(prior)
                if prior['contentHash'] != previous_hash:
                    prior['lastChangedAt'] = timestamp
                counters['unlisted'] += 1
            programs.append(prior)
    programs.sort(key=lambda p: p['id'])
    outcome = 'success' if complete and not counters['detailFailures'] and not counters['detailDeferred'] else 'partial'
    return {'schemaVersion': 1, 'source': 'ssu-path-public', 'collectedAt': timestamp,
            'lastSuccessfulRunAt': timestamp if outcome == 'success' else (previous or {}).get('lastSuccessfulRunAt'),
            'run': {'outcome': outcome, 'inventoryComplete': complete, 'sourceTotal': first['total'],
                    'listPagesVisited': page_count, 'observedPrograms': len(inventory), **counters},
            'programs': programs}


def run(client, output, **options):
    output = Path(output)
    with collection_lock(output):
        try:
            previous = load_snapshot(output / 'programs.json')
            result = collect(client, previous, **options)
            if previous:
                atomic_json(output / 'programs.previous.json', previous)
            atomic_json(output / 'programs.json', result)
            atomic_json(output / 'last-run.json', {'collectedAt': result['collectedAt'], **result['run']})
            return result
        except Exception as error:
            atomic_json(output / 'last-run.json', {'outcome': 'failed', 'finishedAt': now_kst(), 'error': str(error)})
            raise
