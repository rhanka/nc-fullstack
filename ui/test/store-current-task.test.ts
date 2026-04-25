import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";

import { createdItem, resetCreatedItem, setCreatedItemCurrentTask } from "../src/routes/store.ts";

test("setCreatedItemCurrentTask updates the shared createdItem store immutably", () => {
  resetCreatedItem();

  const seenTasks: string[] = [];
  const unsubscribe = createdItem.subscribe((value) => {
    seenTasks.push(value.currentTask);
  });

  setCreatedItemCurrentTask("100");

  unsubscribe();

  assert.equal(get(createdItem).currentTask, "100");
  assert.deepEqual(seenTasks.slice(-2), ["000", "100"]);
});
