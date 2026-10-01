// Both login screens share this one Auth client and session storage key.
(() => {
  const config = window.LexcSupabaseConfig;
  if (!config?.url || !config?.key || !window.supabase) throw new Error('Supabase configuration or client bundle is missing.');
  const client = window.supabase.createClient(config.url, config.key, {
    global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) },
    auth: { storageKey: 'lexc_supabase_auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  // This file lives in <site>/shared/, so its parent folder is the site root.
  const siteRoot = new URL('../', document.currentScript?.src || location.href).href;
  async function identity() {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (error.name === 'AuthSessionMissingError') return null;
      throw error;
    }
    if (!data.user) return null;
    const [profile, role] = await Promise.all([
      client.from('profiles').select('*').eq('id', data.user.id).maybeSingle().then(unwrap),
      client.from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle().then(unwrap)
    ]);
    if (!profile || !role) throw new Error('Your account details could not be loaded. Please try again in a moment.');
    return { ...data.user, profile, role: role.role, name: profile.full_name };
  }
  async function signIn(email, password) {
    unwrap(await client.auth.signInWithPassword({ email: email.trim(), password }));
    // A slow connection can briefly return no account right after the password is accepted; try once more.
    let user = await identity().catch(() => null);
    if (!user) { await new Promise((resolve) => setTimeout(resolve, 800)); user = await identity(); }
    if (!user) throw new Error('You are signed in, but your account did not load. Please try again in a moment.');
    return user;
  }
  const mediaURL = value => {
    if (!value) return '';
    // Site-relative asset: resolve from the site folder (works at "/" locally and "/lexcs/" on GitHub Pages).
    if (value.startsWith('local:')) return new URL(value.slice(6), siteRoot).href;
    if (/^https:\/\//i.test(value)) return value;
    return client.storage.from('catalog-media').getPublicUrl(value).data.publicUrl;
  };
  const api = {
    client, unwrap, identity, signIn, mediaURL,
    async signOut() { unwrap(await client.auth.signOut()); },
    async signUp(name, email, password) {
      return unwrap(await client.auth.signUp({ email: email.trim(), password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: location.origin + '/' }
      }));
    },
    async catalog() {
      return unwrap(await client.from('products').select('*,categories(id,slug,name),product_variants(*)').order('sort_order'))
        .map(product => ({ ...product, product_variants: product.product_variants.sort((a,b) => a.sort_order-b.sort_order) }));
    },
    async categories() { return unwrap(await client.from('categories').select('*').order('sort_order')); },
    async gallery() { return unwrap(await client.from('gallery_entries').select('*').order('sort_order')); },
    async orders() { return unwrap(await client.from('orders').select('*,order_items(*)').order('created_at', { ascending: false })); },
    async customerCart(customerId) {
      const row = unwrap(await client.from('customer_carts').select('items').eq('customer_id', customerId).maybeSingle());
      return Array.isArray(row?.items) ? row.items : [];
    },
    async saveCustomerCart(customerId, items) {
      unwrap(await client.from('customer_carts').upsert({ customer_id: customerId, items, updated_at: new Date().toISOString() }, { onConflict: 'customer_id' }));
    },
    async rpc(name, payload) { return unwrap(await client.rpc(name, payload)); },
    async upload(bucket, folder, file) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5242880) throw new Error('Choose a JPEG, PNG or WebP image up to 5 MB.');
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const path = folder + '/' + crypto.randomUUID() + '.' + extension;
      unwrap(await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type }));
      return path;
    },
    async privateImage(bucket, path) {
      if (!path) return '';
      return unwrap(await client.storage.from(bucket).createSignedUrl(path, 60)).signedUrl;
    }
  };
  window.LexcBackend = Object.freeze(api);
})();
