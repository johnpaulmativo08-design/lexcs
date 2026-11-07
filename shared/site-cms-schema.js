// Website CMS map (phase 104): every customer-page section the Admin can edit, where it is on the page and what it
// offers. Shared by the site loader (shared/site-cms.js) and the editor (admin/pages/website.js), so both always agree.
// Only pages and sections that exist on the site are listed. Field types:
//   text   plain text (textContent)              rich  text with **bold**, *italic* and line breaks
//   image  an <img> (desktop) and optional mobile <source>   bg  a background image (CSS --bg / --bg-s)
//   link   the address a link or button opens    paras paragraphs (blank line between), with **bold** / *italic*
// style: which style controls fit the section; movable: may be reordered on its page; legal: confirm before hiding.
(function () {
  const STYLE_ALL = ['align', 'text_color', 'heading_color', 'heading_size', 'bg_color', 'spacing'];
  const STYLE_TEXT = ['align', 'text_color', 'heading_color', 'heading_size', 'spacing'];
  const PAGES = [
    { id: 'home', label: 'Homepage', route: 'home', sections: [
      { id: 'hero', label: 'Hero banner', el: '#page-home .ed-hero', style: ['align', 'text_color', 'heading_color', 'heading_size'], fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: 'h1' },
        { k: 'lede', label: 'Description', type: 'text', sel: '.ed-lede' },
        { k: 'button', label: 'Main button text', type: 'text', sel: '.ed-btn' },
        { k: 'button_link', label: 'Main button link', type: 'link', sel: '.ed-btn', placeholder: '?page=shop' },
        { k: 'link2', label: 'Second link text', type: 'text', sel: '.ed-textlink' },
        { k: 'image', label: 'Banner image (desktop)', type: 'image', sel: '.ed-hero-media img' },
        { k: 'image_mobile', label: 'Banner image (phone)', type: 'image', sel: '.ed-hero-media source', mobile: true },
        { k: 'image_alt', label: 'Image description (for screen readers)', type: 'alt', sel: '.ed-hero-media img' } ] },
      { id: 'treats', label: 'Our treats', el: '#page-home .ed-stage', movable: true, style: STYLE_ALL, fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-stage-copy .ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-stage-copy .ed-title' },
        { k: 'body', label: 'Description', type: 'text', sel: '.ed-stage-copy .ed-body' },
        { k: 'button', label: 'Button text', type: 'text', sel: '.ed-stage-copy .ed-btn' } ], note: 'The featured treats come from your products.' },
      { id: 'sharing', label: 'Better when you share', el: '#page-home .ed-two', movable: true, style: STYLE_ALL, fields: [
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-two-head .ed-title' },
        { k: 'body', label: 'Description', type: 'text', sel: '.ed-two-head .ed-body' },
        { k: 'cap1', label: 'First photo title', type: 'text', sel: '.ed-two-item:nth-child(1) .ed-two-cap strong' },
        { k: 'img1', label: 'First photo', type: 'image', sel: '.ed-two-item:nth-child(1) img' },
        { k: 'cap2', label: 'Second photo title', type: 'text', sel: '.ed-two-item:nth-child(2) .ed-two-cap strong' },
        { k: 'img2', label: 'Second photo', type: 'image', sel: '.ed-two-item:nth-child(2) img' } ] },
      { id: 'tables', label: 'Something for every table', el: '#page-home .ed-mosaic', movable: true, style: STYLE_ALL, fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-mosaic-head .ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-mosaic-head .ed-title' },
        { k: 'img1', label: 'Large photo', type: 'image', sel: '.ed-tile:nth-child(1) img' },
        { k: 'cap1', label: 'Large photo label', type: 'text', sel: '.ed-tile:nth-child(1) .ed-tile-cap' } ] },
      { id: 'about', label: 'About us (our story)', el: '#page-home .ed-story', movable: true, style: STYLE_ALL, fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-story-copy .ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-story-copy .ed-title' },
        { k: 'body1', label: 'First paragraph', type: 'text', sel: '.ed-story-copy .ed-body:nth-of-type(2)' },
        { k: 'body2', label: 'Second paragraph', type: 'text', sel: '.ed-story-copy .ed-body:nth-of-type(3)' },
        { k: 'image', label: 'Photo', type: 'image', sel: '.ed-story-media img' } ] },
      { id: 'custom', label: 'DIY customization', el: '#page-home .ed-dark', movable: true, style: ['align', 'text_color', 'heading_color', 'heading_size', 'bg_color', 'spacing'], fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-dark-copy .ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-dark-copy .ed-title' },
        { k: 'body', label: 'Description', type: 'text', sel: '.ed-dark-copy .ed-body' },
        { k: 'button', label: 'Button text', type: 'text', sel: '.ed-dark-copy .ed-btn' },
        { k: 'image', label: 'Photo', type: 'image', sel: '.ed-dark-media img' } ] },
      { id: 'creations', label: 'Recent creations', el: '#page-home .ed-gallery', movable: true, style: STYLE_TEXT, fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-gallery-head .ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-gallery-head .ed-title' },
        { k: 'body', label: 'Description', type: 'text', sel: '.ed-gallery-head .ed-body' } ], note: 'The photos come from Updates & reviews.' },
      { id: 'faq', label: 'FAQs', el: '#page-home .home-faq', movable: true, style: STYLE_TEXT, fields: [
        { k: 'title', label: 'Heading', type: 'rich', sel: '#lp-faq-title' } ], faqs: true, note: 'Questions and answers are managed under FAQs.' },
      { id: 'cta', label: 'Closing call to action', el: '#page-home .ed-cta', movable: true, style: STYLE_ALL, fields: [
        { k: 'eyebrow', label: 'Small heading', type: 'text', sel: '.ed-eyebrow' },
        { k: 'title', label: 'Heading', type: 'rich', sel: '.ed-title' },
        { k: 'body', label: 'Description', type: 'text', sel: '.ed-body' },
        { k: 'button', label: 'Button text', type: 'text', sel: '.ed-btn' },
        { k: 'button_link', label: 'Button link', type: 'link', sel: '.ed-btn', placeholder: '?page=shop' } ] },
      { id: 'footer', label: 'Footer (contact details)', el: '#page-home .lp-footer', style: ['text_color', 'bg_color'], fields: [
        { k: 'name', label: 'Shop name', type: 'text', sel: '.lp-footer-brand strong' },
        { k: 'tagline', label: 'Tagline', type: 'text', sel: '.lp-footer-brand p:not(.lp-footer-meta)' },
        { k: 'meta', label: 'Address, hours and delivery', type: 'text', sel: '.lp-footer-meta' } ] } ] },
    { id: 'menu', label: 'Menu', route: 'shop', sections: [1, 2, 3, 4, 5].map((n) => ({
      id: 'banner-' + n, label: 'Menu banner ' + n, el: `#carouselTrack .carousel-slide:nth-child(${n})`, style: ['text_color'], fields: [
        { k: 'tag', label: 'Label', type: 'text', sel: '.carousel-tag' },
        { k: 'title', label: 'Heading', type: 'text', sel: '.carousel-title' },
        { k: 'sub', label: 'Description', type: 'text', sel: '.carousel-sub' },
        { k: 'image', label: 'Image (desktop)', type: 'bg', sel: '', css: '--bg' },
        { k: 'image_mobile', label: 'Image (phone)', type: 'bg', sel: '', css: '--bg-s', mobile: true } ] })) },
    { id: 'packages', label: 'Treats & packages', route: 'packages', sections: [
      { id: 'intro', label: 'Page heading', el: '#page-packages .shop-content', style: STYLE_TEXT, fields: [
        { k: 'label', label: 'Small heading', type: 'text', sel: '.section-label' },
        { k: 'title', label: 'Heading', type: 'text', sel: '.section-title' },
        { k: 'body', label: 'Introduction', type: 'text', sel: '.section-title + p' } ], note: 'The packages themselves come from Products.' } ] },
    { id: 'terms', label: 'Terms & Conditions', route: 'register', sections: [
      { id: 'terms', label: 'Terms & Conditions', el: '#regTermsDialog', legal: true, style: ['text_color'], fields: [
        { k: 'title', label: 'Heading', type: 'text', sel: '#regTermsTitle' },
        { k: 'body', label: 'Terms (one paragraph per block; start a block with **1. Title.** for a bold lead)', type: 'paras', sel: '.reg-terms' } ] } ] },
    { id: 'global', label: 'Header & fonts', route: 'home', sections: [
      { id: 'header', label: 'Header navigation', el: 'nav .nav-links', style: [], fields: [
        { k: 'nav1', label: 'Home label', type: 'text', sel: 'li:nth-child(1) a' },
        { k: 'nav2', label: 'Menu label', type: 'text', sel: 'li:nth-child(2) a' },
        { k: 'nav3', label: 'DIY customization label', type: 'text', sel: 'li:nth-child(3) a' },
        { k: 'nav4', label: 'Sweet moments label', type: 'text', sel: 'li:nth-child(4) a' },
        { k: 'nav5', label: 'About label', type: 'text', sel: 'li:nth-child(5) a' } ] },
      { id: 'theme', label: 'Fonts', el: null, style: [], fields: [
        { k: 'heading_font', label: 'Heading font', type: 'font' },
        { k: 'body_font', label: 'Body font', type: 'font' } ] } ] },
  ];
  const FONTS = [
    { id: 'brand', label: 'LexC’s current fonts', css: null, note: 'Playfair Display headings, Plus Jakarta Sans text (as now)' },
    { id: 'Inter', label: 'Inter', css: "'Inter', system-ui, sans-serif", note: 'Clear and neutral — great for body text' },
    { id: 'Manrope', label: 'Manrope', css: "'Manrope', system-ui, sans-serif", note: 'Modern and friendly — great for headings' },
    { id: 'Figtree', label: 'Figtree', css: "'Figtree', system-ui, sans-serif", note: 'Warm and rounded' },
    { id: 'DM Sans', label: 'DM Sans', css: "'DM Sans', system-ui, sans-serif", note: 'Clean and professional' },
    { id: 'Playfair Display', label: 'Playfair Display', css: "'Playfair Display', Georgia, serif", note: 'Decorative — for headings only' },
  ];
  const fontUrl = (ids) => {
    const fams = [...new Set(ids)].filter((id) => id && id !== 'brand' && FONTS.some((f) => f.id === id));
    return fams.length ? 'https://fonts.googleapis.com/css2?' + fams.map((f) => 'family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700;800').join('&') + '&display=swap' : null;
  };
  window.LexcSiteSchema = { PAGES, FONTS, fontUrl, page: (id) => PAGES.find((p) => p.id === id), section: (p, s) => PAGES.find((x) => x.id === p)?.sections.find((x) => x.id === s) };
})();
