// Time-spent report service (PLAN.md "Backend aggregate/query routes" +
// milestone 9).

import { differenceInMinutes } from 'date-fns';

import { HttpError } from '../lib/httpError.js';
import { queryAllTasksForReport, relevantDateOf } from '../lib/index/queries.js';

export class ReportServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'ReportServiceError';
  }
}

export type TimeSpentGroupBy = 'project' | 'day';

export interface TimeSpentReportInput {
  groupBy?: TimeSpentGroupBy;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, inclusive. */
  to?: string;
  includeInProgress?: boolean;
}

export interface TimeSpentGroup {
  key: string;
  label: string;
  minutes: number;
}

/**
 * Groups cumulative time spent by project or by day. The file format only
 * ever stores a cumulative `@spent` total per task, not a per-session log
 * (PLAN.md "Time tracking is automatic ... no separate start/stop
 * control"), so there's no literal "time spent on 2026-09-10" to read back —
 * each task's time is attributed to a single representative date instead:
 * `doneAt` if it's finished, else `due` if set, else the day it was
 * created. `from`/`to` filter tasks by that date; `includeInProgress` adds a
 * currently-'doing' task's live elapsed time (now - doingSince) on top of
 * its stored `spentMinutes`, so a report run mid-session isn't missing the
 * current stretch (mirrors the frontend's own live "N (tracking...)" math,
 * PLAN.md "Doing-timer transition").
 */
export function getTimeSpentReport(workspacePath: string, input: TimeSpentReportInput): TimeSpentGroup[] {
  const groupBy = input.groupBy ?? 'project';
  if (groupBy !== 'project' && groupBy !== 'day') {
    throw new ReportServiceError(`invalid groupBy "${String(input.groupBy)}", expected "project" or "day"`, 400);
  }
  const includeInProgress = input.includeInProgress ?? false;
  const now = new Date();

  const groups = new Map<string, TimeSpentGroup>();

  for (const task of queryAllTasksForReport(workspacePath)) {
    const relevantDate = relevantDateOf(task);
    if (input.from && relevantDate < input.from) continue;
    if (input.to && relevantDate > input.to) continue;

    let minutes = task.spentMinutes;
    if (includeInProgress && task.status === 'doing' && task.doingSince) {
      minutes += Math.max(0, differenceInMinutes(now, new Date(task.doingSince)));
    }
    if (minutes <= 0) continue;

    const key = groupBy === 'project' ? task.projectSlug : relevantDate;
    const label = groupBy === 'project' ? task.projectName : relevantDate;
    const existing = groups.get(key);
    if (existing) existing.minutes += minutes;
    else groups.set(key, { key, label, minutes });
  }

  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}
