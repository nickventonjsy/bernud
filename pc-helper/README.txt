BERNUD PC HELPER
================
Lets Bernard control this PC when you ask him: open/close apps and websites, media and
volume, lock/sleep/restart/shutdown, run your approved scripts, type text, speak, report
system info, and run PowerShell commands you ask for.

Install:   double-click install.cmd   (no admin needed; starts now and at every sign-in)
Remove:    double-click uninstall.cmd
Log:       %LOCALAPPDATA%\Bernud\bernud-pc.log  (every command Bernard runs is logged)

Your own scripts: edit %LOCALAPPDATA%\Bernud\config.json, "scripts" section, e.g.
  "signal app": "cd /d C:\\Users\\you\\workspace\\atlas && python app.py"
then run install.cmd again (or sign out and in) so the helper picks up the change.

Turn off free-form PowerShell: set "allow_powershell": false in that config.json.

How it connects: the helper makes outgoing HTTPS requests to bernud-server.onrender.com
using the device key in config.json. Nothing on this PC listens for connections.
Keep config.json private; anyone with that key could send commands to this PC.
