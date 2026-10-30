# Bernard (bernud): notes for Claude sessions

## Toolbox
- **REA (Reverse Engineer Anything)**, https://github.com/morluto/rea. Nicholas asked for this in Claude's toolbox
  (not Bernard's). Use it when a device or app has no public API and we need to see how its own app talks to it:
  Imou cameras, Fire TV, Samsung Health (watch data), Alexa/Echo, Govee local control.
  The cloud workspace is wiped between sessions, so set it up when needed (tested 27 Oct 2026, REA 6.8.0):
  ```
  mkdir -p /home/claude/tools/rea && cd /home/claude/tools/rea && npm init -y >/dev/null
  env -u npm_config_noproxy -u NO_PROXY -u no_proxy npm --noproxy="" --proxy "$HTTPS_PROXY" --https-proxy "$HTTPS_PROXY" install rea-agents@latest
  mkdir -p engines && curl -fsSL -o engines/jadx-headless-mcp-0.7.1-all.jar https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
  export REA_JADX_MCP_JAR=/home/claude/tools/rea/engines/jadx-headless-mcp-0.7.1-all.jar
  ./node_modules/.bin/rea inspect-android-package <app.apk>          # manifest, components, permissions
  ./node_modules/.bin/rea inspect-android-method <apk> <class> <method> --format json   # decompile one method
  ```
  (The registry is only reachable through the agent proxy, hence the proxy flags; direct DNS fails.)
  Android (JADX) and static JS/Electron analysis work here; native binaries would need Ghidra on Nicholas's PC.
  Get APKs from the device (`adb pull`) or from the app's own download; never from third-party mirrors.
  Never register REA as a tool on Bernard's ElevenLabs agent.

## Working rules (from Nicholas)
- Never ask for passwords or credentials in chat; he enters secrets into Render himself.
- The GitHub repo is public: never commit secrets.
- Do not claim Bernard has been updated unless the change is saved and deployed.
- Deploys are manual: trigger both the server (srv-dbedbmm7bikc73832b10) and the dashboard static site
  (srv-dbecndo473hc73csre60) on Render after pushing. Android builds publish android-vN releases.
- LiveKit mode's voice worker is a third Render service, bernud-voice (start: node server/livekit-agent.js start).
  It is NOT run inside bernud-server: the 512MB Starter instance can't hold both (it got OOM-killed on 27 Oct).
  Redeploy it too when server/livekit-agent.js or brain behaviour it depends on changes.
- The dashboard version (`DASH_VERSION` in index.html) is bumped by a pre-commit hook; keep the
  version line at the bottom of the dashboard accurate. The Android version is the GitHub run number (automatic).
- Messages and calls made on Nicholas's behalf always need a read-back and his yes. The server enforces this
  (devices.js `createSendGate` + brain.js `SAID_YES`); never weaken it.
- In voice, Bernard calls him "sir", never by name.

## Session start (the workspace is fresh each time)
```
cd /home/claude/bernud && git config core.hooksPath .githooks   # the version-bump hook lives in .githooks/
cd server && npm ci >/dev/null                                   # if node_modules is missing
npm test                                                         # parallel runner, ~20s; `npm run test:serial` is the old 60s+ chain
node run-tests.mjs jarvis brain                                  # just the files whose names match
```
New test files are picked up automatically (any `test-*.js`). End a test file with `process.exit(0)`; open timers otherwise hang it.

## Map of the code
- `server/index.js`: HTTP routes, wiring of every module, `PROMPT_FIXES` (guarded edits applied to the ElevenLabs
  prompt at boot: each is a function that returns `base` unchanged if its text is already there, so it never duplicates).
- `server/brain.js`: the LLM brain used by phone voice (LiveKit) and chat. `GROUPS` decides which tools load
  for a request (`pickGroups(text)`), so **a new tool that isn't in a GROUP is invisible in phone voice mode.**
- `server/livekit-agent.js`: the phone voice worker (Groq Whisper STT, transcript screening, goodbye rules, holding line).
- `server/jarvis.js`: newer "around the house" features (announce, party, sports, rewind, diary, sleep timer, home reminders...).
- `server/digests.js`: timed jobs (brief, diary 22:30, spoken news 07:30). `server/scheduler.js`, `reminders.js`: reminders.
- Devices: `smartthings.js` (TVs), `govee.js` (lights), `imou.js`/`camalerts.js` (cameras), `speakers.js` (Spotify devices),
  `devices.js` (phone control, WhatsApp, send gate). Messaging out: `telegram.js`.
- `index.html` (dashboard), `camera.html` (camera/TV screen), `android/` (phone app), `pc-helper/` (Windows helper).
- Storage: Postgres kv via `db.kv.get/set` (JSON values).

## Adding a feature Bernard can use (checklist)
1. Logic in a module (usually `jarvis.js`) with injected deps, so tests can fake them. Test it in a `test-*.js`.
2. Route in `index.js` (POST, `x-bernud-key` webhook key, the same as the others).
3. ElevenLabs: create a webhook tool (agent `agent_0501m5q6cc15eqcrnamk2e1w84xc`) and **add its id to the agent's tool_ids**.
   Copy the auth header setup from an existing tool (e.g. sleep_timer) rather than typing the key.
4. `brain.js` `GROUPS`: add an entry with a trigger regex, and check `pickGroups("...")` picks it for real phrasings.
5. `PROMPT_FIXES`: one guarded line telling Bernard when to use it.
6. `npm test`, commit, push, deploy server + bernud-voice (+ dashboard if front-end files changed).

## Deploying and checking
- Render MCP calls need `workspaceId: "tea-dbc9rhjl550s73fpp8a0"` every time (there is no saved selection).
  Server srv-dbedbmm7bikc73832b10, voice worker srv-dbgh353bc2fs739sjcrg, dashboard srv-dbecndo473hc73csre60.
  Trigger, wait ~90s, then `get_deploy` until `live`. Only then say it's deployed.
- This sandbox can't reach *.onrender.com. To hit a live endpoint, use the browser: open
  https://bernud-server.onrender.com/health, run a same-origin `fetch()` with javascript_tool, close the tab.
  Keys come from Render env vars / the earlier session, never from this file (the repo is public).
- Logs: Render `list_logs` on the server and voice worker are the evidence for "make Bernard better" rounds
  (look for misheard phrases, slow replies, tool errors, "didn't work" complaints).
