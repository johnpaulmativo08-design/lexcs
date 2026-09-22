// Read-only extraction of the existing storefront for the initial migration.
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('shared/catalog.js', 'utf8'), context);
const source = fs.readFileSync('index.html', 'utf8');
const gallery = vm.runInNewContext(source.match(/const galleryItems\s*=\s*(\[[\s\S]*?\]);/)[1]);
const packages = [...source.matchAll(/<div class="pkg-card[^"]*">([\s\S]*?)<\/ul>/g)].map(match => ({
  name: match[1].match(/class="pkg-badge"[^>]*>([^<]+)/)[1],
  price: Number(match[1].match(/addPackageToCart\('[^']+', (\d+)/)[1]),
  items: [...match[1].matchAll(/<li>([^<]+)<\/li>/g)].map(item => item[1]),
}));
process.stdout.write(JSON.stringify({ products: context.window.LexcCatalog.products, gallery, packages }));
