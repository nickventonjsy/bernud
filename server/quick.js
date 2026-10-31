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
  device = device.replace(/^(?:the|my) /, "");
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
  const parts = [`Goodnight, sir.`];
  if (done.length) parts.push(done.length === 1 ? `${cap(done[0])}.` : `${cap(done.slice(0, -1).join(", "))} and ${done.at(-1)}.`);
  if (r.failed?.length) parts.push(`I couldn't manage ${r.failed.map((f) => f.split(":")[0]).join(" or ")}.`);
  const t = r.tomorrow || {};
  if (t.events?.length) parts.push(`Tomorrow you've got ${t.events.slice(0, 2).map((e) => `${e.title}${e.time && e.time !== "all day" ? " at " + e.time : ""}`).join(", then ")}${t.events.length > 2 ? `, plus ${t.events.length - 2} more` : ""}.`);
  else if (t.events) parts.push("Nothing in the calendar tomorrow.");
  if (t.weather) parts.push(`It'll be ${t.weather.summary}, ${t.weather.high_c} degrees${t.weather.rain_chance_pct >= 40 ? `, with a ${t.weather.rain_chance_pct} percent chance of rain` : ""}.`);
  if (r.verdict) parts.push(r.verdict);
  parts.push("Sleep well.");
  return parts.join(" ");
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listWords = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

