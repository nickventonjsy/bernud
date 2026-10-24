// YouTube for Bernard: find videos (his subscriptions via ZentraWire, or any video via web search)
// and play them on his PC, phone or a TV (TVs via DIAL "cast", sent from the PC helper on the home network).

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function videoIdFrom(s) {
  const t = String(s || "").trim();
  if (VIDEO_ID.test(t)) return t;
  const m = t.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// PowerShell run by the PC helper: discover DIAL receivers (smart TVs, Fire TV) on the LAN,
// and optionally launch a YouTube video on the one whose name matches.
export function dialScript({ videoId = "", target = "" } = {}) {
  if (videoId && !VIDEO_ID.test(videoId)) throw new Error("bad video id");
  const name = String(target).replace(/[^A-Za-z0-9 '._-]/g, "").slice(0, 40).replace(/'/g, "''");
  return `
$ms = "M-SEARCH * HTTP/1.1\`r\`nHOST: 239.255.255.250:1900\`r\`nMAN: \`"ssdp:discover\`"\`r\`nMX: 2\`r\`nST: urn:dial-multiscreen-org:service:dial:1\`r\`n\`r\`n"
$udp = New-Object System.Net.Sockets.UdpClient; $udp.Client.ReceiveTimeout = 1500
$b = [Text.Encoding]::ASCII.GetBytes($ms); $ep = New-Object System.Net.IPEndPoint ([Net.IPAddress]::Parse('239.255.255.250')), 1900
[void]$udp.Send($b, $b.Length, $ep); Start-Sleep -Milliseconds 300; [void]$udp.Send($b, $b.Length, $ep)
$locs = @{}; $t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt 4) { try { $r = New-Object System.Net.IPEndPoint ([Net.IPAddress]::Any), 0; $d = $udp.Receive([ref]$r); $s = [Text.Encoding]::ASCII.GetString($d); if ($s -match '(?im)^LOCATION:\\s*(\\S+)') { $locs[$Matches[1]] = 1 } } catch { } }
$udp.Close()
$devs = @()
foreach ($l in $locs.Keys) { try { $resp = Invoke-WebRequest -Uri $l -UseBasicParsing -TimeoutSec 3; $app = $resp.Headers['Application-URL']; if ($app -is [array]) { $app = $app[0] }; $nm = ([xml]$resp.Content).root.device.friendlyName; if ($app) { $devs += [pscustomobject]@{ name = [string]$nm; app = [string]$app } } } catch { } }
$vid = '${videoId}'; $want = '${name}'
if (-not $vid) { if ($devs.Count) { 'CAST_DEVICES: ' + (($devs | ForEach-Object { $_.name }) -join ' | ') } else { 'CAST_DEVICES: none found' }; return }
$dev = $null
if ($want) { $dev = $devs | Where-Object { $_.name -like "*$want*" } | Select-Object -First 1 } elseif ($devs.Count -eq 1) { $dev = $devs[0] }
if (-not $dev -and -not $want -and $devs.Count -gt 1) { 'CAST_FAILED: which TV? Found: ' + (($devs | ForEach-Object { $_.name }) -join ' | '); return }
if (-not $dev) { 'CAST_FAILED: no TV matching ''' + $want + ''' on the network. Found: ' + (($devs | ForEach-Object { $_.name }) -join ' | '); return }
$url = $dev.app.TrimEnd('/') + '/YouTube'
try { $res = Invoke-WebRequest -Uri $url -Method Post -Body ('v=' + $vid) -ContentType 'text/plain; charset=utf-8' -UseBasicParsing -TimeoutSec 8; 'CAST_OK: ' + $dev.name + ' (' + $res.StatusCode + ')' }
catch { 'CAST_FAILED: ' + $dev.name + ' refused: ' + $_.Exception.Message }
`.trim();
}

export function createYouTube({ web, zw, pc, notify, smartthings = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function zwGet(params) {
    if (!zw.url || !zw.key) throw Object.assign(new Error("ZentraWire isn't linked."), { code: "not_connected" });
    const r = await fetch(`${zw.url}/api/assistant/youtube?${new URLSearchParams(params)}`, { headers: { "x-zw-assistant": zw.key }, signal: AbortSignal.timeout(15000) });
    return r.json();
  }
  async function zwPost(body) {
    const r = await fetch(`${zw.url}/api/assistant/youtube`, { method: "POST", headers: { "x-zw-assistant": zw.key, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return r.json();
  }

  async function search(q, max = 6) {
    const r = await web.search(`${q} site:youtube.com`, { max: Math.min(max + 4, 10) });
    const seen = new Set(), videos = [];
    for (const x of r.results || []) {
      const id = videoIdFrom(x.url);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      videos.push({ id, title: String(x.title || "").replace(/\s*-\s*YouTube\s*$/i, ""), url: `https://www.youtube.com/watch?v=${id}`, snippet: String(x.snippet || "").slice(0, 160) });
      if (videos.length >= max) break;
    }
    return { query: q, videos, note: videos.length ? undefined : "No YouTube videos found for that." };
  }

  async function play({ id, where, tv }) {
    const vid = videoIdFrom(id);
    if (!vid) throw new Error("I need a YouTube video id or link.");
    const url = `https://www.youtube.com/watch?v=${vid}`;
    if (where === "phone") {
      await notify("Tap to watch on YouTube.", { title: "Video from Bernud", click: url, tags: "tv" });
      return { ok: true, sent_to: "phone", url, note: "Sent as a phone notification; tapping it opens the YouTube app." };
    }
    if (!pc.online()) return { ok: false, error: "pc_offline", message: where === "tv" ? "Playing on the TV goes through the PC on the home Wi-Fi, and the PC isn't connected right now." : "The PC isn't connected right now." };
    if (where === "pc") {
      const r = await pc.send("open_url", url);
      return { ...r, played_on: "pc", url };
    }
    if (where === "tv") {
      // A Samsung TV only accepts casts while it's on: wake it through SmartThings first if it's off.
      let woke = null;
      if (smartthings && !/fire/i.test(tv || "") && (await smartthings.connected().catch(() => false))) {
        try {
          const st = await smartthings.control({ device: tv || "", action: "status" });
          if (st.ok && st.device && st.device.power !== "on") { await smartthings.control({ device: tv || "", action: "on" }); woke = st.device.name; await sleep(9000); }
        } catch {}
      }
      let r = await pc.send("powershell", dialScript({ videoId: vid, target: tv || "" }));
      if (woke && !/CAST_OK:/.test(String(r.output || ""))) { await sleep(4000); r = await pc.send("powershell", dialScript({ videoId: vid, target: tv || "" })); }
      const out = String(r.output || "");
      if (/CAST_OK:/.test(out)) return { ok: true, played_on: out.split("CAST_OK:")[1].trim(), url, switched_tv_on: woke || undefined };
      return { ok: false, error: "cast_failed", message: (out.match(/CAST_FAILED:.*/) || [out || "No answer from the PC."])[0].slice(0, 300), url };
    }
    throw new Error("where must be pc, phone or tv");
  }

  return {
    async handle(b) {
      const action = String(b.action || "");
      if (action === "search") return search(String(b.query || ""), Number(b.max) || 6);
      if (action === "new" || action === "unwatched" || action === "later") return zwGet({ what: action, q: b.query || "", limit: String(b.max || 10) });
      if (action === "channels") return zwGet({ what: "channels" });
      if (action === "save_later") return zwPost({ action: "later", id: videoIdFrom(b.id), on: true });
      if (action === "mark_watched") return zwPost({ action: "watched", id: videoIdFrom(b.id), on: true });
      if (action === "play") return play({ id: b.id, where: b.where || "pc", tv: b.tv });
      if (action === "cast_devices") {
        if (!pc.online()) return { ok: false, error: "pc_offline", message: "Finding TVs goes through the PC, which isn't connected right now." };
        const r = await pc.send("powershell", dialScript({}));
        return { ok: r.ok, devices: String(r.output || "").replace(/^.*CAST_DEVICES:\s*/s, "").split(" | ").filter(Boolean) };
      }
      throw new Error("Unknown action.");
    },
  };
}
