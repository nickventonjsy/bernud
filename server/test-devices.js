import assert from "node:assert/strict";
import { createPcQueue, phoneMessage, ntfyPublish } from "./devices.js";
import { londonNow, isDue, notificationText, converse, createScheduler } from "./scheduler.js";

let n = 0; const ok = (m) => { n++; console.log("ok -", m); };

// --- PC queue: command reaches a waiting poll, result returns to sender
{
  const q = createPcQueue({ resultTimeoutMs: 500, pollTimeoutMs: 200 });
  assert.equal(q.online(), false);
  const poll = q.poll({ host: "samsungbook" });
  assert.equal(q.online(), true);
  const sent = q.send("open_app", "chrome");
  const cmd = await poll;
  assert.equal(cmd.action, "open_app"); assert.equal(cmd.target, "chrome");
  assert.equal(q.result(cmd.id, true, "Opened Google Chrome"), true);
  assert.deepEqual(await sent, { ok: true, output: "Opened Google Chrome" });
  // queued before any poll
  const s2 = q.send("media", "play_pause");
  const c2 = await q.poll();
  q.result(c2.id, false, "boom");
  assert.equal((await s2).ok, false);
  // empty poll times out with null
  assert.equal(await q.poll(), null);
  // timeout when PC never answers
  const s3 = await q.send("volume", "", "50");
  assert.equal(s3.error, "timeout");
  assert.equal(q.result("nope", true, ""), false);
  ok("pc queue round trip, ordering, timeouts");
}

// --- phone message format
assert.equal(phoneMessage("s3cr3t", "open_url", "https://x.com/a|b\nc"), "s3cr3t|open_url|https://x.com/a b c");
ok("phone message escapes separators");

// --- ntfy publish builds the right request
{
  let seen;
  await ntfyPublish("topic-1", "hello", { title: "T", click: "https://bernud.onrender.com/", tags: "briefcase", priority: 4, fetchImpl: async (u, o) => { seen = { u, o }; return { ok: true }; } });
  assert.equal(seen.u, "https://ntfy.sh/topic-1");
  assert.equal(seen.o.headers.title, "T"); assert.equal(seen.o.headers.priority, "4"); assert.equal(seen.o.body, "hello");
  await assert.rejects(ntfyPublish("", "x"));
  ok("ntfy publish");
}

// --- London time and due logic (BST and GMT)
{
  const bst = londonNow(new Date("2026-10-23T08:05:00Z")); // Fri 09:05 BST
  assert.deepEqual(bst, { date: "2026-10-23", hour: 9, minute: 5, dow: 5 });
  const gmt = londonNow(new Date("2026-11-02T09:00:00Z")); // Mon 09:00 GMT
  assert.equal(gmt.hour, 9); assert.equal(gmt.dow, 1);
  assert.equal(isDue(bst), true);
  assert.equal(isDue({ ...bst, minute: 59, hour: 8 }), false);
  assert.equal(isDue({ ...bst, hour: 9, minute: 31 }), false);
  assert.equal(isDue({ ...bst, dow: 6 }), false);          // Saturday
  assert.equal(isDue({ ...bst, dow: 0 }), false);          // Sunday
  assert.equal(isDue({ ...bst, dow: 6 }, { days: "0-6" }), true);
  assert.equal(isDue({ ...bst, dow: 3 }, { days: "1,3,5" }), true);
  ok("London time across BST/GMT and weekday window");
}

// --- notification text from a real-shaped brief
{
  const md = "## Today at a glance\nStuff.\n\n## Top three priorities\nThe sources don't establish priorities, so these are **Recommended**:\n- **Settle the Christmas closure notice.** Three versions.\n- **Check the K8 quotation.** [K8](https://x) was modified.\n- **Classify the inbox folder.** Without dates.\n\n## Recommended first move\nConfirm which Christmas closure notice stands, then check the [K8 quotation](https://x).";
  const t = notificationText(md);
  assert.match(t, /Settle the Christmas closure notice/);
  assert.match(t, /Classify the inbox folder/);
  assert.match(t, /First move: Confirm which Christmas closure notice stands, then check the K8 quotation\./);
  assert.doesNotMatch(t, /https:/);
  ok("notification text");
}

