import {createScheduler} from '../../schedule.mjs';
import {courses, catalogInfo} from './demo-catalog.mjs';

export const scheduler = createScheduler({courses, info: catalogInfo});
export const {defaultRequest, validateRequest, hasConflict, measure, selectDiverse, solverInput,
  generateCandidates, validateAiResult, outputSchema, intentSchema, applyIntent} = scheduler;
export {courses};
