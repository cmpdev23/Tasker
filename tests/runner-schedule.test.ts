import assert from "node:assert/strict";
import { test } from "node:test";
import { latestDueOccurrence, localOccurrence } from "../backend/scheduler/schedule";
import type { TaskDefinition } from "../src/types/tasks";

type Schedule = TaskDefinition["schedule"];
const daily: Schedule = { type: "daily", timezone: "America/Toronto", time: "07:00" };
function due(schedule: Schedule, after: string, now: string) {
  return latestDueOccurrence(schedule, new Date(after), new Date(now));
}

test("manual schedules never produce occurrences", () => {
  assert.equal(due({ type: "manual", timezone: "UTC" }, "2020-01-01Z", "2026-09-10Z"), null);
});

test("once uses the explicit instant, with exclusive after and inclusive now", () => {
  const schedule: Schedule = { type: "once", timezone: "Asia/Tokyo", startsAt: "2026-09-10T07:00:00-04:00" };
  assert.equal(due(schedule, "2026-09-09Z", "2026-09-10T10:59:59.999Z"), null);
  assert.equal(due(schedule, "2026-09-09Z", "2026-09-10T11:00:00Z"), "2026-09-10T11:00:00.000Z");
  assert.equal(due(schedule, "2026-09-10T11:00:00Z", "2026-09-11Z"), null);
});

test("daily returns only the latest missed occurrence after a long outage", () => {
  assert.equal(due(daily, "2020-01-01Z", "2026-09-10T18:00:00Z"), "2026-09-10T11:00:00.000Z");
  assert.equal(due(daily, "2026-09-08Z", "2026-09-10T10:59:59Z"), "2026-09-09T11:00:00.000Z");
  assert.equal(due(daily, "2026-09-10T11:00:00Z", "2026-09-10T18:00:00Z"), null);
  assert.equal(due(daily, "2026-09-09Z", "2026-09-10T11:00:00Z"), "2026-09-10T11:00:00.000Z");
});

test("weekly uses local weekdays and catches up the latest selected day", () => {
  const schedule: Schedule = { ...daily, type: "weekly", days: ["monday", "wednesday", "friday"] };
  assert.equal(due(schedule, "2020-01-01Z", "2026-09-10T18:00:00Z"), "2026-09-09T11:00:00.000Z");
  assert.equal(due(schedule, "2026-09-09T11:00:00Z", "2026-09-11T10:59:00Z"), null);
  assert.equal(due({ type: "weekly", days: ["monday"], time: "00:30", timezone: "Asia/Tokyo" },
    "2026-09-01Z", "2026-09-06T16:00:00Z"), "2026-09-06T15:30:00.000Z");
});

test("recurring startsAt excludes earlier occurrences and includes an exact start", () => {
  assert.equal(due({ ...daily, startsAt: "2026-09-10T11:00:00Z" }, "2020-01-01Z", "2026-09-10T11:00:00Z"), "2026-09-10T11:00:00.000Z");
  assert.equal(due({ ...daily, startsAt: "2026-09-10T11:00:01Z" }, "2020-01-01Z", "2026-09-10T18:00:00Z"), null);
});

test("local conversion handles UTC date boundaries and fractional-hour zones", () => {
  assert.equal(localOccurrence("2026-09-10", "00:00", "Asia/Kathmandu")?.toISOString(), "2026-09-09T18:15:00.000Z");
  assert.equal(localOccurrence("2026-09-10", "23:30", "America/Toronto")?.toISOString(), "2026-09-11T03:30:00.000Z");
});

test("spring DST skips nonexistent local times and resumes next day", () => {
  const schedule = { ...daily, time: "02:30" };
  assert.equal(localOccurrence("2026-03-08", "02:30", "America/Toronto"), null);
  assert.equal(due(schedule, "2026-03-07T07:30:00Z", "2026-03-08T12:00:00Z"), null);
  assert.equal(due(schedule, "2026-03-07T07:30:00Z", "2026-03-09T12:00:00Z"), "2026-03-09T06:30:00.000Z");
});

test("weekly catchup reaches the previous valid week when this week's local time does not exist", () => {
  const schedule: Schedule = { ...daily, type: "weekly", days: ["sunday"], time: "02:30" };
  assert.equal(due(schedule, "2026-02-01T00:00:00Z", "2026-03-14T12:00:00Z"), "2026-03-01T07:30:00.000Z");
});

test("fall DST runs a repeated local hour once, at its first occurrence", () => {
  const schedule = { ...daily, time: "01:30" };
  assert.equal(localOccurrence("2026-11-01", "01:30", "America/Toronto")?.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(due(schedule, "2026-10-31T05:30:00Z", "2026-11-01T06:45:00Z"), "2026-11-01T05:30:00.000Z");
  assert.equal(due(schedule, "2026-11-01T05:30:00Z", "2026-11-01T06:45:00Z"), null);
});
