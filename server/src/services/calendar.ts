// Calendar aggregate service (PLAN.md "Backend aggregate/query routes" +
// milestone 9). Thin: validation here, the actual query in
// lib/index/queries.ts.

import { HttpError } from '../lib/httpError.js';
import { queryCalendarMonth, type CalendarDay } from '../lib/index/queries.js';

export class CalendarServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'CalendarServiceError';
  }
}

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^(0[1-9]|1[0-2])$/;

/** `GET /api/calendar/:year/:month` — sparse per-day marks for one month. */
export function getCalendarMonth(workspacePath: string, year: string, month: string): CalendarDay[] {
  if (!YEAR_RE.test(year)) throw new CalendarServiceError(`invalid year "${year}", expected YYYY`, 400);
  if (!MONTH_RE.test(month)) throw new CalendarServiceError(`invalid month "${month}", expected 01-12`, 400);
  return queryCalendarMonth(workspacePath, year, month);
}
