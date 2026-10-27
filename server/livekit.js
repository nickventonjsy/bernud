// LiveKit mode plumbing on the main server: a short-lived room token for the dashboard, and keeping the
// agent worker (livekit-agent.js) running as a child process while the LiveKit settings are present.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function createLiveKit({ url = process.env.LIVEKIT_URL || "", apiKey = process.env.LIVEKIT_API_KEY || "", apiSecret = process.env.LIVEKIT_API_SECRET || "", port = process.env.PORT || "10000", dashKey = process.env.DASHBOARD_KEY || "", log = console, spawnImpl = spawn, tokenImpl = null } = {}) {
  const configured = Boolean(url && apiKey && apiSecret);
  let child = null, restarts = 0, lastExit = null, startedAt = null, stopping = false;

  // A token that lets one browser (or the phone app) into a fresh room; the worker joins the room as Bernard.
  async function token({ identity = "nicholas", room = null, ttlSeconds = 2 * 3600 } = {}) {
    if (!configured) throw Object.assign(new Error("LiveKit isn't set up on the server yet (LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Render)."), { code: "not_set_up" });
    room = room || "bernud-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const makeToken = tokenImpl || (async () => {
      const { AccessToken } = await import("livekit-server-sdk");
      const at = new AccessToken(apiKey, apiSecret, { identity, name: "Nicholas", ttl: ttlSeconds });
      at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      return at.toJwt();
    });
    return { ok: true, url, room, identity, token: await makeToken({ identity, room, ttlSeconds }) };
  }

  function start() {
    if (!configured || child || stopping) return false;
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "livekit-agent.js");
    startedAt = Date.now();
    child = spawnImpl(process.execPath, [file, "start"], {
      env: { ...process.env, PORT: String(port), DASHBOARD_KEY: dashKey, LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const relay = (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim()) log.log?.("livekit: " + line.slice(0, 300)); };
    child.stdout?.on("data", relay); child.stderr?.on("data", relay);
    child.on("exit", (code, signal) => {
      lastExit = { code, signal, at: new Date().toISOString(), after_ms: Date.now() - startedAt };
      child = null;
      if (stopping) return;
      // Keep it alive, but back off if it keeps dying straight away.
      const quick = lastExit.after_ms < 30_000;
      restarts = quick ? restarts + 1 : 0;
      const delay = Math.min(60_000, quick ? 5_000 * 2 ** Math.min(restarts, 3) : 2_000);
      log.error?.(`livekit worker exited (${code ?? signal}); restarting in ${delay / 1000}s`);
      setTimeout(start, delay).unref?.();
    });
    log.log?.("livekit: worker started");
    return true;
  }

  function stop() { stopping = true; try { child?.kill(); } catch {} child = null; }

  return {
    configured, token, start, stop,
    status() { return { configured, running: Boolean(child), pid: child?.pid || null, started_at: startedAt ? new Date(startedAt).toISOString() : null, last_exit: lastExit, restarts }; },
  };
}
