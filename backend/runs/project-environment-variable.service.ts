import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@db/client";
import { projectEnvironmentVariables } from "@db/schema";
import { ValidationError } from "../errors";
import { RUNNER_CONFIG } from "./runner-config";
import type {
  ProjectEnvironmentVariableInput,
  ProjectEnvironmentVariableMetadata,
  ProjectProcessEnvironment,
} from "../../src/types/project-execution";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_VARIABLES = 100;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 65_536;
const KEY_FILE = "environment-secrets.key";
const PROTECTED_NAMES = new Set([
  "AGENTTASKER_DATA_DIR",
  "CODEX_HOME",
  "COMSPEC",
  "DATABASE_PATH",
  "HOME",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
  "PATHEXT",
  "PYTHON",
  "PYTHONDONTWRITEBYTECODE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TURBOPACK",
  "USERPROFILE",
  "WINDIR",
]);

function canonicalName(name: string): string {
  return name.toUpperCase();
}

function validateName(input: unknown): string {
  if (typeof input !== "string") throw new ValidationError("Environment variable names must be strings.");
  const name = input.trim();
  const normalized = canonicalName(name);
  if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    throw new ValidationError(`Invalid environment variable name: ${name || "(empty)"}.`);
  }
  if (PROTECTED_NAMES.has(normalized) || normalized.startsWith("GIT_") || normalized.startsWith("__NEXT_")) {
    throw new ValidationError(`${name} is controlled by AgentTasker and cannot be overridden.`);
  }
  return name;
}

function validateValue(input: unknown, name: string): string {
  if (typeof input !== "string") throw new ValidationError(`A value is required for new environment variable ${name}.`);
  if (input.length > MAX_VALUE_LENGTH || input.includes("\0")) {
    throw new ValidationError(`The value for ${name} is invalid or too large.`);
  }
  return input;
}

export function normalizeProjectEnvironmentVariableInputs(input: unknown): ProjectEnvironmentVariableInput[] {
  if (!Array.isArray(input)) throw new ValidationError("Environment variables must be an array.");
  if (input.length > MAX_VARIABLES) throw new ValidationError(`At most ${MAX_VARIABLES} environment variables are allowed per project.`);
  const seen = new Set<string>();
  return input.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError("Each environment variable must contain a name and optional replacement value.");
    }
    const record = entry as Record<string, unknown>;
    const name = validateName(record.name);
    const canonical = canonicalName(name);
    if (seen.has(canonical)) throw new ValidationError(`Environment variable ${name} is duplicated.`);
    seen.add(canonical);
    return Object.prototype.hasOwnProperty.call(record, "value")
      ? { name, value: validateValue(record.value, name) }
      : { name };
  });
}

function keyPath(): string {
  return path.join(RUNNER_CONFIG.dataDirectory, KEY_FILE);
}

function readOrCreateEncryptionKey(): Buffer {
  fs.mkdirSync(RUNNER_CONFIG.dataDirectory, { recursive: true, mode: 0o700 });
  const target = keyPath();
  try {
    const descriptor = fs.openSync(target, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, crypto.randomBytes(32));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = fs.lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error("The local environment secret key is not a safe regular file.");
  }
  const key = fs.readFileSync(target);
  if (key.length !== 32) throw new Error("The local environment secret key is invalid.");
  return key;
}

function additionalData(projectId: string, name: string): Buffer {
  return Buffer.from(`${projectId}\0${name}`, "utf8");
}

function encryptValue(projectId: string, name: string, value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", readOrCreateEncryptionKey(), iv);
  cipher.setAAD(additionalData(projectId, name));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptValue(projectId: string, name: string, payload: string): string {
  const [version, iv, tag, encrypted, ...extra] = payload.split(":");
  if (version !== "v1" || !iv || !tag || encrypted === undefined || extra.length) {
    throw new Error(`The stored value for ${name} has an unsupported format.`);
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", readOrCreateEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAAD(additionalData(projectId, name));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

function rows(projectId: string) {
  return db.select().from(projectEnvironmentVariables)
    .where(eq(projectEnvironmentVariables.projectId, projectId)).all();
}

export class ProjectEnvironmentVariableService {
  list(projectId: string): ProjectEnvironmentVariableMetadata[] {
    return rows(projectId)
      .map((entry) => ({ name: entry.name, configured: true as const }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  resolve(projectId: string): ProjectProcessEnvironment {
    return Object.fromEntries(rows(projectId).map((entry) => [
      entry.name,
      decryptValue(projectId, entry.name, entry.encryptedValue),
    ]));
  }

  setAll(projectId: string, input: unknown): ProjectEnvironmentVariableMetadata[] {
    const normalized = normalizeProjectEnvironmentVariableInputs(input);
    const existing = new Map(rows(projectId).map((entry) => [canonicalName(entry.name), entry]));
    const replacements = normalized.map((entry) => {
      const retained = existing.get(canonicalName(entry.name));
      const value = entry.value === undefined && retained
        ? decryptValue(projectId, retained.name, retained.encryptedValue)
        : entry.value;
      if (value === undefined) throw new ValidationError(`A value is required for new environment variable ${entry.name}.`);
      return { name: entry.name, encryptedValue: encryptValue(projectId, entry.name, value) };
    });

    sqlite.transaction(() => {
      db.delete(projectEnvironmentVariables)
        .where(eq(projectEnvironmentVariables.projectId, projectId)).run();
      for (const entry of replacements) {
        db.insert(projectEnvironmentVariables).values({ projectId, ...entry }).run();
      }
    }).immediate();
    return this.list(projectId);
  }
}

export const projectEnvironmentVariableService = new ProjectEnvironmentVariableService();
