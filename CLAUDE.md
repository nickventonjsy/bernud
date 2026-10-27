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
- The dashboard version (`DASH_VERSION` in index.html) is bumped by a pre-commit hook; keep the
  version line at the bottom of the dashboard accurate.
