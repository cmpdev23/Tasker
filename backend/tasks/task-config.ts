import { ValidationError } from "../errors";
import { TASK_WEEKDAYS, type TaskDefinition, type TaskInput } from "../../src/types/tasks";
import { quoteToml, readBoolean, readInteger, readString } from "./toml";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length > 100 || !ID_PATTERN.test(id) || RESERVED_ID.test(id)) {
    throw new ValidationError("Invalid task ID: use a portable lowercase slug (maximum 100 characters).");
  }
}

export function taskSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "") || "task";
  return RESERVED_ID.test(slug) ? `task-${slug}` : slug;
}

function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ValidationError(`Unknown ${label} field: ${key}.`);
  }
  return value as Record<string, unknown>;
}

function validateInstant(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("startsAt must be an ISO timestamp with a timezone.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new ValidationError("startsAt must be an ISO timestamp with a timezone.");
  const [, y, m, d, h, minute, second = "0", , offset] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
      Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) ||
      !Number.isFinite(Date.parse(value))) {
    throw new ValidationError("startsAt contains an invalid date or time.");
  }
  return new Date(value).toISOString();
}

export function validateTaskInput(input: unknown): TaskInput {
  const data = object(input, "task", ["name", "enabled", "instructions", "expectChanges", "schedule"]);
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 200 || /[\x00-\x1f\x7f]/.test(data.name)) {
    throw new ValidationError("Task name must contain 1–200 characters without control characters.");
  }
  if (typeof data.instructions !== "string" || !data.instructions.trim() || data.instructions.includes("\0") || Buffer.byteLength(data.instructions, "utf8") > 1024 * 1024) {
    throw new ValidationError("Instructions must be nonempty Markdown of at most 1 MiB without NUL characters.");
  }
  if (typeof data.enabled !== "boolean" || typeof data.expectChanges !== "boolean") {
    throw new ValidationError("enabled and expectChanges must be booleans.");
  }
  const raw = object(data.schedule, "schedule", ["type", "timezone", "time", "days", "startsAt"]);
  if (!["manual", "once", "daily", "weekly"].includes(raw.type as string)) {
    throw new ValidationError("Invalid schedule type.");
  }
  if (typeof raw.timezone !== "string" || !raw.timezone || raw.timezone !== raw.timezone.trim() || /^[+-]/.test(raw.timezone)) {
    throw new ValidationError("A named IANA timezone is required.");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: raw.timezone }); }
  catch { throw new ValidationError("Invalid IANA timezone."); }
  const schedule: TaskDefinition["schedule"] = { type: raw.type as TaskDefinition["schedule"]["type"], timezone: raw.timezone };
  if (raw.type === "daily" || raw.type === "weekly") {
    if (typeof raw.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) {
      throw new ValidationError("Recurring schedules require a time in HH:mm format.");
    }
    schedule.time = raw.time;
  } else if (raw.time !== undefined) {
    throw new ValidationError("time is only supported for daily and weekly schedules.");
  }
  if (raw.type === "weekly") {
    if (!Array.isArray(raw.days) || !raw.days.length || raw.days.some((day) => !TASK_WEEKDAYS.includes(day)) || new Set(raw.days).size !== raw.days.length) {
      throw new ValidationError("Weekly schedules require distinct lowercase weekday names.");
    }
    schedule.days = TASK_WEEKDAYS.filter((day) => (raw.days as string[]).includes(day));
  } else if (raw.days !== undefined) {
    throw new ValidationError("days is only supported for weekly schedules.");
  }
  if (raw.type === "once" || raw.startsAt !== undefined) {
    if (raw.type === "manual") throw new ValidationError("Manual schedules cannot have startsAt.");
    schedule.startsAt = validateInstant(raw.startsAt);
  }
  return { name: data.name.trim(), enabled: data.enabled, instructions: data.instructions, expectChanges: data.expectChanges, schedule };
}

// Deliberately restricted task.toml grammar: scalar strings/booleans/integers,
// one [schedule] table and a string array. Reject unsupported syntax rather than
// silently losing configuration during an update. Scalar decoding is shared with Agents.
const STRING_TOKEN = String.raw`(?:"(?:\\.|[^"\\\x00-\x1f])*"|'[^'\x00-\x1f]*')`;
const SCALAR = new RegExp(`^(?:${STRING_TOKEN}|true|false|0|[1-9][0-9]*)\\s*(?:#.*)?$`);
const ARRAY = new RegExp(`^(\\[\\s*(?:${STRING_TOKEN}(?:\\s*,\\s*${STRING_TOKEN})*\\s*,?)?\\s*\\])\\s*(?:#.*)?$`);

export function parseTaskConfig(content: string, id: string, instructions: string): TaskDefinition {
  validateTaskId(id);
  const root: Record<string, unknown> = {};
  const schedule: Record<string, unknown> = {};
  let section = root;
  let seenSchedule = false;
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    if (/^\[schedule\]\s*(?:#.*)?$/.test(line)) {
      if (seenSchedule) throw new ValidationError("Duplicate schedule table.");
      section = schedule;
      seenSchedule = true;
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new ValidationError(`Invalid task.toml syntax at line ${index + 1}.`);
    const [, key, token] = match;
    const allowed = section === root
      ? ["version", "id", "name", "enabled", "instructions", "expect_changes"]
      : ["type", "timezone", "time", "days", "starts_at"];
    if (!allowed.includes(key) || Object.hasOwn(section, key)) throw new ValidationError(`Unknown or duplicate task.toml key: ${key}.`);
    if (key === "days") {
      const array = ARRAY.exec(token);
      if (!array) throw new ValidationError("days must be a TOML array of strings on one line.");
      section[key] = [...array[1].matchAll(new RegExp(STRING_TOKEN, "g"))]
        .map((item) => readString(`value = ${item[0]}`, "value"));
    } else {
      if (!SCALAR.test(token)) throw new ValidationError(`Invalid TOML value for ${key}.`);
      const source = `${key} = ${token}`;
      section[key] = readString(source, key) ?? readBoolean(source, key) ?? readInteger(source, key);
    }
  }
  if (root.version !== 1 || root.id !== id || root.instructions !== "instructions.md") {
    throw new ValidationError("task.toml requires version = 1, a matching id, and instructions = \"instructions.md\".");
  }
  return { id, ...validateTaskInput({
    name: root.name, enabled: root.enabled, instructions, expectChanges: root.expect_changes,
    schedule: { type: schedule.type, timezone: schedule.timezone,
      ...(schedule.time !== undefined ? { time: schedule.time } : {}),
      ...(schedule.days !== undefined ? { days: schedule.days } : {}),
      ...(schedule.starts_at !== undefined ? { startsAt: schedule.starts_at } : {}),
    },
  }) };
}

export function serializeTaskConfig(task: TaskDefinition): string {
  const lines = ["version = 1", `id = ${quoteToml(task.id)}`, `name = ${quoteToml(task.name)}`,
    `enabled = ${task.enabled}`, 'instructions = "instructions.md"', `expect_changes = ${task.expectChanges}`,
    "", "[schedule]", `type = ${quoteToml(task.schedule.type)}`, `timezone = ${quoteToml(task.schedule.timezone)}`];
  if (task.schedule.time) lines.push(`time = ${quoteToml(task.schedule.time)}`);
  if (task.schedule.days) lines.push(`days = [${task.schedule.days.map(quoteToml).join(", ")}]`);
  if (task.schedule.startsAt) lines.push(`starts_at = ${quoteToml(task.schedule.startsAt)}`);
  return `${lines.join("\n")}\n`;
}
