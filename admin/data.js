// Read-only bridge for the current static storefront. No scripts are executed.
// Replace with an authorized catalog/media service when a backend is approved.
let storefrontRequest;
export async function storefrontData() {
  if (!storefrontRequest) storefrontRequest = fetch('../index.html').then(async response => {
    if (!response.ok) throw new Error('The customer catalog could not be loaded.');
    const source = await response.text();
    const imageBlock = source.match(/const PRODUCT_IMAGES\s*=\s*\{([\s\S]*?)\n\};/);
    if (!imageBlock) throw new Error('The storefront image format has changed.');
    const images = Object.fromEntries([...imageBlock[1].matchAll(/(\d+):\s*"(data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+)"/g)].map(match => [match[1], match[2].replace(/[\r\n]/g, '')]));
    const document = new DOMParser().parseFromString(source, 'text/html');
    const packages = [...document.querySelectorAll('#page-packages .pkg-card')].map(card => ({
      name: card.querySelector('.pkg-badge').textContent.trim(),
      price: card.querySelector('.pkg-price').textContent.trim(),
      items: [...card.querySelectorAll('.pkg-items li')].map(item => item.textContent.trim()),
    }));
    return { images, packages };
  }).catch(error => { storefrontRequest = null; throw error; });
  return storefrontRequest;
}
