// Parse active frontend files without running application code or touching data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : files(name);
    return /\.(?:js|cjs)$/.test(name) ? [name] : [];
  });
}

const sources = ['shared', 'admin', 'scripts'].flatMap(files);
for (const source of sources) {
  const result = spawnSync(process.execPath, ['--check', source], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(source + '\n' + result.stderr);
}
let inlineCount = 0;
for (const html of ['index.html', 'admin/index.html', 'admin/login.html']) {
  const text = fs.readFileSync(html, 'utf8');
  for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|\btype\s*=\s*["'](?:importmap|application\/)/i.test(match[1]) || !match[2].trim()) continue;
    const name = html + ':inline-' + ++inlineCount;
    if (/\btype\s*=\s*["']module/i.test(match[1])) {
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: match[2], encoding: 'utf8' });
      if (result.status !== 0) throw new Error(name + '\n' + result.stderr);
    } else new vm.Script(match[2], { filename: name });
  }
}
console.log(`PASS syntax: ${sources.length} JavaScript files and ${inlineCount} inline scripts`);
