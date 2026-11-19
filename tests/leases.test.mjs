import test from "node:test";
import assert from "node:assert/strict";
import { releaseModelLease } from "../server/leases.mjs";
test("model lease releases with PostgREST thenable that has no catch method", async () => {
  let awaited = false;
  await releaseModelLease(
    {
      rpc: (name, args) => {
        assert.equal(name, "dobao_release_lease");
        assert.equal(args.p_id, "lease-test");
        return {
          then(resolve) {
            awaited = true;
            resolve({ data: null, error: null });
          },
        };
      },
    },
    "lease-test",
  );
  assert.equal(awaited, true);
});
test("lease cleanup failure never turns an already committed response into an error", async () => {
  await assert.doesNotReject(
    releaseModelLease(
      {
        rpc: () => ({
          then(resolve, reject) {
            reject(new Error("offline"));
          },
        }),
      },
      "lease-test",
    ),
  );
});
