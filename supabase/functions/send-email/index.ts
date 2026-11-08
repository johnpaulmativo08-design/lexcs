// Sends the emails the database queued (phase 107) from LexC's Gmail, at most 20 per run.
// pg_cron calls it every minute while emails are waiting. The request carries no data: the function takes the next
// emails with public.email_outbox_claim() (service role only) and reports with public.email_outbox_done().
// Deploy without JWT verification: supabase functions deploy send-email --no-verify-jwt
// Secrets (Supabase → Edge Functions → Secrets):
//   GMAIL_USER          the Gmail address that sends, e.g. lexcsnacktime@gmail.com
//   GMAIL_APP_PASSWORD  a 16-character Google app password (Google Account → Security → 2-Step Verification → App passwords)
//   ADMIN_EMAIL         optional: where LexC's own notices go (default: GMAIL_USER)
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// plain text from the database → a simple branded email (links become buttons-ish links)
function html(subject: string, body: string, name?: string) {
  const lines = esc(body).split('\n').map((l) => l.replace(/(https:\/\/lexcsnacktime\.shop\/[^\s]*)/g, '<a href="$1" style="color:#6b3fa0;font-weight:700">$1</a>')).join('<br>');
  return `<!doctype html><html><body style="margin:0;background:#f6f2fb;font-family:Arial,Helvetica,sans-serif;color:#2b1d3a">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <p style="margin:0 0 14px;font:700 20px Georgia,serif;color:#5c3d6e">LexC's Snacktime</p>
    <div style="background:#fff;border:1px solid #ece2f7;border-radius:16px;padding:22px">
      <h1 style="margin:0 0 12px;font-size:18px;color:#241532">${esc(subject)}</h1>
      ${name ? `<p style="margin:0 0 10px">Hi ${esc(name.split(' ')[0])},</p>` : ''}
      <p style="margin:0;line-height:1.6;font-size:15px">${lines}</p>
    </div>
    <p style="margin:14px 4px 0;font-size:12px;color:#8a7d9c">LexC's Snacktime · 66 Quezon St., Dau, Mabalacat, Pampanga · This is an automatic message.</p>
  </div></body></html>`;
}

Deno.serve(async () => {
  const user = Deno.env.get('GMAIL_USER')?.trim(), pass = (Deno.env.get('GMAIL_APP_PASSWORD') || Deno.env.get(' GMAIL_APP_PASSWORD'))?.replace(/\s+/g, '');   // also the name saved with a leading space
  const admin = Deno.env.get('ADMIN_EMAIL') || user, url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const missing = Object.entries({ GMAIL_USER: user, GMAIL_APP_PASSWORD: pass, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json({ error: 'Missing setting(s): ' + missing.join(', ') }, 500);   // names only, never values
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: batch, error } = await db.rpc('email_outbox_claim');
  if (error) return json({ error: error.message }, 500);
  const list = (batch || []) as { id: number; recipient: string; to: string | null; subject: string; body: string; name?: string }[];
  if (!list.length) return json({ sent: 0 });
  const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  const sent: number[] = [], failed: Record<string, string> = {};
  for (const e of list) {
    const to = e.recipient === 'admin' ? admin : e.to;
    if (!to) { failed[e.id] = 'No email address for this customer.'; continue; }
    try {
      await mail.sendMail({ from: `"LexC's Snacktime" <${user}>`, to, subject: e.subject, text: e.body, html: html(e.subject, e.body, e.recipient === 'customer' ? e.name : undefined) });
      sent.push(e.id);
    } catch (err) { failed[e.id] = String((err as Error)?.message || err).slice(0, 300); }
  }
  const done = await db.rpc('email_outbox_done', { sent, failed });
  return json({ sent: sent.length, failed: Object.keys(failed).length, report_error: done.error?.message || null });
});
