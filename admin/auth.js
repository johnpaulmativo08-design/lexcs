// Supabase Auth is shared with the storefront; RLS enforces backend authorization.
// There is no separate admin log-in page: signed-out visitors go to the shop's Log in screen, which sends admin
// accounts back here after signing in.
const ADMIN_LOGIN = '../?login=admin';
window.LexcAdminAuth = {
  account: null,
  level: null,   // 'admin' (owner) or 'staff' (cashier); the database decides what each may do, this only shapes the screens
  async isLoggedIn() {
    this.account = await window.LexcBackend.identity();
    const role = this.account?.role;
    if (role === 'admin') this.level = 'admin';
    else if (role === 'staff') this.level = await window.LexcBackend.rpc('my_access_level', {}).catch(() => null) === 'staff' ? 'staff' : 'off';
    else this.level = null;
    if (this.level === 'admin' || this.level === 'staff') document.documentElement.dataset.level = this.level;
    return this.level === 'admin' || this.level === 'staff';
  },
  async login(email, password) {
    this.account = await window.LexcBackend.signIn(email, password);
    if (!['admin', 'staff'].includes(this.account?.role)) throw new Error('This account does not have Admin access.');
    return true;
  },
  async logout() {
    try { await window.LexcBackend.signOut(); location.replace('../'); }
    catch (error) { alert(error.message); }
  },
  async guard() {
    try {
      if (await this.isLoggedIn()) { document.documentElement.hidden = false; return true; }
    } catch (error) { console.error('Admin session check failed:', error.message); }
    // a cashier the owner switched off goes back to the shop (not to Log in, which would send them here again)
    if (this.level === 'off') { try { sessionStorage.setItem('lexc_staff_off', '1'); } catch {} location.replace('../'); return false; }
    location.replace(ADMIN_LOGIN);
    return false;
  }
};
if (document.documentElement.hasAttribute('data-admin-protected')) document.documentElement.hidden = true;
window.LexcBackend.client.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT' && document.documentElement.hasAttribute('data-admin-protected')) {
    document.documentElement.hidden = true;
    location.replace('../');
  }
});
sessionStorage.removeItem('admin_logged_in');
