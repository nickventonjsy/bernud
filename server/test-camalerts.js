import assert from "node:assert/strict";
import { createCamAlerts, isAfterHours, kindOf, parseTime } from "./camalerts.js";
// Monday 26 Oct 2026 is GMT (clocks went back on the 25th).
// GMT dates: Mon 26 Oct 2026 … Sun 1 Nov 2026.
const AH = (iso) => isAfterHours(new Date(iso));
assert.equal(AH("2026-10-26T12:00:00Z"), false);  // Mon noon
assert.equal(AH("2026-10-26T17:29:00Z"), false);  // Mon 17:29
assert.equal(AH("2026-10-26T17:30:00Z"), true);   // Mon 17:30
assert.equal(AH("2026-10-27T08:29:00Z"), true);   // Tue 08:29
assert.equal(AH("2026-10-27T08:30:00Z"), false);  // Tue 08:30
assert.equal(AH("2026-10-31T08:00:00Z"), true);   // Sat 08:00 (Friday night)
assert.equal(AH("2026-10-31T10:00:00Z"), false);  // Sat 10:00 (open)
assert.equal(AH("2026-10-31T12:30:00Z"), true);   // Sat 12:30
assert.equal(AH("2026-11-01T14:00:00Z"), true);   // Sun afternoon
assert.equal(AH("2026-11-02T08:00:00Z"), true);   // Mon 08:00
assert.equal(AH("2026-11-02T09:00:00Z"), false);  // Mon 09:00
assert.equal(kindOf("videoMotion"), "motion"); assert.equal(kindOf("human"), "person"); assert.equal(kindOf("aiFaceDetect"), "person"); assert.equal(kindOf("offline"), "offline");
assert.equal(parseTime(1793040000).getTime(), 1793040000000);
assert.equal(parseTime("20261026T190000Z").toISOString(), "2026-10-26T19:00:00.000Z");

const store = new Map(); const kv = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
const sent = []; let snaps = 0;
const cams = [{ id: "D1", name: "Cory's Shop", channel: "0", online: true }, { id: "D2", name: "Living Room", channel: "0", online: true }];
const imou = { cameras: async () => cams, find: async (n) => cams.find((c) => c.name.toLowerCase().includes(String(n).toLowerCase().replace("the ", ""))) || cams[0], snapshot: async () => { snaps++; return "https://snap.aliyuncs.com/s.jpg"; },
  alarms: async (cam) => (cam.id === "D1" ? [{ msgType: "human", time: Math.round(clock.getTime() / 1000) - 60 }] : []), calls: [], call: async (api, p) => { imou.calls.push([api, p]); return api === "getMessageCallback" ? {} : {}; } };
let clock = new Date("2026-10-26T19:00:00Z");
const ca = createCamAlerts({ kv, imou, notify: async (t, o) => sent.push({ t, o }), publicUrl: "https://srv", hookSecret: "SEC", now: () => clock, log: { error() {}, log() {} } });

// After hours at the shop: notified, with a snapshot and a link to the live view.
let r = await ca.handle({ did: "D1", msgType: "videoMotion", time: Math.round(clock.getTime() / 1000) });
assert.equal(r.notified, true); assert.equal(sent.length, 1);
assert.match(sent[0].t, /Motion at Cory's Shop, 19:00/); assert.equal(sent[0].o.attach, "https://snap.aliyuncs.com/s.jpg"); assert.match(sent[0].o.click, /camera\.html\?camera=Cory's%20Shop/);
// Same camera again within 5 minutes: logged, not sent.
clock = new Date(clock.getTime() + 60_000);
r = await ca.handle({ did: "D1", msgType: "human", time: Math.round(clock.getTime() / 1000), picUrlArray: ["https://pic.lechange.com/a.jpg"] });
assert.equal(r.notified, false); assert.equal(r.reason, "cooldown");
// Living room alerts any time.
r = await ca.handle({ did: "D2", msgType: "human", time: Math.round(clock.getTime() / 1000) });
assert.equal(r.notified, true); sent.pop();
r = await ca.handle({ did: "D1", msgType: "human", time: Math.round(new Date("2026-10-27T11:00:00Z").getTime() / 1000) });
assert.equal(r.reason, "not watching now");
// Turn the living room on, people only.
const c = await ca.configure({ action: "set", camera: "living room", mode: "always", people_only: true });
assert.deepEqual(c.cameras.find((x) => x.camera === "Living Room"), { camera: "Living Room", online: true, mode: "always", people_only: true });
clock = new Date(clock.getTime() + 10 * 60_000);
assert.equal((await ca.handle({ did: "D2", msgType: "videoMotion", time: Math.round(clock.getTime() / 1000) })).reason, "people only");
assert.equal((await ca.handle({ did: "D2", msgType: "human", time: Math.round(clock.getTime() / 1000) + 30 })).notified, true);
// Events summary for "what happened at the shop?"
const ev = await ca.events({ camera: "shop", hours: 24 });
assert.equal(ev.summary[0].camera, "Cory's Shop"); assert.equal(ev.summary[0].total, 3); assert.equal(ev.summary[0].kinds.person, 2);
// Registration points Imou at the secret hook once.
await ca.register();
assert.deepEqual(imou.calls.at(-1), ["setMessageCallback", { callbackFlag: "alarm,deviceStatus", callbackUrl: "https://srv/camera/hook/SEC", status: "on" }]);
// Backup check picks up a missed alarm for watched cameras only.
clock = new Date("2026-10-26T21:00:00Z");
const before = sent.length;
assert.equal(await ca.poll(), 1); assert.equal(sent.length, before + 1);
console.log("camalerts ok");
