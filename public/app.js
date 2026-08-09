(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const browseBtn = $('browseBtn');
  const uploadsSection = $('uploads');
  const uploadList = $('uploadList');
  const filesEl = $('files');
  const emptyEl = $('empty');
  const searchEl = $('search');
  const clearSearch = $('clearSearch');
  const refreshBtn = $('refreshBtn');
  const statCount = $('statCount');
  const statSize = $('statSize');
  const toastStack = $('toasts');
  const modal = $('modal');
  const modalBody = $('modalBody');
  const modalCancel = $('modalCancel');
  const modalConfirm = $('modalConfirm');

  let allFiles = [];
  let filter = '';
  let pendingDelete = null; // { id, name }

  // ---------- Helpers ----------
  function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const n = bytes / Math.pow(1024, i);
    return `${n < 10 && i > 0 ? n.toFixed(2) : n < 100 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }
  function formatSpeed(bps) { return `${formatBytes(bps)}/s`; }
  function formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ICON_SVGS = {
    img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    vid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m21 8-4 3 4 3z"/></svg>',
    aud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    zip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M10 14h4M10 17h4"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>',
    slide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    exe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 4 3-4 3M13 16h4"/></svg>',
    txt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6M8 9h2"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  };

  function fileKind(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['jpg','jpeg','png','gif','webp','bmp','svg','avif','tiff','ico','heic'].includes(ext)) return 'img';
    if (['mp4','mov','avi','mkv','webm','flv','wmv','m4v','mpg','mpeg'].includes(ext)) return 'vid';
    if (['mp3','wav','flac','aac','ogg','m4a','opus','wma'].includes(ext)) return 'aud';
    if (['doc','docx','odt','rtf','pages'].includes(ext)) return 'doc';
    if (['xls','xlsx','csv','ods','numbers'].includes(ext)) return 'sheet';
    if (['ppt','pptx','key','odp'].includes(ext)) return 'slide';
    if (ext === 'pdf') return 'pdf';
    if (['zip','rar','7z','tar','gz','bz2','xz','tgz'].includes(ext)) return 'zip';
    if (['js','ts','tsx','jsx','py','rb','go','rs','java','c','cpp','h','hpp','cs','php','swift','kt','sh','bash','zsh','html','css','scss','less','json','yaml','yml','xml','sql','vue','svelte'].includes(ext)) return 'code';
    if (['exe','msi','dmg','app','apk','deb','rpm','pkg'].includes(ext)) return 'exe';
    if (['txt','md','markdown','log','ini','cfg','conf','env'].includes(ext)) return 'txt';
    return 'file';
  }

  function iconExt(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!ext || ext.length > 5 || ext === name.toLowerCase()) return '';
    return ext;
  }

  // ---------- Toasts ----------
  function toast(msg, type = 'info', ttl = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="t-dot"></span><span>${escapeHtml(msg)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leave');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, ttl);
  }

  // ---------- Modal ----------
  function askDelete(id, name) {
    pendingDelete = { id, name };
    modalBody.textContent = `Delete “${name}”? This cannot be undone.`;
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; pendingDelete = null; }
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  modalConfirm.addEventListener('click', async () => {
    if (!pendingDelete) return closeModal();
    const { id, name } = pendingDelete;
    closeModal();
    try {
      const res = await fetch(`/api/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed');
      toast(`Deleted ${name}`, 'success');
      allFiles = allFiles.filter((f) => f.id !== id);
      render();
    } catch (err) {
      toast(err.message || 'Delete failed', 'error');
    }
  });

  // ---------- Rendering ----------
  function render() {
    const filtered = filter
      ? allFiles.filter((f) => f.name.toLowerCase().includes(filter))
      : allFiles;

    statCount.textContent = allFiles.length;
    statSize.textContent = formatBytes(allFiles.reduce((s, f) => s + (f.size || 0), 0));

    if (allFiles.length === 0) {
      emptyEl.hidden = false;
      filesEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;

    if (filtered.length === 0) {
      filesEl.innerHTML = `<div class="empty glass" style="grid-column:1/-1">
        <h3>No matches</h3><p>Nothing found for “${escapeHtml(filter)}”.</p>
      </div>`;
      return;
    }

    filesEl.innerHTML = filtered
      .map((f, i) => {
        const kind = fileKind(f.name);
        const ext = iconExt(f.name);
        const label = ext || 'FILE';
        return `<div class="file-card" style="animation-delay:${Math.min(i * 20, 240)}ms">
          <div class="file-icon ${kind}" title="${escapeHtml(label)}">
            ${kind === 'file' ? ICON_SVGS.file : (label.length <= 4 ? escapeHtml(label) : ICON_SVGS[kind] || ICON_SVGS.file)}
          </div>
          <div class="file-meta">
            <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="file-sub">
              <span>${formatBytes(f.size)}</span>
              <span class="dot"></span>
              <span>${formatDate(f.uploadedAt)}</span>
            </div>
          </div>
          <div class="file-actions">
            <button class="icon-btn download" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(f.name)}" data-action="download" title="Download">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m6 11 6 6 6-6"/><path d="M5 21h14"/></svg>
            </button>
            <button class="icon-btn delete" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(f.name)}" data-action="delete" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </div>`;
      })
      .join('');
  }

  filesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    if (btn.dataset.action === 'download') {
      const a = document.createElement('a');
      a.href = `/api/download/${encodeURIComponent(id)}`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (btn.dataset.action === 'delete') {
      askDelete(id, name);
    }
  });

  // ---------- Fetch files ----------
  async function loadFiles() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      allFiles = data.files || [];
      render();
    } catch (err) {
      toast('Failed to load files', 'error');
    }
  }

  refreshBtn.addEventListener('click', () => {
    loadFiles();
    toast('Refreshed', 'info', 1500);
  });

  // ---------- Search ----------
  searchEl.addEventListener('input', () => {
    filter = searchEl.value.trim().toLowerCase();
    clearSearch.hidden = filter.length === 0;
    render();
  });
  clearSearch.addEventListener('click', () => {
    searchEl.value = '';
    filter = '';
    clearSearch.hidden = true;
    render();
    searchEl.focus();
  });

  // ---------- Upload ----------
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      if (ev === 'dragleave' && e.target !== dropzone) return;
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) uploadFiles(Array.from(files));
  });

  // Prevent full-page navigation when a file is dropped outside the dropzone
  ['dragover', 'drop'].forEach((ev) => {
    window.addEventListener(ev, (e) => { e.preventDefault(); }, false);
  });

  function uploadFiles(files) {
    uploadsSection.hidden = false;
    files.forEach((file) => uploadOne(file));
  }

  function makeUploadRow(file) {
    const row = document.createElement('div');
    row.className = 'upload-item';
    row.innerHTML = `
      <div class="u-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
      <div class="u-meta"><span class="u-pct">0%</span> · <span class="u-speed">—</span></div>
      <div class="u-bar"><div class="u-fill"></div></div>
    `;
    uploadList.prepend(row);
    return row;
  }

  function uploadOne(file) {
    const row = makeUploadRow(file);
    const fill = row.querySelector('.u-fill');
    const pctEl = row.querySelector('.u-pct');
    const speedEl = row.querySelector('.u-speed');

    const form = new FormData();
    form.append('files', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    let startTs = performance.now();
    let lastTs = startTs;
    let lastLoaded = 0;
    let smoothed = 0;

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = (e.loaded / e.total) * 100;
      fill.style.width = pct.toFixed(1) + '%';
      pctEl.textContent = pct.toFixed(pct >= 100 ? 0 : 1) + '%';

      const now = performance.now();
      const dt = (now - lastTs) / 1000;
      if (dt >= 0.35) {
        const instant = (e.loaded - lastLoaded) / dt;
        smoothed = smoothed ? smoothed * 0.6 + instant * 0.4 : instant;
        speedEl.textContent = formatSpeed(smoothed);
        lastTs = now;
        lastLoaded = e.loaded;
      }
    });

    xhr.addEventListener('load', () => {
      const totalSec = Math.max(0.001, (performance.now() - startTs) / 1000);
      const avg = file.size / totalSec;
      if (xhr.status >= 200 && xhr.status < 300) {
        row.classList.add('done');
        fill.style.width = '100%';
        pctEl.textContent = '100%';
        speedEl.textContent = `avg ${formatSpeed(avg)}`;
        setTimeout(() => {
          row.style.transition = 'opacity .3s, transform .3s';
          row.style.opacity = '0';
          row.style.transform = 'translateY(-4px)';
          setTimeout(() => {
            row.remove();
            if (uploadList.childElementCount === 0) uploadsSection.hidden = true;
          }, 300);
        }, 1200);
        toast(`Uploaded ${file.name}`, 'success');
        loadFiles();
      } else {
        row.classList.add('error');
        let msg = 'Upload failed';
        try { msg = (JSON.parse(xhr.responseText) || {}).error || msg; } catch (_) {}
        speedEl.textContent = msg;
        pctEl.textContent = 'error';
        toast(`${file.name}: ${msg}`, 'error', 5000);
      }
    });

    xhr.addEventListener('error', () => {
      row.classList.add('error');
      speedEl.textContent = 'network error';
      pctEl.textContent = 'error';
      toast(`${file.name}: network error`, 'error', 5000);
    });

    xhr.addEventListener('abort', () => {
      row.classList.add('error');
      speedEl.textContent = 'aborted';
      pctEl.textContent = 'aborted';
    });

    xhr.send(form);
  }

  loadFiles();
})();
