// Storefront "admin view": index.html?fresh=1&embed=admin is shown inside Admin → Updates & reviews.
// Only the Updates page is used there (posts, drafts, archive, review moderation — same code, same permissions).
// The customer menu, bottom bar, cart and chat bubble are hidden (see .admin-embed in customer-flow.css), and
// anything that would leave Updates opens the customer site in a new tab instead of inside Admin.
(() => {
  if (new URLSearchParams(location.search).get('embed') !== 'admin') return;
  const openSite = (query = '') => window.open('./' + query, '_blank', 'noopener');
  const stay = new Set(['fresh', 'gallery', 'login']);
  const navigateHere = window.navigate;
  window.navigate = function navigateInAdminView(page, ...rest) {
    if (stay.has(page)) return navigateHere.call(this, page, ...rest);
    openSite();
  };
  // a product tagged in a post opens its page on the customer site
  window.openProductDetails = function openProductInSite(id) {
    const product = typeof products !== 'undefined' ? products.find((p) => p.id === id) : null;
    openSite(product?.product_id ? '?product=' + encodeURIComponent(product.product_id) : '');
  };
  window.openCart = () => openSite();
  if (document.body.dataset.customerPage !== 'fresh') navigateHere('fresh');
})();
