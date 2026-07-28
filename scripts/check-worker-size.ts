import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const workerPath = new URL("../dist/worker.js", import.meta.url);
const MAX_RAW_BYTES = 20 * 1024 * 1024;
const MAX_GZIP_BYTES = 8 * 1024 * 1024;

const worker = await readFile(workerPath).catch(() => {
  throw new Error("dist/worker.js is missing; run bun run build first");
});
const rawBytes = worker.byteLength;
const gzipBytes = gzipSync(worker, { level: 9 }).byteLength;

if (rawBytes > MAX_RAW_BYTES || gzipBytes > MAX_GZIP_BYTES) {
  throw new Error(
    `Worker artifact is too large: raw=${rawBytes}/${MAX_RAW_BYTES}, gzip=${gzipBytes}/${MAX_GZIP_BYTES}`,
  );
}

console.log(
  JSON.stringify({
    artifact: "dist/worker.js",
    rawBytes,
    gzipBytes,
    limits: {
      rawBytes: MAX_RAW_BYTES,
      gzipBytes: MAX_GZIP_BYTES,
    },
  }),
);
