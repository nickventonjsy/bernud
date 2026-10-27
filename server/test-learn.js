import assert from "node:assert";
import { createLearner, similar, parseLearn } from "./learn.js";
const rows = []; const db = { async save(text, category) { const r = { id: String(rows.length + 1), text, category, created_at: new Date().toISOString() }; rows.unshift(r); return r; }, async all() { return [...rows]; }, async remove(id) { const i = rows.findIndex((r) => r.id === id); return i < 0 ? null : rows.splice(i, 1)[0]; } };
let answer = '{"learn": []}'; const calls = [];
const L = createLearner({ db, complete: async (a) => { calls.push(a.text); return answer; }, log: {} });
assert.equal(similar("Nicholas doesn't eat mushrooms", "Nicholas does not eat mushrooms."), true);
assert.equal(similar("Nicholas doesn't eat mushrooms", "Michelle's birthday is in March"), false);
assert.deepEqual(parseLearn('Sure! {"learn":["Nicholas prefers tea to coffee", "x"]}'), ["Nicholas prefers tea to coffee"]);
// Too short / nothing personal: no AI call at all
assert.deepEqual(await L.fromExchange({ user: "lamp on", reply: "Done." }), []); assert.equal(calls.length, 0);
// A correction gets learnt once
answer = '{"learn": ["The lounge lamp is the Govee one, not the SmartThings one"]}';
let learnt = 0; L.onLearned = () => learnt++;
assert.deepEqual(await L.fromExchange({ user: "no, the lounge lamp is the Govee one not the smartthings one", reply: "Noted." }), ["The lounge lamp is the Govee one, not the SmartThings one"]);
assert.deepEqual(await L.fromExchange({ user: "no, the lounge lamp is the Govee one not the smartthings one", reply: "Noted." }), []); // duplicate ignored
assert.equal(learnt, 1); assert.match(calls.at(-1), /Known already:\n- The lounge lamp/);
// Secrets never stored, whatever the AI says
answer = '{"learn": ["Nicholas\'s passcode is 123456"]}';
assert.deepEqual(await L.fromExchange({ user: "my passcode is 123456 remember it", reply: "ok" }), []);
// Prompt block + forget
assert.match(await L.promptBlock(), /# What you've learnt about Nicholas[\s\S]*- The lounge lamp/);
const gone = await L.forgetLast(); assert.match(gone.text, /lounge lamp/); assert.equal(await L.promptBlock(), "");
// Transcript pairing
answer = '{"learn": ["Michelle\'s birthday is 14 March"]}';
const got = await L.fromTranscript([{ role: "agent", message: "Yes?" }, { role: "user", message: "remember michelle's birthday is the fourteenth of march" }, { role: "agent", message: "Noted, Nicholas." }]);
assert.deepEqual(got, ["Michelle's birthday is 14 March"]);
console.log("learn tests passed"); process.exit(0);
