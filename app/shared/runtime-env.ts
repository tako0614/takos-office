/**
 * Shared runtime/env helpers for the office worker and its editor sub-apps.
 *
 * The same block (process/Bun probes, env reads, flag parsing, native-render
 * detection) was duplicated across every server entry point; this is the single
 * copy they all import.
 */

export type RuntimeEnv = Record<string, string | undefined>;

export type ProcessLike = {
  env?: Record<string, string | undefined>;
  exit?: (code?: number) => never;
  on?: (event: "SIGTERM" | "SIGINT", listener: () => void) => void;
};

export type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): { stop: (closeActiveConnections?: boolean) => void };
};

export function processLike(): ProcessLike | undefined {
  return (globalThis as { process?: ProcessLike }).process;
}

export function bunLike(service: string): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error(`Bun runtime is required to start ${service}`);
  return bun;
}

export function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

export function runtimeEnv(): RuntimeEnv {
  return { ...(processLike()?.env ?? {}) };
}

export function envValue(env: RuntimeEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function requiredEnv(env: RuntimeEnv, name: string): string {
  const value = envValue(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function envFlagEnabled(env: RuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

export function nativeRenderingEnabled(env: RuntimeEnv): boolean {
  const value = envValue(env, "TAKOS_NATIVE_RENDERING");
  if (value) return ["1", "true", "yes"].includes(value.toLowerCase());
  return isBunRuntime();
}
