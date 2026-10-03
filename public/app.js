/* Written in ES5 on purpose: this must run on old Android (6-10) stock
   browsers / WebViews whose Chrome engine predates optional chaining,
   async/await, fetch, Element.closest, etc. Do not add modern syntax here. */
(function () {
  'use strict';

  // ---------- Tiny polyfills ----------
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(sel)) return el;
        el = el.parentElement || el.parentNode;
      }
      return null;
    };
  }
  if (!Element.prototype.remove) {
    Element.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (s) { return this.indexOf(s) !== -1; };
  }
  if (!String.prototype.trim) {
    String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };
  }
  if (!window.performance || !window.performance.now) {
    window.performance = window.performance || {};
    window.performance.now = function () { return Date.now ? Date.now() : new Date().getTime(); };
  }

  function $(id) { return document.getElementById(id); }
  var dropzone = $('dropzone');
  var fileInput = $('fileInput');
  var browseBtn = $('browseBtn');
  var uploadsSection = $('uploads');
  var uploadList = $('uploadList');
  var filesEl = $('files');
  var emptyEl = $('empty');
  var searchEl = $('search');
  var clearSearch = $('clearSearch');
  var refreshBtn = $('refreshBtn');
  var statCount = $('statCount');
  var statSize = $('statSize');
  var toastStack = $('toasts');
  var modal = $('modal');
  var modalBody = $('modalBody');
  var modalCancel = $('modalCancel');
  var modalConfirm = $('modalConfirm');

  var allFiles = [];
  var filter = '';
  var pendingDelete = null; // { id, name }

  // `hidden` attribute is unsupported on very old engines; CSS handles [hidden],
  // but setting the property does nothing there, so toggle the attribute instead.
  function setHidden(el, hidden) {
    if (hidden) el.setAttribute('hidden', ''); else el.removeAttribute('hidden');
  }
  function isHidden(el) { return el.hasAttribute('hidden'); }

  function indexOf(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }
  function toArray(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  // ---------- XHR helper (fetch is missing on old WebViews) ----------
  function request(method, url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      cb(xhr.status >= 200 && xhr.status < 300 ? null : (data && data.error) || ('HTTP ' + xhr.status), data, xhr);
    };
    xhr.onerror = function () { cb('network error', null, xhr); };
    xhr.send(null);
  }

  // ---------- Helpers ----------
  function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    bytes = Number(bytes);
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    var n = bytes / Math.pow(1024, i);
    var s = n < 10 && i > 0 ? n.toFixed(2) : n < 100 && i > 0 ? n.toFixed(1) : Math.round(n);
    return s + ' ' + units[i];
  }
  function formatSpeed(bps) { return formatBytes(bps) + '/s'; }
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime()) && typeof iso === 'string') {
      // Old engines can't parse "YYYY-MM-DD HH:MM:SS.mmm"; coerce to ISO.
      d = new Date(iso.replace(' ', 'T'));
    }
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return d.toDateString();
    }
  }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON_SVGS = {
    img: SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    vid: SVG_OPEN + '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m21 8-4 3 4 3z"/></svg>',
    aud: SVG_OPEN + '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    doc: SVG_OPEN + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
    pdf: SVG_OPEN + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    zip: SVG_OPEN + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M10 14h4M10 17h4"/></svg>',
    code: SVG_OPEN + '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    sheet: SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>',
    slide: SVG_OPEN + '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    exe: SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 4 3-4 3M13 16h4"/></svg>',
    txt: SVG_OPEN + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6M8 9h2"/></svg>',
    file: SVG_OPEN + '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>'
  };
  var DOWNLOAD_SVG = SVG_OPEN + '<path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/></svg>';
  var DELETE_SVG = SVG_OPEN + '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>';

  var KINDS = [
    ['img', ['jpg','jpeg','png','gif','webp','bmp','svg','avif','tiff','ico','heic']],
    ['vid', ['mp4','mov','avi','mkv','webm','flv','wmv','m4v','mpg','mpeg']],
    ['aud', ['mp3','wav','flac','aac','ogg','m4a','opus','wma']],
    ['doc', ['doc','docx','odt','rtf','pages']],
    ['sheet', ['xls','xlsx','csv','ods','numbers']],
    ['slide', ['ppt','pptx','key','odp']],
    ['pdf', ['pdf']],
    ['zip', ['zip','rar','7z','tar','gz','bz2','xz','tgz']],
    ['code', ['js','ts','tsx','jsx','py','rb','go','rs','java','c','cpp','h','hpp','cs','php','swift','kt','sh','bash','zsh','html','css','scss','less','json','yaml','yml','xml','sql','vue','svelte']],
    ['exe', ['exe','msi','dmg','app','apk','deb','rpm','pkg']],
    ['txt', ['txt','md','markdown','log','ini','cfg','conf','env']]
  ];
  function fileKind(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    for (var i = 0; i < KINDS.length; i++) {
      if (indexOf(KINDS[i][1], ext) !== -1) return KINDS[i][0];
    }
    return 'file';
  }

  function iconExt(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (!ext || ext.length > 5 || ext === name.toLowerCase()) return '';
    return ext;
  }

  // ---------- Toasts ----------
  function toast(msg, type, ttl) {
    type = type || 'info';
    ttl = ttl || 3500;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<span class="t-dot"></span><span>' + escapeHtml(msg) + '</span>';
    toastStack.appendChild(el);
    setTimeout(function () {
      el.className += ' leave';
      var done = false;
      function finish() { if (done) return; done = true; el.remove(); }
      el.addEventListener('animationend', finish, false);
      el.addEventListener('webkitAnimationEnd', finish, false);
      setTimeout(finish, 400); // in case animation events never fire
    }, ttl);
  }
  window.__toast = toast; // so the inline error handler in index.html can use it

  // ---------- Modal ----------
  function askDelete(id, name) {
    pendingDelete = { id: id, name: name };
    modalBody.textContent = 'Delete “' + name + '”? This cannot be undone.';
    setHidden(modal, false);
  }
  function closeModal() { setHidden(modal, true); pendingDelete = null; }
  modalCancel.addEventListener('click', closeModal, false);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); }, false);
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && !isHidden(modal)) closeModal();
  }, false);
  modalConfirm.addEventListener('click', function () {
    if (!pendingDelete) return closeModal();
    var id = pendingDelete.id;
    var name = pendingDelete.name;
    closeModal();
    request('DELETE', '/api/delete/' + encodeURIComponent(id), function (err) {
      if (err) { toast(err || 'Delete failed', 'error'); return; }
      toast('Deleted ' + name, 'success');
      var kept = [];
      for (var i = 0; i < allFiles.length; i++) if (allFiles[i].id !== id) kept.push(allFiles[i]);
      allFiles = kept;
      render();
    });
  }, false);

  // ---------- Rendering ----------
  function render() {
    var filtered = allFiles;
    if (filter) {
      filtered = [];
      for (var k = 0; k < allFiles.length; k++) {
        if (String(allFiles[k].name).toLowerCase().indexOf(filter) !== -1) filtered.push(allFiles[k]);
      }
    }

    var total = 0;
    for (var t = 0; t < allFiles.length; t++) total += Number(allFiles[t].size) || 0;
    statCount.textContent = allFiles.length;
    statSize.textContent = formatBytes(total);

    if (allFiles.length === 0) {
      setHidden(emptyEl, false);
      filesEl.innerHTML = '';
      return;
    }
    setHidden(emptyEl, true);

    if (filtered.length === 0) {
      filesEl.innerHTML = '<div class="empty glass" style="grid-column:1/-1">' +
        '<h3>No matches</h3><p>Nothing found for “' + escapeHtml(filter) + '”.</p></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var f = filtered[i];
      var kind = fileKind(f.name);
      var ext = iconExt(f.name);
      var label = ext || 'FILE';
      var icon = kind === 'file' ? ICON_SVGS.file : (label.length <= 4 ? escapeHtml(label) : (ICON_SVGS[kind] || ICON_SVGS.file));
      var delay = Math.min(i * 20, 240);
      html += '<div class="file-card" style="-webkit-animation-delay:' + delay + 'ms;animation-delay:' + delay + 'ms">' +
        '<div class="file-icon ' + kind + '" title="' + escapeHtml(label) + '">' + icon + '</div>' +
        '<div class="file-meta">' +
          '<div class="file-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</div>' +
          '<div class="file-sub">' +
            '<span>' + formatBytes(f.size) + '</span>' +
            '<span class="dot"></span>' +
            '<span>' + formatDate(f.uploadedAt) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="file-actions">' +
          '<button type="button" class="icon-btn download" data-id="' + escapeHtml(f.id) + '" data-name="' + escapeHtml(f.name) + '" data-action="download" title="Download">' + DOWNLOAD_SVG + '</button>' +
          '<button type="button" class="icon-btn delete" data-id="' + escapeHtml(f.id) + '" data-name="' + escapeHtml(f.name) + '" data-action="delete" title="Delete">' + DELETE_SVG + '</button>' +
        '</div>' +
      '</div>';
    }
    filesEl.innerHTML = html;
  }

  filesEl.addEventListener('click', function (e) {
    var target = e.target;
    if (target.nodeType !== 1) target = target.parentNode; // text node inside button
    var btn = target.closest('[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var name = btn.getAttribute('data-name');
    var action = btn.getAttribute('data-action');
    if (action === 'download') {
      // Plain navigation: the server sends Content-Disposition: attachment, so
      // this works even where the <a download> attribute is unsupported.
      window.location.href = '/api/download/' + encodeURIComponent(id);
    } else if (action === 'delete') {
      askDelete(id, name);
    }
  }, false);

  // ---------- Fetch files ----------
  function loadFiles() {
    request('GET', '/api/files?_=' + new Date().getTime(), function (err, data) {
      if (err || !data) { toast('Failed to load files' + (err ? ' (' + err + ')' : ''), 'error'); return; }
      allFiles = data.files || [];
      render();
    });
  }

  refreshBtn.addEventListener('click', function () {
    loadFiles();
    toast('Refreshed', 'info', 1500);
  }, false);

  // ---------- Search ----------
  function onSearch() {
    filter = searchEl.value.trim().toLowerCase();
    setHidden(clearSearch, filter.length === 0);
    render();
  }
  searchEl.addEventListener('input', onSearch, false);
  searchEl.addEventListener('keyup', onSearch, false); // old engines without `input`
  clearSearch.addEventListener('click', function () {
    searchEl.value = '';
    filter = '';
    setHidden(clearSearch, true);
    render();
    searchEl.focus();
  }, false);

  // ---------- Upload ----------
  browseBtn.addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); }, false);
  dropzone.addEventListener('click', function () { fileInput.click(); }, false);
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length) uploadFiles(toArray(fileInput.files));
    try { fileInput.value = ''; } catch (_) {}
  }, false);

  var dragOn = ['dragenter', 'dragover'];
  for (var a = 0; a < dragOn.length; a++) {
    dropzone.addEventListener(dragOn[a], function (e) {
      e.preventDefault(); e.stopPropagation();
      if (dropzone.className.indexOf(' drag') === -1) dropzone.className += ' drag';
    }, false);
  }
  var dragOff = ['dragleave', 'drop'];
  for (var b = 0; b < dragOff.length; b++) {
    (function (ev) {
      dropzone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        if (ev === 'dragleave' && e.target !== dropzone) return;
        dropzone.className = dropzone.className.replace(/\s*\bdrag\b/, '');
      }, false);
    })(dragOff[b]);
  }
  dropzone.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) uploadFiles(toArray(files));
  }, false);

  // Prevent full-page navigation when a file is dropped outside the dropzone
  window.addEventListener('dragover', function (e) { e.preventDefault(); }, false);
  window.addEventListener('drop', function (e) { e.preventDefault(); }, false);

  function uploadFiles(files) {
    setHidden(uploadsSection, false);
    for (var i = 0; i < files.length; i++) uploadOne(files[i]);
  }

  function makeUploadRow(file) {
    var row = document.createElement('div');
    row.className = 'upload-item';
    row.innerHTML =
      '<div class="u-name" title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</div>' +
      '<div class="u-meta"><span class="u-pct">0%</span> · <span class="u-speed">—</span></div>' +
      '<div class="u-bar"><div class="u-fill"></div></div>';
    uploadList.insertBefore(row, uploadList.firstChild);
    return row;
  }

  function uploadOne(file) {
    var row = makeUploadRow(file);
    var fill = row.querySelector('.u-fill');
    var pctEl = row.querySelector('.u-pct');
    var speedEl = row.querySelector('.u-speed');

    var form = new FormData();
    form.append('files', file, file.name);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    var startTs = performance.now();
    var lastTs = startTs;
    var lastLoaded = 0;
    var smoothed = 0;

    if (xhr.upload) {
      xhr.upload.addEventListener('progress', function (e) {
        if (!e.lengthComputable) return;
        var pct = (e.loaded / e.total) * 100;
        fill.style.width = pct.toFixed(1) + '%';
        pctEl.textContent = pct.toFixed(pct >= 100 ? 0 : 1) + '%';

        var now = performance.now();
        var dt = (now - lastTs) / 1000;
        if (dt >= 0.35) {
          var instant = (e.loaded - lastLoaded) / dt;
          smoothed = smoothed ? smoothed * 0.6 + instant * 0.4 : instant;
          speedEl.textContent = formatSpeed(smoothed);
          lastTs = now;
          lastLoaded = e.loaded;
        }
      }, false);
    }

    xhr.addEventListener('load', function () {
      var totalSec = Math.max(0.001, (performance.now() - startTs) / 1000);
      var avg = file.size / totalSec;
      if (xhr.status >= 200 && xhr.status < 300) {
        row.className += ' done';
        fill.style.width = '100%';
        pctEl.textContent = '100%';
        speedEl.textContent = 'avg ' + formatSpeed(avg);
        setTimeout(function () {
          row.style.transition = 'opacity .3s, transform .3s';
          row.style.opacity = '0';
          row.style.transform = 'translateY(-4px)';
          setTimeout(function () {
            row.remove();
            if (uploadList.children.length === 0) setHidden(uploadsSection, true);
          }, 300);
        }, 1200);
        toast('Uploaded ' + file.name, 'success');
        loadFiles();
      } else {
        row.className += ' error';
        var msg = 'Upload failed';
        try { msg = (JSON.parse(xhr.responseText) || {}).error || msg; } catch (_) {}
        speedEl.textContent = msg;
        pctEl.textContent = 'error';
        toast(file.name + ': ' + msg, 'error', 5000);
      }
    }, false);

    xhr.addEventListener('error', function () {
      row.className += ' error';
      speedEl.textContent = 'network error';
      pctEl.textContent = 'error';
      toast(file.name + ': network error', 'error', 5000);
    }, false);

    xhr.addEventListener('abort', function () {
      row.className += ' error';
      speedEl.textContent = 'aborted';
      pctEl.textContent = 'aborted';
    }, false);

    xhr.send(form);
  }

  loadFiles();
})();
