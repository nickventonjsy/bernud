// Minimal service worker so Bernud can be installed as an app.
// It does not cache anything: Bernud always needs the network to talk.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
