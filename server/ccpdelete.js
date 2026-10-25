// Deleting files from the CCP AI KNOWLEDGE folder, only when Nicholas asks.
// Safety: files only (never folders), only inside the CCP folder tree, and "delete" means
// Google Drive's Bin (restorable for 30 days), never permanent. Done as the folder's owner
// (corycarpaints@gmail.com) because Drive only lets the owner bin a file.
const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function createCcpDelete({ owner, rootId, driveScope, kv, onChange = () => {}, now = () => new Date() }) {
  const load = async () => { try { return JSON.parse((await kv.get("ccp_trash_log")) || "[]"); } catch { return []; } };
  const save = (v) => kv.set("ccp_trash_log", JSON.stringify(v.slice(-100)));

  async function ready() {
    if (!(await owner.connected())) throw Object.assign(new Error("corycarpaints@gmail.com isn't connected."), { code: "not_connected" });
    if (!(await owner.hasScope(driveScope))) throw Object.assign(new Error("Deleting CCP files needs Google Drive permission on corycarpaints@gmail.com. Nicholas approves it once with the link."), { code: "needs_permission", link: owner.connectLink() });
  }

  const meta = (id) => owner.request(`${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,name,mimeType,parents,trashed,owners(emailAddress),webViewLink,modifiedTime")}&supportsAllDrives=true`);

  // Is this file somewhere under the CCP folder? Walk up the parents (max 12 levels).
  async function insideCcp(file) {
    let parents = file.parents || [];
    for (let depth = 0; depth < 12 && parents.length; depth++) {
      if (parents.includes(rootId)) return true;
      const p = await meta(parents[0]).catch(() => null);
      if (!p) return false;
      parents = p.parents || [];
    }
    return false;
  }

  async function trash(id) {
    await ready();
    if (!id) throw new Error("Which file? Give its id from ccp_search.");
    if (id === rootId) throw new Error("That's the CCP folder itself; Bernard won't delete it.");
    const f = await meta(id).catch((e) => { throw Object.assign(new Error(e.status === 404 ? "That file doesn't exist or isn't visible to the CCP account." : e.message), { code: "not_found" }); });
    if (f.mimeType === FOLDER_MIME) throw Object.assign(new Error(`"${f.name}" is a folder. Bernard only deletes single files; delete folders in Google Drive yourself.`), { code: "is_folder" });
    if (f.trashed) return { ok: true, already_in_bin: true, name: f.name };
    if (!(await insideCcp(f))) throw Object.assign(new Error(`"${f.name}" isn't in the CCP AI KNOWLEDGE folder, so Bernard won't touch it.`), { code: "outside_folder" });
    await owner.request(`${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: "PATCH", body: { trashed: true } })
      .catch((e) => { throw Object.assign(new Error(e.status === 403 ? `Google won't let the CCP account bin "${f.name}"; it's probably owned by someone else (${(f.owners || []).map((o) => o.emailAddress).join(", ")}).` : e.message), { code: "drive_error" }); });
    const log = await load();
    log.push({ id, name: f.name, at: now().toISOString() });
    await save(log);
    onChange();
    return { ok: true, deleted: f.name, note: "Moved to Google Drive's Bin. It can be restored for 30 days (ask Bernard to restore it)." };
  }

  async function restore(idOrName) {
    await ready();
    const log = await load();
    const q = String(idOrName || "").toLowerCase().trim();
    const hit = [...log].reverse().find((x) => x.id === idOrName || (q && x.name.toLowerCase().includes(q))) || (!q ? log[log.length - 1] : null);
    if (!hit) return { ok: false, error: "Nothing Bernard deleted matches that." };
    await owner.request(`${DRIVE}/files/${encodeURIComponent(hit.id)}?supportsAllDrives=true`, { method: "PATCH", body: { trashed: false } })
      .catch((e) => { throw Object.assign(new Error(e.status === 404 ? `"${hit.name}" is no longer in the Bin (it may have been emptied).` : e.message), { code: "drive_error" }); });
    await save(log.filter((x) => x !== hit));
    onChange();
    return { ok: true, restored: hit.name };
  }

  return {
    async handle(b) {
      const action = String(b.action || "");
      if (action === "delete") return trash(String(b.file_id || "").trim());
      if (action === "restore") return restore(String(b.file_id || b.name || "").trim());
      if (action === "recently_deleted") return { ok: true, deleted: (await load()).slice(-10).reverse().map((x) => ({ name: x.name, file_id: x.id, when: x.at })) };
      if (action === "status") { try { await ready(); return { ok: true, can_delete: true }; } catch (e) { return { ok: true, can_delete: false, reason: e.message, link: e.link }; } }
      return { ok: false, error: "action must be delete, restore, recently_deleted or status" };
    },
  };
}
