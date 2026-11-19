import test from "node:test";
import assert from "node:assert/strict";
import { supportRequest, removeSupportRequest } from "../server/support.mjs";
test("contact API derives owner and never accepts a forged team reply", async () => {
  let row;
  const sb = {
    from(table) {
      assert.equal(table, "dobao_support_requests");
      return {
        insert(value) {
          row = value;
          return this;
        },
        async select() {
          return { data: [{ id: "test" }] };
        },
      };
    },
  };
  await supportRequest(sb, { id: "owner" }, "POST", {
    topic: "Test",
    message: "Contact",
    user_id: "other",
    reply: "Forged",
    status: "answered",
  });
  assert.deepEqual(row, {
    user_id: "owner",
    topic: "Test",
    message: "Contact",
  });
  await assert.rejects(
    supportRequest(sb, { id: "owner" }, "POST", {
      topic: "Test",
      message: "x".repeat(2001),
    }),
  );
});
test("contact deletion filters both owner and request; missing owner row is not success", async () => {
  const filters = [];
  const query = {
    delete() {
      return this;
    },
    eq(...values) {
      filters.push(values);
      return this;
    },
    async select() {
      return { data: [] };
    },
  };
  const id = "11111111-1111-4111-8111-111111111111";
  await assert.rejects(
    removeSupportRequest({ from: () => query }, { id: "owner" }, id),
    (e) => e.status === 404,
  );
  assert.deepEqual(filters, [
    ["user_id", "owner"],
    ["id", id],
  ]);
});
