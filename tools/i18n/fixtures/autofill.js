// Test-only login helper. Origins and storage keys are synthetic; requests are intercepted by Playwright.
function setVal(el, value) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  descriptor.set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function fill() {
  const keys = {
    "http://first.example.test:7305": ["firstUser", "firstPass"],
    "http://second.example.test:7305": ["secondUser", "secondPass"]
  }[location.origin];
  if (!keys) return;
  const credentials = await chrome.storage.local.get(keys);
  const username = credentials[keys[0]], password = credentials[keys[1]];
  if (!username || !password) return;
  let filled = false;
  function stop() { clearInterval(timer); clearTimeout(deadline); }
  function tryFill() {
    const passwordField = document.querySelector('#fe_login_password');
    if (!passwordField || passwordField.disabled || passwordField.readOnly || !passwordField.getClientRects().length) return;
    const scope = passwordField.form || document;
    const userField = scope.querySelector('#fe_login_username');
    const button = scope.querySelector('.dialog_buttons .button[onmouseup*="doLogin"]');
    if (!userField || userField.disabled || userField.readOnly || !userField.getClientRects().length || !button) return;
    if ((userField.value && userField.value !== username) || (passwordField.value && passwordField.value !== password)) { stop(); return; }
    if (!filled || userField.value !== username || passwordField.value !== password) {
      userField.focus(); setVal(userField, username);
      passwordField.focus(); setVal(passwordField, password);
      filled = true;
      return;
    }
    if (button.disabled) return;
    stop();
    // Cronicle's original login control handles mouseup on a div.
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  }
  const timer = setInterval(tryFill, 250);
  // shortcut: this compatibility fixture waits at most 30 seconds; use DOM observation for slower forms.
  const deadline = setTimeout(stop, 30000);
  tryFill();
}
fill().catch(error => console.warn('[autofill fixture]', error.message));
