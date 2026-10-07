// Admin → Updates & reviews. Posts (create, drafts, archive) and review moderation stay in the storefront's
// Updates module so nothing is duplicated; Admin shows it in "admin view" (no customer menu, cart or chat bubble).
import { icon } from '../components.js?v=3';

export function renderUpdates(content) {
  content.innerHTML = `<header class="module-heading updates-heading"><div><h1>Updates &amp; reviews</h1><p>Post photos, videos and store news, manage drafts, and choose which customer reviews are shown.</p></div>
      <a class="button" href="../index.html?fresh=1" target="_blank" rel="noopener">${icon('eye')} See it as a customer</a></header>
    <section class="panel updates-frame"><div class="updates-loading" role="status" aria-live="polite"><span class="skel skel-line skel-line--long"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--short"></span></div>
      <iframe title="Updates and reviews" src="../index.html?fresh=1&amp;embed=admin&amp;v=3" loading="eager"></iframe></section>`;
  const frame = content.querySelector('iframe'), loading = content.querySelector('.updates-loading');
  frame.addEventListener('load', () => { loading.remove(); frame.classList.add('is-ready'); }, { once: true });
}
