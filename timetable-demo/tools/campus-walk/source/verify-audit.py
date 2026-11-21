"""Recompute the outdoor reference table from the bundled directed OSM graph. Python 3.8+."""
from collections import Counter, defaultdict
from pathlib import Path
from heapq import heappop, heappush
from math import ceil, cos, hypot, radians
import json

def shortest_from(start, graph):
    best = {start: 0.0}
    queue = [(0.0, start)]
    while queue:
        cost, node = heappop(queue)
        if cost > best[node]:
            continue
        for other, length in graph[node]:
            next_cost = cost + length
            if next_cost < best.get(other, float('inf')):
                best[other] = next_cost
                heappush(queue, (next_cost, other))
    return best

def main():
    package = Path(__file__).resolve().parents[1]
    data = json.loads((package/'data/campus-walk.json').read_text(encoding='utf-8'))
    raw = json.loads((package/'source/pedestrian-graph.json').read_text(encoding='utf-8'))
    graph = defaultdict(list)
    for a,b,meters in raw['edges']:
        graph[a].append((b,meters))
    buildings = data['buildings']
    routes = {(r['from'],r['to']):r for r in data['routes']}
    expected = {(a['building'],b['building']) for a in buildings for b in buildings if a != b}
    assert set(routes) == expected and len(routes) == len(data['routes']) == 552 and len(buildings) == 24
    lat_scale = 6371008.8*radians(1)
    lon_scale = lat_scale*cos(radians(37.496))
    for a in buildings:
        costs = shortest_from(a['networkNode'],graph)
        for b in buildings:
            if a == b:
                continue
            r = routes[a['building'],b['building']]
            network = costs[b['networkNode']]
            length = a['connectorMeters'] + network + b['connectorMeters']
            chord = hypot((a['networkLat']-b['networkLat'])*lat_scale,(a['networkLng']-b['networkLng'])*lon_scale)
            quality = 'shared_access' if network < 1 else 'detour_review' if network > 150 and network > 3*max(chord,1) else 'modeled'
            assert (round(length),ceil(length/data['walkingMetersPerMinute']),quality) == (r['osmMeters'],r['osmMinutes'],r['quality']), r
    print('Verified',len(buildings),'buildings,',len(routes),'directed routes.')
    print(dict(Counter(r['quality'] for r in routes.values())))
    print('Culture Hall -> Information Sciences Building:',routes['문화관','정보과학관']['osmMeters'],'m')

if __name__ == '__main__':
    main()
