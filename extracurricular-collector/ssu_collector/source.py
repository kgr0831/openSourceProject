import re
import time
import ssl
from html.parser import HTMLParser
from html import escape, unescape
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ORIGIN = 'https://path.ssu.ac.kr'
LIST_PATH = '/ptfol/imng/icmpNsbjtPgm/dialog/nsbjtPgmList.do'
DETAIL_PATH = '/ptfol/imng/icmpNsbjtPgm/dialog/nsbjtPgmInfo.do'


class SourceError(RuntimeError):
    pass


class DetailUnavailable(SourceError):
    """The public page explicitly says this program cannot be viewed."""
    pass


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def find(self, tag):
        return [n for n in self.walk() if n.tag == tag]

    def walk(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.walk()

    def text(self):
        if self.tag in ('script', 'style'):
            return ''
        # Join inline nodes without inventing spaces; block boundaries are spaces.
        block = {'p', 'div', 'br', 'li', 'dt', 'dd', 'th', 'td', 'tr', 'h4', 'ul', 'dl'}
        s = ''.join(c.text() if isinstance(c, Node) else c for c in self.children)
        return (' ' + s + ' ') if self.tag in block else s


class Tree(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'wbr'}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def text(node):
    return re.sub(r'\s+', ' ', node.text()).strip()


def date_range(value):
    from datetime import date
    matches = re.findall(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', value)
    dates = []
    for y, m, d in matches:
        try:
            dates.append(date(int(y), int(m), int(d)).isoformat())
        except ValueError as error:
            raise SourceError('원문 날짜가 유효하지 않습니다: ' + value) from error
    return (dates[0], dates[1]) if len(dates) == 2 else (None, None)


def detail_url(source_id):
    return ORIGIN + DETAIL_PATH + '?' + urlencode({'encSddpbSeq': source_id})


def parse_list(html):
    # The school's old records sometimes interpolate quotes/<...> into title
    # attributes without HTML escaping. Rebuild only the known program anchor,
    # from its explicit ID and plaintext label, before parsing the table.
    anchor = re.compile(r'<a\b(?P<attrs>(?:(?!</?(?:td|tr|table)\b).)*?)\bdata-enc-sddpb-seq="(?P<id>[A-Za-z0-9_-]+)"[^>]*>(?P<label>.*?)</a>', re.I | re.S)
    def repair(match):
        if 'nsbjtPgmInfoBtn' not in match['attrs']:
            return match[0]
        return '<a data-enc-sddpb-seq="' + match['id'] + '">' + escape(unescape(match['label']), quote=False) + '</a>'
    html = anchor.sub(repair, html)
    root = Tree(html).root
    table = next((t for t in root.find('table') if '비교과 프로그램 모집공고 조회' in text(t)), None)
    if table is None:
        raise SourceError('공개 목록 표를 찾지 못했습니다. 로그인 전환 또는 학교 페이지 변경을 확인하세요.')
    headers = [re.sub(r'\s+', '', text(h)) for h in table.find('th')]
    if headers != ['번호', '년도', '학기', '운영부서', '프로그램명', '신청기간', '교육(활동)기간', '신청상태']:
        raise SourceError('공개 목록 열 제목 또는 순서가 변경되었습니다.')
    plain = text(root)
    total = re.search(r'총게시물\s*([\d,]+)', plain)
    pages = re.search(r'페이지\s*(\d+)\s*/\s*(\d+)', plain)
    if not total or not pages:
        raise SourceError('목록 페이지 수를 확인하지 못했습니다.')
    items = []
    for row in table.find('tr'):
        cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'td']
        anchors = [a for a in row.find('a') if a.attrs.get('data-enc-sddpb-seq')]
        if not anchors:
            if cells and not any(s in text(row) for s in ('없습니다', '없음')):
                raise SourceError('프로그램 식별자가 없는 목록 행입니다.')
            continue
        if len(cells) != 8 or len(anchors) != 1:
            raise SourceError('프로그램 목록 열 구조가 변경되었습니다.')
        values = [text(c) for c in cells]
        source_id = anchors[0].attrs['data-enc-sddpb-seq']
        if not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', source_id) or not text(anchors[0]):
            raise SourceError('공개 프로그램 식별자 또는 제목이 유효하지 않습니다.')
        application_start, application_end = date_range(values[5])
        activity_start, activity_end = date_range(values[6])
        items.append({'id': 'ssu-path:' + source_id, 'source': 'ssu-path', 'sourceId': source_id,
                      'listNumber': values[0], 'year': values[1], 'semester': values[2],
                      'department': values[3], 'title': text(anchors[0]),
                      'applicationPeriod': values[5], 'applicationStartDate': application_start,
                      'applicationEndDate': application_end, 'activityPeriod': values[6],
                      'activityStartDate': activity_start, 'activityEndDate': activity_end,
                      'sourceStatus': values[7], 'sourceUrl': detail_url(source_id),
                      'applicationUrl': ORIGIN + '/', 'listUrl': ORIGIN + LIST_PATH})
    result = {'items': items, 'total': int(total[1].replace(',', '')),
              'page': int(pages[1]), 'pages': int(pages[2])}
    if (result['total'] and not items) or result['pages'] < 1:
        raise SourceError('비어 있거나 잘못된 프로그램 목록입니다.')
    return result


def parse_detail(html, expected_title):
    html = re.sub(r'(<h4\b[^>]*>)(.*?)(</h4>)', lambda m: m[1] + escape(unescape(m[2]), quote=False) + m[3], html, flags=re.I | re.S)
    root = Tree(html).root
    if any('NO_RESULT' in (n.attrs.get('class') or '').split() and
           '조회할 수 없는 프로그램' in text(n) for n in root.walk()):
        raise DetailUnavailable('학교가 공개 상세를 조회 불가로 응답했습니다. 목록 정보만 보존합니다.')
    titles = root.find('h4')
    tables = [t for t in root.find('table') if '비교과 프로그램 상세정보' in text(t)]
    if len(titles) != 1 or len(tables) != 1 or text(titles[0]) != expected_title:
        raise SourceError('상세 제목·표가 목록과 다릅니다. 기존 설명을 보존합니다.')
    fields = {}
    for row in tables[0].find('tr'):
        heads, cells = row.find('th'), row.find('td')
        if len(heads) == len(cells) == 1:
            key = text(heads[0])
            if key in fields:
                raise SourceError('상세 정보에 중복 항목이 있습니다.')
            fields[key] = text(cells[0])
    if not any(k in fields for k in ('프로그램 목표', '프로그램 한줄 소개')):
        raise SourceError('상세 설명 항목을 찾지 못했습니다.')
    assets = []
    for node in root.walk():
        raw = node.attrs.get('src') if node.tag == 'img' else node.attrs.get('href') if node.tag == 'a' else None
        if raw:
            url = urljoin(ORIGIN, raw)
            if urlsplit(url).scheme in ('http', 'https'):
                assets.append({'url': url, 'label': text(node)})
    return {'title': expected_title, 'fields': fields, 'description': '\n'.join(dict.fromkeys(
        fields[k] for k in ('프로그램 목표', '프로그램 한줄 소개') if fields.get(k))),
        'programType': fields.get('프로그램 유형', ''), 'category': fields.get('프로그램 분류', ''),
        'target': fields.get('신청대상', ''), 'targetIdentity': fields.get('신청신분', ''),
        'targetDetails': fields.get('학생 신청대상 상세정보', ''), 'assets': assets}


class Client:
    def __init__(self, delay=0.6, timeout=30, attempts=3):
        self.delay, self.timeout, self.attempts = delay, timeout, attempts
        self.last_request = 0.0
        self.context = ssl.create_default_context()

    def fetch(self, path, params):
        url = ORIGIN + path + '?' + urlencode(params)
        for attempt in range(self.attempts):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                request = Request(url, headers={'User-Agent': 'SSU-Extracurricular-Collector/1.0', 'Accept': 'text/html'})
                with urlopen(request, timeout=self.timeout, context=self.context) as response:
                    final = urlsplit(response.url)
                    if final.scheme != 'https' or final.netloc != 'path.ssu.ac.kr' or final.path != path:
                        raise SourceError('공개 페이지가 로그인 또는 다른 주소로 이동했습니다.')
                    data = response.read(2 * 1024 * 1024 + 1)
                    if len(data) > 2 * 1024 * 1024:
                        raise SourceError('공개 페이지 응답 크기를 초과했습니다.')
                    return data.decode('utf-8-sig')
            except HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504):
                    raise SourceError(f'학교 사이트 HTTP {error.code}') from error
                retry_after = error.headers.get('Retry-After', '')
                wait = min(120, int(retry_after)) if retry_after.isdigit() else 2 ** attempt
            except (URLError, TimeoutError, OSError) as error:
                wait = 2 ** attempt
            if attempt + 1 < self.attempts:
                time.sleep(wait)
        raise SourceError('학교 사이트 요청이 재시도 후에도 실패했습니다: ' + path)

    def list(self, page):
        result = parse_list(self.fetch(LIST_PATH, {'currentPageNo': page}))
        if result['page'] != page:
            raise SourceError('요청한 페이지와 응답 페이지가 다릅니다.')
        return result

    def detail(self, item):
        return parse_detail(self.fetch(DETAIL_PATH, {'encSddpbSeq': item['sourceId']}), item['title'])