// Returns { tool, args, reply(result) } or null. reply() returns null when the result needs the AI to explain it.
// lastDevice: what the previous instant command switched (so "turn it off" works).
export function matchQuick(text, lastDevice = "") {
  let t = clean(text)
    .replace(/^(?:and |now |ok |okay |right |then )+/, "")
    .replace(/ (?:now|again|for me|thanks|thank you)$/, "")
    .replace(/ back (on|off)$/, " $1").replace(/^(turn|switch|put) (on|off) back /, "$1 $2 ");
  if (lastDevice) t = t.replace(/\b(?:it|them|that|those)\b/, lastDevice);
  if (!t || t.length > 60) return null;
  let m;

  if ((m = t.match(/^(?:show|open|play|put|stick|cast|throw|let me see|can i see|bring up|pull up|check)(?: me)?(?: up)?(?: (?:the|my))? ?(.*?) ?(?:camera|cam|cctv)s?(?: feed)?(?: up)?(?: (?:on|to|onto) (?:the |my )?((?:(?:s ?b? ?95 ?b?|samsung|lounge|living room|big|main) ?)?(?:tv|telly|television)|s ?b? ?95 ?b?|phone|laptop|pc|computer|screen))?$/))) {
    const name = m[1] || "", screen = m[2] || "";
    const tv = /tv|telly|television|95/.test(screen);
    return { tool: "camera", args: { action: "show", camera: name, screen: tv ? screen.replace(/s ?b? ?95 ?b? ?/, "S95B ").trim() : screen }, reply: (r) => (r.ok === false ? null : tv ? `The ${r.camera} camera is going up on the ${r.tv || "TV"}, sir. Give it a few seconds.` : `Here's the ${r.camera} camera.`) };
  }
  if (/^(?:(?:it'?s )?bed ?time(?: now| routine)?|time for bed|good ?night|night night|nighty night|i'?m (?:off|going) to bed)$/.test(t)) return { tool: "goodnight", args: { action: "run" }, reply: goodnightReply, end: true };

  // Shopping list
  if ((m = t.match(/^(?:add|put|stick) (.+?) (?:on|to|onto) (?:the |my )?(?:shopping|shopping list|list)$/)) || (m = t.match(/^(?:we need(?! to\b)|we'?re out of|we have run out of|we'?ve run out of) (.+?)(?: for the shopping)?$/))) {
    return { tool: "shopping_list", args: { action: "add", items: m[1] }, reply: (r) => (r.ok === false ? null : r.added.length ? `Added ${listWords(r.added)}. That's ${r.count} on the list.` : `${cap(listWords(r.already))} ${r.already.length === 1 ? "is" : "are"} already on the list.`) };
  }
  if ((m = t.match(/^(?:take|remove|delete|cross|tick) (.+?) (?:off|from) (?:the |my )?(?:shopping|shopping list|list)$/))) {
    return { tool: "shopping_list", args: { action: "remove", items: m[1] }, reply: (r) => (r.ok === false ? null : r.removed.length ? `Taken ${listWords(r.removed)} off. ${r.count} left.` : `I couldn't find that on the list.`) };
  }
  if (/^(?:what'?s|what is|read (?:me )?(?:out )?|tell me what'?s) ?(?:on )?(?:the |my )?shopping list$|^(?:read|check) (?:the |my )?shopping list$/.test(t)) {
    return { tool: "shopping_list", args: { action: "list" }, reply: (r) => (r.ok === false ? null : r.count ? `You've got ${r.count} on the list: ${listWords(r.items)}.` : "The shopping list is empty.") };
  }
  if (/^(?:send|text|give)(?: me)? (?:the |my )?shopping list(?: to (?:my|the) phone)?$/.test(t)) {
    return { tool: "shopping_list", args: { action: "send" }, reply: (r) => (r.ok === false ? null : r.empty ? "The shopping list is empty." : `Sent the shopping list${r.via && /telegram/i.test(r.via) ? " to Telegram, with tick-off buttons" : " to your phone"}, sorted by aisle.`) };
  }
  if (/^(?:open|put|save|copy|stick|make)(?: the| my)? shopping list (?:in|into|to|on|as)(?: a)? (?:samsung )?(?:notes?|keep|google keep)(?: app)?$|^(?:open|put|save) (?:it|that) (?:in|into) (?:samsung )?(?:notes?|keep)$/.test(t)) {
    return { tool: "shopping_list", args: { action: "note" }, reply: (r) => (r.ok === false ? r.message || null : r.empty ? r.message : r.done || "Opened it in Notes.") };
  }

  // "Turn everything on, I'm home": every light plus the S95B only (his rule, 31 Oct). Off is the same in reverse.
  if ((m = t.match(/^(?:(?:can|could|will) you |please )?(?:turn|switch|put) (?:everything|it all|all of it|the lot|all) (on|off)(?: please)?(?:,? ?(?:cause|cos|because|as|since|now) i(?:'?m| am) (?:home|back|in|off|out|going out|leaving)| i(?:'?m| am) (?:home|back))?$|^i(?:'?m| am) (?:home|back),? (?:turn|switch|put) (?:everything|it all) (on)$/))) {
    const on = (m[1] || m[2]) === "on";
    return { tool: "everything", args: { action: on ? "on" : "off" }, reply: (r) => (r.ok === false ? null : r.failed ? null : on ? "Lights on and the S95B is warming up. Welcome home, sir." : "Everything's off, sir.") };
  }

  // Watchdog: "is everything working?"
  if (/^(?:is everything (?:working|ok|okay|alright|all right)|(?:run a |do a )?(?:system|systems) check|status report|are you (?:working|ok|okay) properly|health check)$/.test(t)) {
    return { tool: "system_check", args: {}, reply: (r) => (r.ok === false ? null : r.all_ok ? `Everything's working: ${r.working.length} checks all fine.` : `Mostly fine, but ${r.not_working.map((x) => `${x.name} (${x.problem})`).join("; ")}.`) };
  }

  // Fire TV Stick (before the general on/off patterns, which would treat it as the Samsung TV)
  const FIRE = "(?:the |my )?(?:fire ?(?:tv|stick)|firestick|fire tv stick|amazon (?:stick|fire))";
  if ((m = t.match(new RegExp(`^(?:turn|switch) (on|off) ${FIRE}$`))) || (m = t.match(new RegExp(`^(?:turn|switch) ${FIRE} (on|off)$`)))) {
    const v = m[1];
    return { tool: "firetv", args: { action: v, value: "" }, reply: (r) => (r.ok === false ? null : `Fire TV ${v}.`) };
  }
  if ((m = t.match(new RegExp(`^(?:open|launch|start|put on|go to) (.+?) on ${FIRE}$`)))) {
    return { tool: "firetv", args: { action: "open", value: m[1] }, reply: (r) => (r.ok === false ? null : r.done || `Opening ${m[1]} on the Fire TV.`) };
  }
  if ((m = t.match(new RegExp(`^(pause|play|resume|home|back|go home|go back|mute) ${FIRE}$`))) || (m = t.match(new RegExp(`^${FIRE} (pause|play|resume|home|back|mute)$`)))) {
    const a = { pause: "play_pause", play: "play_pause", resume: "play_pause", home: "home", "go home": "home", back: "back", "go back": "back", mute: "mute" }[m[1]];
    return { tool: "firetv", args: { action: a, value: "" }, reply: (r) => (r.ok === false ? null : "Done.") };
  }

  // Wake-up: "wake me up at 6:45 on weekdays"
  if ((m = t.match(/^(?:wake me(?: up)?|set (?:my |a |an )?(?:wake[- ]?up|alarm)(?: for)?) (?:at )?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)(?: (every ?day|daily|on weekdays|weekdays|at weekends|on weekends|weekends))?$/))) {
    const days = !m[2] ? undefined : /week ?days/.test(m[2]) ? "1-5" : /weekends/.test(m[2]) ? "6-7" : "1-7";
    return { tool: "wakeup", args: { action: "set", time: m[1].replace(/\s+/g, ""), ...(days ? { days } : {}) }, reply: (r) => (r.ok === false ? r.message || null : r.summary) };
  }
  if (/^(?:turn off|cancel|stop|switch off) (?:my |the )?(?:wake[- ]?up|alarm|morning wake[- ]?up)$/.test(t)) {
    return { tool: "wakeup", args: { action: "set", enabled: false }, reply: (r) => (r.ok === false ? null : "Wake-up is off.") };
  }

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

  // A Spotify speaker by name: "play Michelle's oldies on Michelle's Echo", "move the music to the Echo".
  if ((m = t.match(/^(?:play|put on|stick on|put) (.+?) (?:on|through|in) (?:the |michelle'?s |michelles )?(echo|alexa)(?: speaker| dot)?$/))) {
    let what = m[1].replace(/^(?:some |a bit of )/, "");
    const dj = what.match(/^(?:something|some music|music|a mix|a playlist) (?:for|to suit|that suits|while i'?m|while i|to) (.+)$/);
    const args = dj ? { device: "michelle's echo", mood: dj[1] } : /^(?:it|this|that|the music|my music|music|spotify|something)$/.test(what) ? { device: "michelle's echo" } : { device: "michelle's echo", query: what };
    return { tool: "spotify_play_on", args, reply: (r) => (r.ok === false ? null : r.title ? `Playing ${r.title} on ${r.device}.` : r.moved ? `Moved the music to ${r.device}.` : `Playing ${r.playing} on ${r.device}.`) };
  }
  if ((m = t.match(/^(?:move|switch|send|transfer|put) (?:the |my )?(?:music|song|spotify|it|this) (?:on ?)?to (?:the |michelle'?s |michelles )?(echo|alexa)$/))) {
    return { tool: "spotify_play_on", args: { device: "michelle's echo" }, reply: (r) => (r.ok === false ? null : `Moved the music to ${r.device}.`) };
  }
  // Spotify DJ: "play something for a Friday evening", "make me a mix for a long drive".
  if ((m = t.match(/^(?:(?:play|put on)(?: me)? (?:something|some (?:music|songs|tunes)|a mix|music|a playlist)|(?:make|build|do)(?: me)? (?:a )?(?:mix|playlist)|dj(?: me)?(?: something)?) (?:for|to suit|that suits|that fits|that'?s good for|good for|while i'?m|while i|to) (.{3,60})$/))) {
    const mood = m[1].replace(/ on spotify$/, "");
    return { tool: "spotify_dj", args: { mood, count: 25 }, reply: (r) => (r.ok === false ? null : `Here's ${r.title}: ${r.tracks} songs from your liked songs, starting with ${r.starts_with[0]}.`) };
  }
  if (/^(?:pause|stop)(?: (?:the |my )?(?:music|song|spotify|track|playing))?$/.test(t)) return { tool: "spotify_control", args: { action: "pause", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Paused.") };
  if (/^(?:resume|unpause|carry on|play(?: (?:the |my )?music)?|resume (?:the )?music|start (?:the )?music again)$/.test(t)) return { tool: "spotify_control", args: { action: "play", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Playing.") };
  if (/^(?:next|skip)(?: (?:this|the))?(?: (?:song|track|one))?$|^next (?:song|track)$/.test(t)) return { tool: "spotify_control", args: { action: "next", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Skipped.") };
  if (/^(?:previous|go back|last)(?: (?:song|track|one))?$|^play (?:the )?(?:previous|last) (?:song|track|one)$/.test(t)) return { tool: "spotify_control", args: { action: "previous", device_id: "", uri: "", value: "" }, reply: (r) => (r.ok === false || r.error ? null : "Going back.") };

  if (/^(?:(?:ok |okay |right )?(?:go|come|get) back(?: to (?:your|the|bernard'?s?) app| to bernard| here)?|(?:bring|take me) back(?: to (?:your|the) app)?|back to (?:you|your app|bernard)|(?:open|show) (?:your|the bernard) app)[.!]*$/.test(t)) return { tool: "phone_control", args: { action: "come_back", target: "", value: "" }, reply: (r) => (r.ok === false ? null : "Back with you.") };
  if (/^(?:find|ring|where'?s|where is) my phone$/.test(t)) return { tool: "phone_control", args: { action: "ring", target: "", value: "" }, reply: (r) => (r.ok === false ? null : "Ringing your phone now.") };
  return null;
}
