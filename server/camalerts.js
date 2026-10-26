// Camera alerts: Imou pushes motion/person alarms to Bernard's server (no constant polling, so the free Imou
// allowance lasts). Bernard decides whether it matters (which camera, what time) and sends a phone notification
// with a snapshot. A gentle backup check catches anything the push missed. Events are kept for "what happened?".
const DAY_MS = 24 * 3600_000;
export const DEFAULTS = {
  enabled: true,
  after_hours: { start: "18:00", end: "07:30", weekends: true },
  cooldown_min: 5,
  // Cameras matching these words alert after hours; everything else is off unless changed.
  default_rules: [{ match: "shop|car ?park|garage|yard|unit|business|cory", mode: "after_hours", people_only: false }],
  cameras: {},
};

export function londonParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
export function isAfterHours(d, ah = DEFAULTS.after_hours) {
  const { weekday, minutes } = londonParts(d);
  if (ah.weekends && (weekday === "Sat" || weekday === "Sun")) return true;
  const s = toMin(ah.start), e = toMin(ah.end);
  return s > e ? minutes >= s || minutes < e : minutes >= s && minutes < e;
}

export function kindOf(msgType = "") {
  const t = String(msgType);
  if (/^(online|offline)$/i.test(t)) return t.toLowerCase();
  if (/human|person|people|face|body|ivs|smartMotion/i.test(t)) return "person";
  if (/car|vehicle/i.test(t)) return "vehicle";
  if (/motion|move/i.test(t)) return "motion";
  if (/bell|call|ring/i.test(t)) return "doorbell";
  if (/sound|noise|audio|cry/i.test(t)) return "sound";
  return t || "alert";
}
export function parseTime(t) {
  if (t === undefined || t === null || t === "") return new Date();
  if (typeof t === "number" || /^\d+$/.test(String(t))) { const n = Number(t); return new Date(n < 1e12 ? n * 1000 : n); }
  const m = String(t).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`);
  const d = new Date(String(t).replace(" ", "T")); return isNaN(d) ? new Date() : d;
}
const LABEL = { person: "Person detected", motion: "Motion", vehicle: "Vehicle detected", doorbell: "Doorbell", sound: "Sound detected", offline: "Camera offline", online: "Camera back online" };
const hhmm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d);

export function createCamAlerts({ kv, imou, notify, publicUrl, hookSecret, now = () => new Date(), log = console }) {
  const lastSent = new Map();
  const seen = new Set();
  let lastPoll = null;

  async function settings() { try { const s = JSON.parse((await kv.get("camera_alerts")) || "{}"); return { ...DEFAULTS, ...s, after_hours: { ...DEFAULTS.after_hours, ...(s.after_hours || {}) }, cameras: { ...(s.cameras || {}) } }; } catch { return { ...DEFAULTS }; } }
  function ruleFor(cfg, name) {
    const own = cfg.cameras[name];
    if (own) return own;
    const r = cfg.default_rules.find((x) => new RegExp(x.match, "i").test(name));
    return r ? { mode: r.mode, people_only: !!r.people_only } : { mode: "off", people_only: false };
  }
  const activeNow = (rule, cfg, d) => cfg.enabled && (rule.mode === "always" || (rule.mode === "after_hours" && isAfterHours(d, cfg.after_hours)));

  async function log_(ev) {
    let list = []; try { list = JSON.parse((await kv.get("camera_events")) || "[]"); } catch {}
    list.push(ev);
    const cutoff = now().getTime() - 7 * DAY_MS;
    await kv.set("camera_events", JSON.stringify(list.filter((e) => e.t >= cutoff).slice(-400)));
  }

  // One alarm from Imou (push or backup check).
  async function handle(p = {}) {
    const did = p.did || p.deviceId || p.deviceid;
    if (!did) return { ok: false, reason: "no device" };
    const kind = kindOf(p.msgType || p.type || p.alarmType);
    if (kind === "numberstat") return { ok: true, ignored: true };
    const at = parseTime(p.time ?? p.localTime);
    const key = `${did}:${kind}:${Math.round(at.getTime() / 10_000)}`;
    if (seen.has(key)) return { ok: true, duplicate: true };
    seen.add(key); if (seen.size > 2000) seen.clear();
    const cams = await imou.cameras().catch(() => []);
    const cam = cams.find((c) => c.id === did) || { id: did, name: p.cname || p.name || did, channel: String(p.cid ?? "0") };
    const pics = p.picUrlArray || p.picurlArray || p.picurls || p.picUrls || (p.picUrl ? [p.picUrl] : []) || [];
    await log_({ t: at.getTime(), cam: cam.name, kind, pic: pics[0] || undefined });

    const cfg = await settings();
    const rule = ruleFor(cfg, cam.name);
    if (kind === "online") return { ok: true, logged: true };
    if (!activeNow(rule, cfg, at)) return { ok: true, logged: true, notified: false, reason: "not watching now" };
    if (rule.people_only && !["person", "vehicle", "doorbell", "offline"].includes(kind)) return { ok: true, logged: true, notified: false, reason: "people only" };
    const coolKey = cam.id + (kind === "offline" ? ":off" : "");
    const cool = (kind === "offline" ? 30 : cfg.cooldown_min) * 60_000;
    if (now().getTime() - (lastSent.get(coolKey) || 0) < cool) return { ok: true, logged: true, notified: false, reason: "cooldown" };
    lastSent.set(coolKey, now().getTime());

    let pic = pics.find((u) => /^https:/.test(u)) || pics[0];
    if (!pic && kind !== "offline") pic = await imou.snapshot(cam).catch(() => undefined);
    const text = kind === "offline" ? `${cam.name} went offline at ${hhmm(at)}.` : `${LABEL[kind] || "Alert"} at ${cam.name}, ${hhmm(at)}. Tap to watch live.`;
    await notify(text, { title: `${LABEL[kind] || "Camera alert"}: ${cam.name}`, tags: kind === "person" ? "rotating_light" : kind === "offline" ? "warning" : "video_camera", priority: kind === "person" ? 4 : 3, click: `https://bernud.onrender.com/camera.html?camera=${encodeURIComponent(cam.name)}`, attach: pic && /^https?:/.test(pic) ? pic : undefined })
      .catch((e) => log.error?.("camera alert notify", e.message));
    return { ok: true, logged: true, notified: true };
  }

  // Tell Imou where to push alarms (only if it isn't already pointing here).
  async function register() {
    const url = `${publicUrl}/camera/hook/${hookSecret}`;
    let cur = {}; try { cur = await imou.call("getMessageCallback", {}); } catch {}
    if (cur.callbackUrl === url && String(cur.status || "on") === "on") return { ok: true, already: true };
    await imou.call("setMessageCallback", { callbackFlag: "alarm,deviceStatus", callbackUrl: url, status: "on" });
    return { ok: true, registered: true };
  }

  // Backup check every ~10 minutes, only for cameras being watched right now (keeps Imou requests low).
  async function poll() {
    const cfg = await settings();
    if (!cfg.enabled) return 0;
    const d = now();
    const since = lastPoll || new Date(d.getTime() - 15 * 60_000);
    lastPoll = d;
    let n = 0;
    for (const cam of await imou.cameras()) {
      if (!cam.online || !activeNow(ruleFor(cfg, cam.name), cfg, d)) continue;
      for (const a of await imou.alarms(cam, since).catch(() => [])) {
        const at = parseTime(a.time ?? a.localDate);
        if (at < since) continue;
        const r = await handle({ did: cam.id, msgType: a.msgType || a.type, time: a.time ?? a.localDate, picUrlArray: a.picurlArray || a.picUrlArray || a.picurls });
        if (r.notified) n++;
      }
    }
    return n;
  }

  async function events({ camera = "", hours = 12 } = {}) {
    let list = []; try { list = JSON.parse((await kv.get("camera_events")) || "[]"); } catch {}
    const since = now().getTime() - Math.min(Math.max(Number(hours) || 12, 1), 168) * 3600_000;
    const q = String(camera || "").toLowerCase().replace(/\b(the|my|camera)\b/g, "").trim();
    const hit = list.filter((e) => e.t >= since && (!q || e.cam.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 2 && e.cam.toLowerCase().includes(w))));
    const byCam = {};
    for (const e of hit) { const c = (byCam[e.cam] ||= { camera: e.cam, total: 0, kinds: {}, first: e.t, last: e.t }); c.total++; c.kinds[e.kind] = (c.kinds[e.kind] || 0) + 1; c.first = Math.min(c.first, e.t); c.last = Math.max(c.last, e.t); }
    return { ok: true, hours: Number(hours) || 12, summary: Object.values(byCam).map((c) => ({ ...c, first: hhmm(new Date(c.first)), last: hhmm(new Date(c.last)) })), recent: hit.slice(-8).reverse().map((e) => ({ camera: e.cam, kind: e.kind, at: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(e.t)) })) };
  }

  async function configure(b = {}) {
    const cfg = await settings();
    const stored = JSON.parse((await kv.get("camera_alerts")) || "{}");
    if (b.action === "set") {
      if (typeof b.enabled === "boolean") stored.enabled = b.enabled;
      if (b.start || b.end || typeof b.weekends === "boolean") stored.after_hours = { ...cfg.after_hours, ...(b.start ? { start: b.start } : {}), ...(b.end ? { end: b.end } : {}), ...(typeof b.weekends === "boolean" ? { weekends: b.weekends } : {}) };
      if (b.camera) {
        const cam = await imou.find(b.camera);
        const cur = ruleFor(cfg, cam.name);
        stored.cameras = { ...(stored.cameras || {}), [cam.name]: { mode: ["always", "after_hours", "off"].includes(b.mode) ? b.mode : cur.mode, people_only: typeof b.people_only === "boolean" ? b.people_only : cur.people_only } };
      }
      await kv.set("camera_alerts", JSON.stringify(stored));
    }
    const fresh = await settings();
    const cams = await imou.cameras().catch(() => []);
    return { ok: true, enabled: fresh.enabled, after_hours: fresh.after_hours, watching_now: cams.filter((c) => activeNow(ruleFor(fresh, c.name), fresh, now())).map((c) => c.name), cameras: cams.map((c) => ({ camera: c.name, online: c.online, ...ruleFor(fresh, c.name) })) };
  }

  return {
    handle, register, poll, events, configure,
    start() {
      register().then((r) => log.log?.("camera alerts", JSON.stringify(r))).catch((e) => log.error?.("camera alerts register", e.message));
      const t = setInterval(() => poll().catch((e) => log.error?.("camera poll", e.message)), 10 * 60_000); t.unref?.();
    },
  };
}