// --- converse against a fake ElevenLabs socket
{
  class FakeWS {
    constructor(url) { this.url = url; this.l = {}; this.sent = []; FakeWS.last = this; setTimeout(() => this.emit("open"), 5); }
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    emit(t, data) { for (const f of this.l[t] || []) f(data === undefined ? {} : { data: JSON.stringify(data) }); }
    send(s) {
      const m = JSON.parse(s); this.sent.push(m);
      if (m.type === "conversation_initiation_client_data") setTimeout(() => { this.emit("message", { type: "ping", ping_event: { event_id: 7 } }); this.emit("message", { type: "conversation_initiation_metadata" }); }, 5);
      if (m.type === "user_message") setTimeout(() => { this.emit("message", { type: "agent_response", agent_response_event: { agent_response: "Brief saved." } }); savedFlag = true; }, 10);
    }
    close() { this.closed = true; }
  }
  let savedFlag = false;
  const said = await converse("agent_x", "Give me my brief", { WS: FakeWS, until: async () => savedFlag, timeoutMs: 8000 });
  assert.deepEqual(said, ["Brief saved."]);
  assert.match(FakeWS.last.url, /agent_id=agent_x/);
  assert.equal(FakeWS.last.sent[0].conversation_config_override.conversation.text_only, true);
  assert.deepEqual(FakeWS.last.sent.find((m) => m.type === "pong"), { type: "pong", event_id: 7 });
  assert.equal(FakeWS.last.closed, true);
  ok("converse: init, pong, user message, closes once saved");
}

// --- scheduler: one run per day, success and failure notifications
{
  const m = new Map();
  const kv = { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async claim(k, v) { if (m.get(k) === v) return false; m.set(k, v); return true; } };
  let brief = null; const notes = []; let runs = 0;
  const ccp = { async latestBrief() { return brief; } };
  const s = createScheduler({ kv, ccp, agentId: "a", log: () => {},
    notify: async (text, o) => notes.push({ text, ...o }),
    converseImpl: async (_a, _t, { until }) => { runs++; brief = { created_at: new Date().toISOString(), text: "## Recommended first move\nCall Kerr." }; assert.equal(await until(), true); } });
  const due = { date: "2026-10-26", hour: 9, minute: 1, dow: 1 };
  assert.equal(await s.tick(due), true);
  assert.equal(await s.tick({ ...due, minute: 2 }), false); // same day: no duplicate
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(runs, 1);
  assert.equal(notes[0].title, "CCP morning brief ready");
  assert.match(notes[0].text, /First move: Call Kerr\./);
  assert.match(notes[0].click, /open=brief/);
  assert.equal(await s.tick({ ...due, dow: 6, date: "2026-10-31" }), false); // Saturday

  // failure path
  const s2 = createScheduler({ kv, ccp: { async latestBrief() { return null; } }, agentId: "a", log: () => {},
    notify: async (text, o) => notes.push({ text, ...o }), converseImpl: async () => { throw new Error("socket closed"); } });
  const r = await s2.runBrief("test");
  assert.equal(r.ok, false);
  assert.equal(notes.at(-1).title, "CCP brief failed");
  assert.match(notes.at(-1).text, /socket closed/);
  const st = await s2.status();
  assert.equal(st.last_result.ok, false);
  ok("scheduler: no duplicate runs, weekend skip, success and failure notifications");
}


// Messages and calls need a read-back and a later yes (29 Oct: a WhatsApp to Michelle went without asking).
{
  const { createSendGate } = await import("./devices.js");
  let t = 1_000_000;
  const g = createSendGate({ now: () => t, rnd: () => 0.5 });
  let r = g.check({ action: "wa_message", target: "Michelle", value: "Do you need anything from the shop? 😘😘" });
  assert.equal(r.go, false); assert.equal(r.reply.sent, false); assert.equal(r.reply.confirm_code, "5500");
  assert.match(r.reply.read_back, /WhatsApp message to Michelle: "Do you need anything from the shop\? 😘😘"/);
  // Straight back with the code in the same breath: refused.
  r = g.check({ action: "wa_message", target: "Michelle", value: "x", confirm_code: "5500" });
  assert.equal(r.go, false); assert.equal(r.reply.error, "too_soon");
  // After he's answered: goes, exactly as read back (the wording can't be swapped at the last moment).
  t += 6000;
  r = g.check({ action: "wa_message", target: "Someone else", value: "different", confirm_code: "5500" });
  assert.equal(r.go, true); assert.equal(r.body.target, "Michelle"); assert.equal(r.body.value, "Do you need anything from the shop? 😘😘");
  // A code works once.
  assert.equal(g.check({ action: "wa_message", confirm_code: "5500" }).reply.error, "no_such_confirmation");
  // Calls too; other phone actions are untouched.
  assert.equal(g.check({ action: "wa_call", target: "Mum" }).go, false);
  assert.equal(g.check({ action: "torch", value: "on" }).go, true);
  console.log("send gate ok");
}

console.log(`\n${n} device/scheduler tests passed`);
process.exit(0);
