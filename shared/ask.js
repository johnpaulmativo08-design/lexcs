// In-page confirmation (replaces window.confirm, which some embedded and mobile browsers block silently,
// making buttons look dead). Resolves true when the person confirms, false on Cancel / Esc / outside click.
const STYLE = `
.lx-ask{width:min(420px,calc(100vw - 32px));padding:0;border:0;border-radius:16px;background:#fff;color:#1f1735;box-shadow:0 24px 60px rgba(32,18,60,.28);font-family:inherit}
.lx-ask::backdrop{background:rgba(26,18,48,.45)}
.lx-ask form{display:grid;gap:10px;padding:20px 20px 16px}
.lx-ask h2{margin:0;font-size:17px;line-height:1.3}
.lx-ask p{margin:0;color:#5b5370;font-size:14.5px;line-height:1.5}
.lx-ask__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
.lx-ask__actions button{min-height:42px;padding:0 16px;border-radius:10px;font:700 14px inherit;cursor:pointer}
.lx-ask__cancel{border:1.5px solid #ddd3ee;background:#fff;color:#4b3a6b}
.lx-ask__ok{border:0;background:#6033dd;color:#fff}
.lx-ask__ok.is-danger{background:#c2364f}
.lx-ask__ok.is-success{background:#1f8a5b}
.lx-ask button:focus-visible{outline:3px solid #b9a1f0;outline-offset:2px}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ask(message, { title = 'Are you sure?', confirm = 'Confirm', cancel = 'Cancel', tone = '' } = {}) {
  if (!document.getElementById('lx-ask-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'lx-ask-style', textContent: STYLE }));
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'lx-ask'; dialog.setAttribute('aria-labelledby', 'lx-ask-title');
    dialog.innerHTML = `<form method="dialog"><h2 id="lx-ask-title">${esc(title)}</h2><p>${esc(message)}</p>
      <div class="lx-ask__actions"><button type="button" class="lx-ask__cancel" value="no">${esc(cancel)}</button><button type="submit" class="lx-ask__ok${tone ? ' is-' + tone : ''}" value="yes">${esc(confirm)}</button></div></form>`;
    let answer = false;
    dialog.querySelector('.lx-ask__cancel').onclick = () => dialog.close();
    dialog.querySelector('.lx-ask__ok').onclick = () => { answer = true; };
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); resolve(answer); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector(tone === 'danger' ? '.lx-ask__cancel' : '.lx-ask__ok').focus();
  });
}
