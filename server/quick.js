// Instant commands: everyday requests Bernard can do without asking an AI (answers in under a second, and still
// works when Google is busy). Anything not matched here goes to the AI as normal.
const NAME = "(?:bernard|bernud|bernie|barnard)";

function clean(text) {
  return String(text || "").toLowerCase()
    .replace(/[’']/g, "'")
    .replace(new RegExp(`^(?:hey |ok |okay |hi )?${NAME}[,.!]?\\s*`), "")
    .replace(new RegExp(`[,.!]?\\s*${NAME}$`), "")
    .replace(/^(?:can|could|would|will) you (?:please )?/, "")
    .replace(/[.!?]+$/, "").replace(/^please /, "").replace(/,? please$/, "")
    .replace(/[.!?,]+$/, "").replace(/\s+/g, " ").trim();
}

const isTv = (d) => /\b(?:tv|telly|television)\b/.test(d);
const isTorch = (d) => /\b(?:torch|flash ?light|flash)\b/.test(d);
const lightName = (d) => {
  d = d.replace(/^(?:the|my) /, "").trim();
  if (/^(?:all )?(?:the )?lights?$|^all (?:of )?the lights$|^everything$/.test(d)) return "all lights";
  return d.replace(/ lights?$/, (m) => (/^(?:ceiling|hall|kitchen|bedroom|lounge|living room|front door)/.test(d) ? m : ""));
};
const NOT_LIGHTS = /\b(?:music|spotify|song|phone|pc|computer|laptop|do not disturb|dnd|wifi|bluetooth|heating|kettle|alarm|volume|radio|youtube|netflix)\b/;

function switchCommand(device, onOff) {
  if (isTorch(device)) return { tool: "phone_control", args: { action: "torch", target: onOff, value: "" }, reply: (r) => (r.ok === false ? null : `Torch ${onOff}.`) };
  if (isTv(device)) {
    const name = device.replace(/^(?:the|my) /, "").replace(/\b(?:tv|telly|television)\b/, "").trim();
    return { tool: "tv_control", args: { action: onOff, device: name ? `${name} tv` : "", value: "" }, reply: (r) => (r.ok === false ? null : `TV ${onOff}.`) };
  }
  if (NOT_LIGHTS.test(device)) return null;
  const name = lightName(device);
  if (!name || name.split(" ").length > 4) return null;
  return {
    tool: "lights", args: { action: onOff, device: name, value: "" },
    reply: (r) => {
      if (r.ok === false || r.error) return null;
      const n = (r.devices || []).length;
      return name === "all lights" ? `All the lights are ${onOff}${n ? "" : ""}.` : `${name[0].toUpperCase() + name.slice(1)} ${onOff}.`;
    },
  };
}

function goodnightReply(r) {
  if (!r || r.ok === false) return null;
  const done = (r.done || []).map((d) => d.replace(/ \(.*\)$/, ""));
  const parts = [`Goodnight, Nicholas.`];
  if (done.length) parts.push(done.length === 1 ? `${cap(done[0])}.` : `${cap(done.slice(0, -1).join(", "))} and ${done.at(-1)}.`);
  if (r.failed?.length) parts.push(`I couldn't manage ${r.failed.map((f) => f.split(":")[0]).join(" or ")}.`);
  const t = r.tomorrow || {};
  if (t.events?.length) parts.push(`Tomorrow you've got ${t.events.slice(0, 2).map((e) => `${e.title}${e.time && e.time !== "all day" ? " at " + e.time : ""}`).join(", then ")}${t.events.length > 2 ? `, plus ${t.events.length - 2} more` : ""}.`);
  else if (t.events) parts.push("Nothing in the calendar tomorrow.");
  if (t.weather) parts.push(`It'll be ${t.weather.summary}, ${t.weather.high_c} degrees${t.weather.rain_chance_pct >= 40 ? `, with a ${t.weather.rain_chance_pct} percent chance of rain` : ""}.`);
  parts.push("Sleep well.");
  return parts.join(" ");
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Returns { tool, args, reply(result) } or null. reply() returns null when the result needs the AI to explain it.
export function matchQuick(text) {
  const t = clean(text);
  if (!t || t.length > 60) return null;
  let m;

  if (/^(?:good ?night|night night|nighty night|i'?m (?:off|going) to bed|bedtime)$/.test(t)) return { tool: "goodnight", args: { action: "run" }, reply: goodnightReply, end: true };

  if ((m = t.match(/^(?:turn |switch |put )?(?:do not disturb|dnd) (on|off)$|^(?:turn|switch|put) (on|off) (?:do not disturb|dnd)$/))) {
    const v = m[1] || m[2];
    return { tool: "phone_control", args: { action: "dnd", target: v, value: "" }, reply: (r) => (r.ok === false ? null : `Do Not Disturb ${v}.`) };
  }
  if ((m = t.match(/^(?:turn|switch|put|flick) (on|off) (?:the |my )?(.+)$/)) || (m = t.match(/^(?:turn|switch|put|flick) (?:the |my )?(.+?) (on|off)$/))) {
    const [onOff, device] = m[1] === "on" || m[1] === "off" ? [m[1], m[2]] : [m[2], m[1]];
    return switchCommand(device, onOff);
  }
  if ((m = t.match(/^(?:the |my )?(.+?) (on|off)$/)) && m[1].split(" ").length <= 3) return switchCommand(m[1], m[2]);
  if ((m = t.match(/^lights? (on|off)$/))) return switchCommand("lights", m[1]);

  if ((m = t.match(/^dim (?:the |my )?(.+?)(?: (?:right )?down)?$/)) && !NOT_LIGHTS.test(m[1]) && !isTv(m[1])) {
    const name = lightName(m[1]);
    return { tool: "lights", args: { action: "brightness", device: name, value: "30" }, reply: (r) => (r.ok === false || r.error ? null : `${cap(name === "all lights" ? "the lights" : name)} dimmed.`) };
  }

  if (/^(?:pause|stop)(?: (?:the |my )?(?:music|song|spotify|track|playing))?$/.test(t)) return { tool: "spotify_control", args: { action: "pause", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Paused.") };
  if (/^(?:resume|unpause|carry on|play(?: (?:the |my )?music)?|resume (?:the )?music|start (?:the )?music again)$/.test(t)) return { tool: "spotify_control", args: { action: "play", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Playing.") };
  if (/^(?:next|skip)(?: (?:this|the))?(?: (?:song|track|one))?$|^next (?:song|track)$/.test(t)) return { tool: "spotify_control", args: { action: "next", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Skipped.") };
  if (/^(?:previous|go back|last)(?: (?:song|track|one))?$|^play (?:the )?(?:previous|last) (?:song|track|one)$/.test(t)) return { tool: "spotify_control", args: { action: "previous", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Going back.") };

  if (/^(?:find|ring|where'?s|where is) my phone$/.test(t)) return { tool: "phone_control", args: { action: "ring", target: "", value: "" }, reply: (r) => (r.ok === false ? null : "Ringing your phone now.") };
  return null;
}
