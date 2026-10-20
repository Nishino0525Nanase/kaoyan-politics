/* Small platform fallbacks for older Android System WebView. ES5 syntax only. */
(function () {
  'use strict';
  function replaceChildren() {
    var fragment = document.createDocumentFragment();
    var i, item;
    for (i = 0; i < arguments.length; i++) {
      item = arguments[i];
      fragment.appendChild(item && typeof item === 'object' && typeof item.nodeType === 'number' ? item : document.createTextNode(String(item)));
    }
    while (this.firstChild) this.removeChild(this.firstChild);
    this.appendChild(fragment);
  }
  function installReplaceChildren(prototype) {
    if (prototype && typeof prototype.replaceChildren !== 'function') {
      Object.defineProperty(prototype, 'replaceChildren', { configurable: true, writable: true, value: replaceChildren });
    }
  }
  installReplaceChildren(window.Element && window.Element.prototype);
  installReplaceChildren(window.DocumentFragment && window.DocumentFragment.prototype);

  function readBlobText() {
    var blob = this;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('无法读取文件')); };
      reader.onabort = function () { reject(new Error('文件读取已取消')); };
      reader.readAsText(blob, 'UTF-8');
    });
  }
  if (window.Blob && typeof window.Blob.prototype.text !== 'function') {
    Object.defineProperty(window.Blob.prototype, 'text', { configurable: true, writable: true, value: readBlobText });
  }
  if (window.File && typeof window.File.prototype.text !== 'function') {
    Object.defineProperty(window.File.prototype, 'text', { configurable: true, writable: true, value: readBlobText });
  }

  var dialogs = document.querySelectorAll('dialog');
  var active = [];
  var originalOverflow = '';
  var focusSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function eventOf(name, cancelable) {
    var event = document.createEvent('Event');
    event.initEvent(name, false, cancelable);
    return event;
  }
  function focusable(dialog) {
    var candidates = dialog.querySelectorAll(focusSelector);
    var result = [], i;
    for (i = 0; i < candidates.length; i++) {
      if (candidates[i].getClientRects().length && !candidates[i].hidden) result.push(candidates[i]);
    }
    return result;
  }
  function installDialog(dialog) {
    if (typeof dialog.showModal === 'function' && typeof dialog.close === 'function') return;
    var backdrop = null;
    var previousFocus = null;
    dialog.classList.add('dialog-compat');
    if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
    dialog.showModal = function () {
      if (dialog.hasAttribute('open')) return;
      previousFocus = document.activeElement;
      if (!active.length) {
        originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      active.push(dialog);
      backdrop = document.createElement('div');
      backdrop.className = 'dialog-compat-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.addEventListener('click', function () { dialog.close(); });
      document.body.appendChild(backdrop);
      dialog.setAttribute('open', '');
      dialog.setAttribute('aria-modal', 'true');
      var target = dialog.querySelector('[autofocus]');
      if (!target) target = focusable(dialog)[0];
      if (!target) {
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        target = dialog;
      }
      if (target && typeof target.focus === 'function') target.focus();
    };
    dialog.close = function (returnValue) {
      if (!dialog.hasAttribute('open')) return;
      if (returnValue !== undefined) dialog.returnValue = String(returnValue);
      dialog.removeAttribute('open');
      dialog.removeAttribute('aria-modal');
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      backdrop = null;
      var index = active.indexOf(dialog);
      if (index >= 0) active.splice(index, 1);
      if (!active.length) document.body.style.overflow = originalOverflow;
      if (previousFocus && document.documentElement.contains(previousFocus) && typeof previousFocus.focus === 'function') previousFocus.focus();
      previousFocus = null;
      dialog.dispatchEvent(eventOf('close', false));
    };
  }
  var i;
  for (i = 0; i < dialogs.length; i++) installDialog(dialogs[i]);
  if (dialogs.length) {
    document.addEventListener('keydown', function (event) {
      if (!active.length) return;
      var dialog = active[active.length - 1];
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        if (dialog.dispatchEvent(eventOf('cancel', true))) dialog.close();
      } else if (event.key === 'Tab' || event.keyCode === 9) {
        var targets = focusable(dialog);
        var first = targets[0], last = targets[targets.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });
  }
})();
