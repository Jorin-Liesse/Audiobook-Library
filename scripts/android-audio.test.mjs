import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

async function player(invoke, { tauri = true, userAgent = "Android" } = {}) {
  const context = createContext({ window: {}, navigator: { userAgent } });
  const core = new SyntheticModule(
    ["invoke", "isTauri", "convertFileSrc"],
    function () {
      this.setExport("invoke", invoke);
      this.setExport("isTauri", () => tauri);
      this.setExport("convertFileSrc", () => {
        throw new Error("Native playback must not use WebView URLs");
      });
    },
    { context },
  );
  const native = new SourceTextModule(
    stripTypeScriptTypes(
      await readFile(
        new URL("../src/lib/library/native.ts", import.meta.url),
        "utf8",
      ),
    ),
    { context },
  );
  const audio = new SourceTextModule(
    stripTypeScriptTypes(
      await readFile(
        new URL("../src/lib/library/androidAudio.ts", import.meta.url),
        "utf8",
      ),
    ),
    { context },
  );
  await audio.link((specifier) =>
    specifier === "@tauri-apps/api/core" ? core : native,
  );
  await audio.evaluate();
  return audio.namespace;
}

function book() {
  return {
    key: "series/book",
    title: "Book",
    author: "Author",
    files: ["one", "two"].map((name) => ({
      source: "native",
      protocol: "library",
      name: name + ".mp3",
      location: JSON.stringify({
        uri: "content://library/" + name,
        documentTopTreeUri: "content://library/tree",
      }),
    })),
  };
}

const idle = { active: false, playing: false };

test("only Android Tauri selects native playback", async () => {
  for (const [options, expected] of [
    [{ tauri: true, userAgent: "Android" }, true],
    [{ tauri: false, userAgent: "Android" }, false],
    [{ tauri: true, userAgent: "Windows" }, false],
  ]) {
    assert.equal(
      (await player(async () => idle, options)).isAndroidApp(),
      expected,
    );
  }
});

test("the complete chapter queue and resume position go directly to Android", async () => {
  const calls = [];
  const { androidAudio } = await player(async (...args) => {
    calls.push(args);
    return idle;
  });
  const selected = book();
  await androidAudio.load(selected, 1, 1234.5);
  const [name, { request }] = calls[0];
  assert.equal(name, "plugin:native-audio|load");
  assert.equal(request.bookKey, selected.key);
  assert.equal(request.index, 1);
  assert.equal(request.position, 1234.5);
  assert.deepEqual(
    Array.from(request.tracks, (track) => track.location),
    selected.files.map((file) => file.location),
  );
});

test("seek and close wait for a pending native service start", async () => {
  const calls = [];
  let release;
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const { androidAudio } = await player(async (name) => {
    calls.push(name);
    if (name.endsWith("|load")) await started;
    return idle;
  });
  const loading = androidAudio.load(book(), 0, 0);
  const seeking = androidAudio.seek(25);
  const stopping = androidAudio.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["plugin:native-audio|load"]);
  release();
  await Promise.all([loading, seeking, stopping]);
  assert.deepEqual(calls, [
    "plugin:native-audio|load",
    "plugin:native-audio|seek",
    "plugin:native-audio|stop",
  ]);
});

test("a failed native command does not block subsequent controls", async () => {
  let calls = 0;
  const { androidAudio } = await player(async () => {
    if (++calls === 1) throw new Error("service disconnected");
    return idle;
  });
  await assert.rejects(androidAudio.play(), /service disconnected/);
  assert.equal(await androidAudio.status(), idle);
  assert.equal(calls, 2);
});

test("unsupported saved files do not send WebView sources to the service", async () => {
  const calls = [];
  const { androidAudio } = await player(async (...args) => {
    calls.push(args);
    return idle;
  });
  const selected = book();
  selected.files[0].protocol = "asset";
  assert.throws(
    () => androidAudio.load(selected, 0, 0),
    /Choose your audiobook folder again/,
  );
  assert.equal(calls.length, 0);
});
