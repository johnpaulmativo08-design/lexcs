(function (root) {
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let smallest = row[0];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        smallest = Math.min(smallest, row[j]);
      }
      if (smallest > limit) return limit + 1;
      previous = row;
    }
    return previous[b.length];
  }
  function score(product, query) {
    const text = normalize([product.name, product.cat, product.desc].join(' '));
    const name = normalize(product.name);
    if (!query) return {value: 0, approximate: false};
    if (name === query) return {value: 0, approximate: false};
    if (name.startsWith(query)) return {value: 1, approximate: false};
    if (text.includes(query)) return {value: 2, approximate: false};
    const queryWords = query.split(' ');
    const words = text.split(' ');
    let total = 0;
    for (const sought of queryWords) {
      if (words.includes(sought)) continue;
      const limit = Math.min(4, Math.max(1, Math.floor(sought.length * 0.4)));
      let closest = limit + 1;
      for (const word of words) closest = Math.min(closest, distance(sought, word, limit));
      if (closest > limit) return null;
      total += closest;
    }
    return {value: 10 + total, approximate: total > 0};
  }
  function rank(products, input) {
    const query = normalize(input);
    if (!query) return products.map(product => ({product, approximate: false}));
    return products.map(product => ({product, match: score(product, query)}))
      .filter(result => result.match)
      .sort((a, b) => a.match.value - b.match.value || a.product.name.localeCompare(b.product.name))
      .map(result => ({product: result.product, approximate: result.match.approximate}));
  }
  const api = {normalize, distance, rank};
  root.LexcFuzzySearch = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
