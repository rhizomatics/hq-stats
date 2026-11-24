import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { get, HttpError } from "../src/http.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

// Answers each call with the next response in the list; returns the call count.
function stubFetch(responses) {
  const calls = { n: 0 };
  globalThis.fetch = async () => responses[Math.min(calls.n++, responses.length - 1)]();
  return calls;
}
const ok = (data) => () => new Response(JSON.stringify(data), { status: 200 });
const fail =
  (status, body = "") =>
  () =>
    new Response(body, { status });

test("a 404 fails at once, with the start of the body kept", async () => {
  const calls = stubFetch([fail(404, '{"error": "not found"}')]);
  await assert.rejects(get("https://example.test/x"), (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.message, "HTTP 404");
    assert.equal(e.body, '{"error": "not found"}');
    return true;
  });
  assert.equal(calls.n, 1);
});

test("a status in retryOn is retried and can then succeed", async (t) => {
  t.mock.method(globalThis, "setTimeout", (fn) => fn());
  t.mock.method(console, "warn", () => {});
  const calls = stubFetch([fail(404), ok({ a: 1 })]);
  assert.deepEqual(await get("https://example.test/x", { retryOn: [404] }), { a: 1 });
  assert.equal(calls.n, 2);
});

test("a status in retryOn gives up after the last attempt", async (t) => {
  t.mock.method(globalThis, "setTimeout", (fn) => fn());
  t.mock.method(console, "warn", () => {});
  const calls = stubFetch([fail(404, "gone")]);
  await assert.rejects(get("https://example.test/x", { retryOn: [404], attempts: 2 }), { message: "HTTP 404" });
  assert.equal(calls.n, 2);
});
