import {campusWalkingRoutes, usableEstimate} from './campus-walking-routes.mjs';

const online = /온라인|비대면|원격|사이버|이러닝|e[- ]?러닝|e[- ]?learning|\bonline\b|\bzoom\b/i;
const routeKey = (from, to) => JSON.stringify([from, to]);

function classroom(section, index) {
  const value = section.locations?.[index];
  const location = typeof value === 'string' ? value.trim() : '';
  const lectureType = (section.lectureType ?? '').replaceAll('비대면', '온라인');
  const onlineOnly = !lectureType.includes('대면') && (online.test(lectureType) || lectureType.includes('녹화'));
  if (!location || onlineOnly || online.test(location) || location.includes(' / ')) return null;

  const match = /^(.+?)\s+(\d+)(-\d+)?(?=\s*(?:\(|$))/.exec(location);
  const room = match ? match[2] + (match[3] ?? '') : null;
  const floor = match?.[2][2];
  const label = match?.[1] ?? location;
  const building = label === '한경직기념관 소예배실' ? '한경직기념관' : label;
  return {building, room, floorMinutes: floor === undefined ? null : Number(floor) <= 3 ? 1 : 2};
}

function evaluateGap(from, to, gapMinutes, route) {
  if (route.sourceKind === 'osm_walk' && !usableEstimate(route)) return null;
  const {walkMinutes, advisoryMaxGapMinutes} = route;
  if (!Number.isFinite(walkMinutes) || walkMinutes < 0) {
    return gapMinutes <= advisoryMaxGapMinutes ? {kind: 'advisory'} : null;
  }

  const sameBuilding = from.building === to.building;
  if (!sameBuilding && (from.floorMinutes === null || to.floorMinutes === null)) return null;
  const estimatedMinutes = sameBuilding ? walkMinutes : from.floorMinutes + walkMinutes + to.floorMinutes;
  const spareMinutes = gapMinutes - estimatedMinutes;
  if (spareMinutes >= 3) return null;
  const warning = {kind: spareMinutes < 0 ? 'short' : 'tight', estimatedMinutes, spareMinutes};
  if (route.sourceKind) warning.sourceKind = route.sourceKind;
  return warning;
}

export function travelWarnings(sections, routes = campusWalkingRoutes) {
  const days = Array.from({length: 7}, () => []);
  for (const section of sections) {
    for (const [index, [day, start, end]] of section.meetings.entries()) {
      days[day].push({start, end, place: classroom(section, index)});
    }
  }
  const routesByDirection = new Map(routes.map(route => [routeKey(route.from, route.to), route]));
  return days.flatMap((events, day) => {
    events.sort((a, b) => a.start - b.start || a.end - b.end);
    const warnings = [];
    for (let i = 1; i < events.length; i++) {
      const previous = events[i - 1], next = events[i];
      const gapMinutes = next.start - previous.end;
      const from = previous.place, to = next.place;
      if (gapMinutes < 0 || gapMinutes >= 30 || !from || !to) continue;
      if (from.building === to.building && (!from.room || !to.room || from.room === to.room)) continue;

      const route = routesByDirection.get(routeKey(from.building, to.building));
      if (!route) continue;
      const warning = evaluateGap(from, to, gapMinutes, route);
      if (warning) warnings.push({day, fromEnd: previous.end, toStart: next.start,
        fromBuilding: from.building, toBuilding: to.building, gapMinutes, ...warning});
    }
    return warnings;
  });
}
