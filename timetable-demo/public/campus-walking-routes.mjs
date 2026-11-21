import {walkingRouteTimes} from './walking-route-times.mjs';

const localRoutes = [
  {
    from: '문화관',
    to: '정보과학관',
    walkMinutes: null,
    source: '사용자가 이 방향으로 이동한 경험',
    measuredOn: null,
    advisoryMaxGapMinutes: 15
  }
];

export function usableEstimate(route) {
  return route.quality === 'modeled' && Number.isSafeInteger(route.walkMinutes) && route.walkMinutes > 0;
}

function priority(route) {
  if (route.sourceKind === 'osm_walk') return usableEstimate(route) ? 1 : 0;
  if (route.sourceKind === 'naver_walk') return Number.isSafeInteger(route.walkMinutes) && route.walkMinutes > 0 ? 3 : 0;
  if (Number.isFinite(route.walkMinutes) && route.walkMinutes >= 0) return 4;
  return Number.isFinite(route.advisoryMaxGapMinutes) && route.advisoryMaxGapMinutes >= 0 ? 2 : 0;
}

export function combineWalkingRoutes(existing, imported) {
  const byDirection = new Map();
  const records = imported.filter(route => route && route.from !== route.to &&
    (route.sourceKind === 'naver_walk' || route.sourceKind === 'osm_walk'));
  for (const route of [...existing, ...records]) {
    if (typeof route?.from !== 'string' || !route.from || typeof route.to !== 'string' || !route.to) continue;
    const rank = priority(route);
    if (!rank) continue;

    const key = JSON.stringify([route.from, route.to]);
    const previous = byDirection.get(key);
    const oldRank = previous ? priority(previous) : 0;
    const newerConfirmation = rank === 3 && oldRank === 3 && (route.checkedOn || '') > (previous.checkedOn || '');
    if (rank > oldRank || newerConfirmation) byDirection.set(key, route);
  }
  return [...byDirection.values()];
}

export const campusWalkingRoutes = combineWalkingRoutes(localRoutes, walkingRouteTimes);
