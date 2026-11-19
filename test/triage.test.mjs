import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";

let server;
let url;
before(async () => {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: server.stdout });
  for await (const line of lines) {
    url = line;
    break;
  }
  assert.ok(url, "Сервер должен сообщить адрес");
});
after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
});

function send(body) {
  return fetch(new URL("/api/triage", url), {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
}

for (const body of ["", "{", "null", "{}", '{"text":42}', '{"text":"  "}', '{"text":""}']) {
  test("Отклоняет ввод " + JSON.stringify(body), async () => {
    const response = await send(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "invalid_input" });
  });
}

for (const [text, topic] of [["Доставка", "delivery"], ["Цена", "pricing"], ["Вопрос", "other"]]) {
  test("Готовый черновик для " + topic, async () => {
    const response = await send(JSON.stringify({ text }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ready");
    assert.equal(data.topic, topic);
    assert.ok(data.draft.trim());
  });
}

for (const text of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test("Ручной разбор для " + text, async () => {
    const start = performance.now();
    const response = await send(JSON.stringify({ text }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "manual_review", topic: null, draft: null });
    // Допуск на HTTP и планировщик. Без отмены имитатор ждёт 1200 мс.
    if (text === "[timeout]") assert.ok(performance.now() - start < 1000);
  });
}
