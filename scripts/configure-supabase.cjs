// Static-site build step only. No application backend server is introduced.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) {
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. Secret/service-role keys are not accepted.');
}
const parsed = new URL(url);
if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || parsed.username || parsed.password) {
  throw new Error('Use your HTTPS Supabase project URL.');
}
// Optional: the public Google OAuth client ID (the same one as in Supabase Auth → Google). It turns on Google's own
// sign-in button, which names this site instead of the Supabase address. Client IDs are public; the secret never goes here.
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
if (googleClientId && !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleClientId)) throw new Error('GOOGLE_CLIENT_ID must look like 123-abc.apps.googleusercontent.com.');
fs.writeFileSync(path.join(root, 'shared/supabase-config.js'), '// Generated public configuration. Never put service-role secrets here.\nwindow.LexcSupabaseConfig = Object.freeze(' + JSON.stringify({ url: parsed.origin, key, ...(googleClientId ? { googleClientId } : {}) }) + ');\n');
fs.mkdirSync(path.join(root, 'shared/vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), path.join(root, 'shared/vendor/supabase.js'));
console.log('Generated public config and pinned Supabase browser bundle.');
