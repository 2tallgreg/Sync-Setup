import assert from "node:assert/strict";
import test from "node:test";
import { mapConcurrent, selectCompatibleRelease } from "../install-candidates";

test("versions.json selects the newest release supported by the current app", () => {
  const releases = {
    "2.0.0": "1.8.0",
    "1.9.0": "1.6.0",
    "1.10.0": "1.5.0",
    "1.4.0": "1.3.0"
  };
  const supported = new Set(["1.3.0", "1.5.0", "1.6.0"]);
  assert.equal(selectCompatibleRelease(releases, minimum => supported.has(minimum)), "1.10.0");
  assert.equal(selectCompatibleRelease(releases, () => false), undefined);
  assert.equal(selectCompatibleRelease([], () => true), undefined);
});

test("versions.json prefers stable releases over prereleases of the same version", () => {
  assert.equal(selectCompatibleRelease({ "1.0.0": "1.0.0", "1.0.0-beta": "1.0.0" }, () => true), "1.0.0");
  assert.equal(selectCompatibleRelease({ "1.0.0-beta.2": "1.0.0", "1.0.0-beta.10": "1.0.0" }, () => true), "1.0.0-beta.10");
});

test("bounded mapping limits simultaneous requests and preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrent([4, 3, 2, 1, 0], 2, async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, value === 4 ? 8 : 1));
    active--;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(result, [8, 6, 4, 2, 0]);
});

test("a failed concurrent task rejects instead of silently returning partial results", async () => {
  await assert.rejects(mapConcurrent([1, 2, 3], 2, async value => {
    if (value === 2) throw new Error("request failed");
    return value;
  }), /request failed/);
});
