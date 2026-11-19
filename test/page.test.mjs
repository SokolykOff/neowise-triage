import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

function page(fetch) {
  const elements = new Map();
  function select(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, {
        textContent: "", value: "", focus() {},
        addEventListener(event, handler) { this[event] = handler; },
      });
    }
    return elements.get(selector);
  }
  runInNewContext(script, { document: { querySelector: select }, fetch });
  return {
    status: select("#status"), draft: select("#draft"), message: select("#message"),
    submit(text) {
      this.message.value = text;
      this.message.input();
      return select("form").submit({ preventDefault() {} });
    },
  };
}

const ready = { status: "ready", topic: "delivery", draft: "Ответ о доставке" };
function reply(data) { return { ok: true, json: async () => data }; }

for (const failure of ["manual_review", "network"]) {
  test("После успеха очищает черновик при " + failure, async () => {
    let first = true;
    const ui = page(async () => {
      if (first) return reply(ready);
      if (failure === "network") throw new Error("offline");
      return reply({ status: "manual_review", topic: null, draft: null });
    });
    await ui.submit("Первая заявка");
    assert.equal(ui.draft.textContent, ready.draft);
    first = false;
    await ui.submit("Вторая заявка");
    assert.equal(ui.draft.textContent, "");
    assert.match(ui.status.textContent, /ручной разбор/);
    assert.equal(ui.message.value, "Вторая заявка");
  });
}

test("Поздний ответ не заменяет результат следующего запроса", async () => {
  let finish;
  const ui = page(async (_, options) => {
    if (JSON.parse(options.body).text === "A") return new Promise(resolve => { finish = resolve; });
    return reply(ready);
  });
  const first = ui.submit("A");
  await ui.submit("B");
  finish(reply({ status: "manual_review", topic: null, draft: null }));
  await first;
  assert.equal(ui.draft.textContent, ready.draft);
});

test("Пустая форма не отправляет запрос", async () => {
  let calls = 0;
  const ui = page(() => { calls++; });
  await ui.submit("   ");
  assert.equal(calls, 0);
  assert.match(ui.status.textContent, /Введите текст/);
});
