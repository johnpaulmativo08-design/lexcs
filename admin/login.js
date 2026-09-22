window.LexcAdminAuth.isLoggedIn().then(ok => { if (ok) location.replace('./#dashboard'); }).catch(() => {});
document.querySelector('#admin-login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button[type=submit]');
  const error = document.querySelector('#login-error');
  error.hidden = true;
  button.disabled = true;
  try {
    await window.LexcAdminAuth.login(form.elements.email.value, form.elements.password.value);
    form.elements.password.value = '';
    location.replace('./#dashboard');
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
  } finally { button.disabled = false; }
});
