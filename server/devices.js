// Remote control of Nicholas's own devices.
// PC: a small PowerShell helper on the PC long-polls this server for commands and posts results back.
// Phone: commands are published to a private ntfy topic; Tasker on the phone picks them up.
import { randomUUID } from "node:crypto";

export const PC_ACTIONS = ["status", "open_app", "close_app", "open_url", "media", "volume", "power", "run_script", "list_scripts", "list_windows", "type_text", "say", "powershell", "system_info", "print", "list_printers"];
export const PHONE_ACTIONS = ["ring", "stop_ring", "torch", "volume", "media", "dnd", "open_url", "open_app", "wifi", "bluetooth", "brightness", "say", "wa_message", "wa_call", "wa_video", "firetv", "note", "come_back"];

export const cleanContactName = (name) => String(name || "").replace(/['"]/g, "_").replace(/[|:\r\n%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
// WhatsApp message for Tasker: "<contact name>::<url-encoded text>" (Tasker splits on "::" and builds a wa.me link).
export function waMessageArg(name, text) {
  const n = cleanContactName(name);
  if (!n) throw new Error("Who should the message go to?");
  const t = String(text || "").trim().slice(0, 1000);
  if (!t) throw new Error("What should the message say?");
  return `${n}::${encodeURIComponent(t)}`;
}

const PC_ONLINE_MS = 60_000;

export function createPcQueue({ resultTimeoutMs = 25_000, pollTimeoutMs = 25_000, timeoutMessage = "The PC didn't answer in time. It may be asleep or the helper may have stopped." } = {}) {
  const pending = [];          // commands not yet collected by the PC
  const waiters = [];          // open poll requests from the PC
  const results = new Map();   // id -> resolve()
  let lastSeen = 0;
  let info = null;

  function deliver() {
    while (pending.length && waiters.length) {
      const w = waiters.shift();
      clearTimeout(w.timer);
      w.resolve(pending.shift());
    }
  }

  return {
    online() { return Date.now() - lastSeen < PC_ONLINE_MS; },
    lastSeen() { return lastSeen ? new Date(lastSeen).toISOString() : null; },
    info() { return info; },

    // Called by the PC helper. Resolves with a command, or null after pollTimeoutMs.
    poll(helperInfo) {
      lastSeen = Date.now();
      if (helperInfo) info = helperInfo;
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((resolve) => {
        const w = { resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); lastSeen = Date.now(); resolve(null); }, pollTimeoutMs) };
        waiters.push(w);
      });
    },

    result(id, ok, output) {
      const r = results.get(id);
      if (!r) return false;
      lastSeen = Date.now();
      results.delete(id);
      r({ ok: Boolean(ok), output: String(output ?? "").slice(0, 4000) });
      return true;
    },

    // Called on behalf of Bernard. Resolves with the PC's result or a timeout notice.
    send(action, target = "", value = "") {
      const cmd = { id: randomUUID(), action, target: String(target ?? ""), value: String(value ?? ""), created_at: new Date().toISOString() };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          results.delete(cmd.id);
          const i = pending.indexOf(cmd);
          if (i >= 0) pending.splice(i, 1);
          resolve({ ok: false, error: "timeout", message: timeoutMessage });
        }, resultTimeoutMs);
        results.set(cmd.id, (r) => { clearTimeout(timer); resolve(r); });
        pending.push(cmd);
        deliver();
      });
    },
  };
}

// Phone commands: "<secret>|<action>|<arg>" so Tasker can split on "|".
export function phoneMessage(secret, action, arg) {
  const clean = (s) => String(s ?? "").replace(/[|\r\n]+/g, " ").trim().slice(0, 3200);
  return `${secret}|${clean(action)}|${clean(arg)}`;
}

export async function ntfyPublish(topic, body, opts = {}) {
  try { return await ntfyPublishOnce(topic, body, opts); }
  catch (e) { await new Promise((r) => setTimeout(r, 1500)); return ntfyPublishOnce(topic, body, opts); } // ntfy.sh has occasional blips
}
async function ntfyPublishOnce(topic, body, { title, click, tags, priority, attach, fetchImpl = fetch } = {}) {
  if (!topic) throw new Error("ntfy topic not configured");
  const headers = { "content-type": "text/plain; charset=utf-8" };
  if (title) headers.title = title;
  if (click) headers.click = click;
  if (tags) headers.tags = tags;
  if (priority) headers.priority = String(priority);
  if (attach) { headers.attach = attach; headers.filename = "camera.jpg"; } // picture shown in the notification
  const r = await fetchImpl(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`ntfy returned ${r.status}`);
  return true;
}
