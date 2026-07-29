import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error.js";
import { createSupabaseFetchWithErrorStatus } from "../utils/supabase-fetch.js";

test("PostgREST JSON errors retain their final HTTP status for common mapping", async () => {
  const resilientFetch = createSupabaseFetchWithErrorStatus(async () => new Response(
    JSON.stringify({
      code: "CUSTOM_UPSTREAM",
      message: "Database service error",
      details: null,
      hint: null
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "content-length": "100"
      }
    }
  ));

  const response = await resilientFetch("https://project.supabase.co/rest/v1/products");
  const body = await response.json() as { httpStatus?: number; code?: string };

  assert.equal(response.status, 503);
  assert.equal(body.httpStatus, 503);
  assert.equal(body.code, "CUSTOM_UPSTREAM");
  assert.equal(response.headers.has("content-length"), false);

  const mapped = HttpError.fromSupabase(body);
  assert.equal(mapped.status, 503);
  assert.equal(mapped.details?.retryable, true);
});

test("non-JSON PostgREST failures receive a status-aware JSON error", async () => {
  const resilientFetch = createSupabaseFetchWithErrorStatus(async () => new Response(
    "<html>gateway unavailable</html>",
    {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/html" }
    }
  ));

  const response = await resilientFetch("https://project.supabase.co/rest/v1/products");
  const body = await response.json() as {
    httpStatus?: number;
    code?: string;
    message?: string;
  };

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(body, {
    code: "HTTP_502",
    message: "Bad Gateway",
    details: null,
    hint: null,
    httpStatus: 502
  });

  const mapped = HttpError.fromSupabase(body);
  assert.equal(mapped.status, 503);
  assert.equal(mapped.details?.retryable, true);
});

test("successful and non-PostgREST responses are returned untouched", async () => {
  const originalResponse = new Response("unavailable", { status: 503 });
  const passThroughFetch = createSupabaseFetchWithErrorStatus(async () => originalResponse);

  assert.equal(
    await passThroughFetch("https://project.supabase.co/auth/v1/user"),
    originalResponse
  );
});

test("PostgREST 404 compatibility responses remain untouched", async () => {
  for (const originalResponse of [
    new Response("[]", {
      status: 404,
      headers: { "content-type": "application/json" }
    }),
    new Response("", { status: 404 })
  ]) {
    const passThroughFetch = createSupabaseFetchWithErrorStatus(async () => originalResponse);

    assert.equal(
      await passThroughFetch("https://project.supabase.co/rest/v1/products"),
      originalResponse
    );
  }
});
