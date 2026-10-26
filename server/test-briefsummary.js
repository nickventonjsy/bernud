import assert from "node:assert/strict";
import { briefSummary } from "./briefsummary.js";
const md = `# CCP morning brief, Monday 26 October 2026

## 1. Today at a glance
- **Paint rep** at 10:00 ([Calendar](https://x)).
- 3 unread emails, one from [Supplier: Price list](https://y).

## 2. Top three priorities
- Something

## 7. Recommended first move
Reply to the supplier about the **new price list**.
`;
const s = briefSummary(md);
assert.equal(s, "Paint rep at 10:00 (Calendar). 3 unread emails, one from Supplier: Price list. First move: Reply to the supplier about the new price list.");
assert.ok(briefSummary("just text").includes("just text"));
console.log("briefsummary ok");
