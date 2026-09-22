// Supabase Auth is shared with the storefront; RLS enforces backend authorization.
window.LexcAdminAuth = {
  account: null,
  async isLoggedIn() { this.account = await window.LexcBackend.identity(); return this.account?.role === 'admin'; },
  async login(email, password) {
    this.account = await window.LexcBackend.signIn(email, password);
    if (this.account?.role !== 'admin') throw new Error('This account does not have Admin access.');
    return true;
  },
  async logout() {
    try { await window.LexcBackend.signOut(); location.replace('login.html'); }
    catch (error) { alert(error.message); }
  },
  async guard() {
    try {
      if (await this.isLoggedIn()) { document.documentElement.hidden = false; return true; }
    } catch (error) { console.error('Admin session check failed:', error.message); }
    location.replace('login.html');
    return false;
  }
};
if (document.documentElement.hasAttribute('data-admin-protected')) document.documentElement.hidden = true;
window.LexcBackend.client.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT' && document.documentElement.hasAttribute('data-admin-protected')) {
    document.documentElement.hidden = true;
    location.replace('login.html');
  }
});
sessionStorage.removeItem('admin_logged_in');
