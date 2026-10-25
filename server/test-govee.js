import assert from "node:assert/strict";
import { createGovee, createLights } from "./govee.js";
const sent = [];
const fake = async (url, o) => {
  const body = o.body ? JSON.parse(o.body) : null;
  if (url.endsWith("/user/devices")) return { ok: true, json: async () => ({ code: 200, data: [{ sku: "H60A1", device: "AA:BB", deviceName: "Ceiling Light", type: "devices.types.light", capabilities: [
    { type: "devices.capabilities.on_off", instance: "powerSwitch" }, { type: "devices.capabilities.range", instance: "brightness" },
    { type: "devices.capabilities.color_setting", instance: "colorRgb" }, { type: "devices.capabilities.color_setting", instance: "colorTemperatureK", parameters: { range: { min: 2700, max: 6500 } } }] }] }) };
  if (url.endsWith("/device/state")) return { ok: true, json: async () => ({ code: 200, payload: { capabilities: [{ instance: "powerSwitch", state: { value: 1 } }, { instance: "brightness", state: { value: 40 } }] } }) };
  sent.push(body.payload.capability); return { ok: true, json: async () => ({ code: 200 }) };
};
const g = createGovee({ apiKey: "k", fetchImpl: fake });
const st = { calls: [], configured: () => true, connected: async () => true, list: async () => [{ name: "hall" }], control: async (x) => { st.calls.push(x); return x.device === "all lights" ? { ok: true, devices: ["hall"] } : { ok: true, device: x.device }; } };
const L = createLights({ smartthings: st, govee: g });
let r = await L.control({ device: "ceiling", action: "on" });
assert.equal(r.device, "Ceiling Light"); assert.deepEqual(sent.at(-1), { type: "devices.capabilities.on_off", instance: "powerSwitch", value: 1 });
await L.control({ device: "ceiling light", action: "brightness", value: "up" });
assert.equal(sent.at(-1).value, 60);
await L.control({ device: "Ceiling", action: "colour", value: "red" });
assert.equal(sent.at(-1).value, 0xff0000);
await L.control({ device: "ceiling", action: "white", value: "candle" });
assert.equal(sent.at(-1).value, 2700); // clamped to the light's range
r = await L.control({ device: "hall", action: "off" });
assert.equal(st.calls.at(-1).device, "hall");
r = await L.control({ device: "all lights", action: "off" });
assert.deepEqual(r.devices, ["hall", "Ceiling Light"]);
assert.equal((await L.list()).length, 2);
r = await L.control({ device: "ceiling", action: "status" });
assert.equal(r.device.power, "on"); assert.equal(r.device.brightness, 40);
console.log("govee tests passed");
