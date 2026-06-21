/**
 * Minimal structured logger for the takos-docs server runtime.
 *
 * Emits one JSON line per event in production, human-readable lines in dev.
 * Browser code should not import this module; it is intended for the Bun HTTP
 * server entry point only.
 */

import { env } from "node:process";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type LogFields = Record<string, unknown>;

function normalizeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { message: String(value) };
}

function formatFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? normalizeError(v) : v;
  }
  return out;
}

function useJson(): boolean {
  return (env.NODE_ENV ?? "") === "production";
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const json = useJson();
  const ts = new Date().toISOString();
  const merged = formatFields(fields);
  const line = json
    ? JSON.stringify({
      level,
      event,
      ts,
      service: "takos-docs",
      ...merged,
    })
    : `${ts} ${level.toUpperCase()} [takos-docs] ${event}${
      merged && Object.keys(merged).length > 0
        ? " " + JSON.stringify(merged)
        : ""
    }`;
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.error) console.error(line);
  else if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) console.warn(line);
  else console.log(line);
}

export const serverLog = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
