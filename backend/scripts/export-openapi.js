// Writes the generated OpenAPI document to docs/openapi.json (repository root).
const fs = require('fs');
const path = require('path');
const { openApi } = require('../src/app');

const out = path.join(__dirname, '..', '..', 'docs', 'openapi.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(openApi(), null, 2)}\n`);
console.log(`Wrote ${out}`);
