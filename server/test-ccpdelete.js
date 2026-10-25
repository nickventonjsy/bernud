import assert from "node:assert/strict";
import { createCcpDelete } from "./ccpdelete.js";
const store = new Map(); const kv = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
const files = {
  root: { id: "root", name: "CCP AI KNOWLEDGE", mimeType: "application/vnd.google-apps.folder", parents: ["mydrive"] },
  sub: { id: "sub", name: "Price lists", mimeType: "application/vnd.google-apps.folder", parents: ["root"] },
  f1: { id: "f1", name: "Old price list 2024.pdf", mimeType: "application/pdf", parents: ["sub"] },
  out: { id: "out", name: "Personal.pdf", mimeType: "application/pdf", parents: ["mydrive"] },
  mydrive: { id: "mydrive", name: "My Drive", mimeType: "application/vnd.google-apps.folder", parents: [] },
};
const patches = []; let scope = false; let changes = 0;
const owner = {
  connected: async () => true, hasScope: async () => scope, connectLink: () => "https://link",
  request: async (url, o = {}) => {
    const id = decodeURIComponent(url.split("/files/")[1].split("?")[0]);
    if (!files[id]) throw Object.assign(new Error("nf"), { status: 404 });
    if (o.method === "PATCH") { patches.push([id, o.body.trashed]); files[id].trashed = o.body.trashed; return {}; }
    return files[id];
  },
};
const d = createCcpDelete({ owner, rootId: "root", driveScope: "drive", kv, onChange: () => changes++ });
let r = await d.handle({ action: "delete", file_id: "f1" }).catch((e) => e);
assert.equal(r.code, "needs_permission"); assert.equal(r.link, "https://link");
scope = true;
await assert.rejects(d.handle({ action: "delete", file_id: "out" }), /isn't in the CCP/);
await assert.rejects(d.handle({ action: "delete", file_id: "sub" }), /is a folder/);
await assert.rejects(d.handle({ action: "delete", file_id: "root" }), /folder itself/);
r = await d.handle({ action: "delete", file_id: "f1" });
assert.equal(r.deleted, "Old price list 2024.pdf"); assert.deepEqual(patches, [["f1", true]]); assert.equal(changes, 1);
assert.equal((await d.handle({ action: "recently_deleted" })).deleted.length, 1);
r = await d.handle({ action: "restore", name: "price list" });
assert.equal(r.restored, "Old price list 2024.pdf"); assert.deepEqual(patches.at(-1), ["f1", false]);
console.log("ccpdelete tests passed");
