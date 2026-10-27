# Bernard (bernud): notes for Claude sessions

## Toolbox
- **REA (Reverse Engineer Anything)**, https://github.com/morluto/rea. Nicholas asked for this in Claude's toolbox
  (not Bernard's). Use it when a device or app has no public API and we need to see how its own app talks to it:
  Imou cameras, Fire TV, Samsung Health (watch data), Alexa/Echo, Govee local control.
  The cloud workspace is wiped between sessions, so install it when needed:
  `npx rea-agents setup` (needs registry.npmjs.org; if it's blocked, ask Nicholas to allow it under
  claude.ai Settings > Capabilities). Static JS/Electron and Android (JADX) analysis works without Ghidra.
  Never register REA as a tool on Bernard's ElevenLabs agent.

## Working rules (from Nicholas)
- Never ask for passwords or credentials in chat; he enters secrets into Render himself.
- The GitHub repo is public: never commit secrets.
- Do not claim Bernard has been updated unless the change is saved and deployed.
- Deploys are manual: trigger both the server (srv-dbedbmm7bikc73832b10) and the dashboard static site
  (srv-dbecndo473hc73csre60) on Render after pushing. Android builds publish android-vN releases.
- The dashboard version (`DASH_VERSION` in index.html) is bumped by a pre-commit hook; keep the
  version line at the bottom of the dashboard accurate.
