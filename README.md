# Bernud

Nicholas's personal voice assistant. Open the page, tap **Start listening**, then say **"Hey Bernud"**.

- "Hey Bernud" works out of the box in Chrome using its built-in speech recognition (audio goes to the browser's speech service while on standby).
- Optional: add a Picovoice AccessKey and wake word file in Settings for fully on-device detection (no audio leaves the device until the wake word is heard).
- Conversations are handled by the Bernud agent on ElevenLabs (Claude as the brain).
- Say "goodbye" (or tap **Hang up**) and Bernud goes back to standby.

## Optional: private wake word (Picovoice)

1. Create a free account at https://console.picovoice.ai and copy your **AccessKey**.
2. In Porcupine, create the wake word **"Hey Bernud"** (English), platform **Web (WASM)**, and download the `.ppn` file.
3. Open Bernud, tap **Settings**, paste the AccessKey, choose the `.ppn` file and tap **Save**.

The key and wake word file are stored only in that browser on that device. Nothing secret is in this repository.

## Notes

- The page must stay open with the screen on to hear "Hey Bernud" (browsers stop listening in the background). Best on a PC, or a tablet or old phone on charge.
- On Android: open the site in Chrome, then ⋮ → **Add to Home screen / Install** to use it like an app.
- Static site, no build step: `index.html`, `manifest.webmanifest`, `sw.js`, icons.
