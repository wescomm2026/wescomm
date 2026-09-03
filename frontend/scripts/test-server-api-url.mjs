import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerApiBaseUrl } from "../lib/server-api-url.mjs";

test("local workspace auth prefers the direct backend URL", () => {
  assert.equal(resolveServerApiBaseUrl({
    BACKEND_API_URL: "http://127.0.0.1:4100/api/",
    NEXT_PUBLIC_API_URL: "/api/backend"
  }), "http://127.0.0.1:4100/api");
});

test("Vercel workspace auth uses the current deployment API rewrite", () => {
  assert.equal(resolveServerApiBaseUrl({
    VERCEL_URL: "wescomm-release.vercel.app",
    NEXT_PUBLIC_API_URL: "/api"
  }), "https://wescomm-release.vercel.app/api");
});

test("custom production origins can resolve the same-origin backend rewrite", () => {
  assert.equal(resolveServerApiBaseUrl({
    FRONTEND_ORIGIN: "https://wescomm.store",
    NEXT_PUBLIC_API_URL: "/api"
  }), "https://wescomm.store/api");
});

test("workspace auth rejects protocol-relative API paths", () => {
  assert.throws(() => resolveServerApiBaseUrl({
    VERCEL_URL: "wescomm-release.vercel.app",
    NEXT_PUBLIC_API_URL: "//attacker.invalid/api"
  }), /same-origin path/);
});
