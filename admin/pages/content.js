// Content (CMS): every way to change what customers read on the website, in one place.
// Homepage text and photos are edited in place on the site (?cms=live); FAQs and announcement banners have their own
// lists (pages/website.js); posts and review moderation are the Updates module (pages/updates.js).
import { escapeHtml as e, icon } from '../components.js?v=5';

const CARDS = [
  ['edit', 'Homepage & pages', 'Open the shop with editing on. Click any text or photo to change it, then Save draft or Publish.', '../?cms=live', 'Edit website', true],
  ['info', 'FAQs', 'The questions on the FAQ page. Add, reorder, hide or edit them. Up to 10 show at a time.', '#website/faqs', 'Manage FAQs'],
  ['alert', 'Banners & announcements', 'Short notices across the top of the site, with start and end dates. Draft, publish or archive.', '#website/announcements', 'Manage banners'],
  ['gallery', 'Posts & reviews', 'Sweet moments posts (create, save drafts, archive) and showing or hiding customer reviews.', '#updates', 'Open posts & reviews'],
];

export function renderContent(content) {
  content.innerHTML = `<header class="vx-hero st-hero"><div class="vx-hero-text"><span class="vx-eyebrow">${icon('edit')} Website</span><h1>Content (CMS)</h1><p>Everything customers read on your website: pages, FAQs, banners and posts.</p></div></header>
    <div class="st-grid cms-grid">${CARDS.map(([ic, title, text, href, label, primary]) => `<section class="st-card cms-card"><h2>${icon(ic)} ${e(title)}</h2><p>${e(text)}</p>
      <div class="st-actions"><a class="button${primary ? ' primary' : ''}" href="${href}">${e(label)} ${icon('arrow')}</a></div></section>`).join('')}</div>`;
}
