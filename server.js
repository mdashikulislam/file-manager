const express = require('express');
const compression = require('compression');
const multer = require('multer');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4600;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'file_manager',
};

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let pool;

async function initDb() {
  const bootstrap = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    multipleStatements: false,
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id            CHAR(36)         NOT NULL PRIMARY KEY,
      original_name VARCHAR(512)     NOT NULL,
      stored_name   VARCHAR(128)     NOT NULL UNIQUE,
      size          BIGINT UNSIGNED  NOT NULL,
      mime_type     VARCHAR(255)     DEFAULT NULL,
      uploaded_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_uploaded_at (uploaded_at),
      INDEX idx_original_name (original_name(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

app.use(compression());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Only allow safe extension characters, cap length.
function safeExt(name) {
  const ext = path.extname(name || '').toLowerCase();
  if (!ext) return '';
  const cleaned = ext.replace(/[^a-z0-9.]/g, '');
  return cleaned.length > 20 ? '' : cleaned;
}

// Decode multer's latin1-decoded originalname back to utf8; strip control chars.
function decodeOriginal(name) {
  let s;
  try { s = Buffer.from(name || '', 'latin1').toString('utf8'); }
  catch (_) { s = String(name || ''); }
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '').replace(/[\/\\]/g, '_').trim();
  return s.slice(0, 500) || `file_${Date.now()}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    file._id = id;
    cb(null, id + safeExt(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// UUID guard — request params only ever hit disk after this passes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/api/files', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, original_name AS name, size, mime_type AS mimeType, uploaded_at AS uploadedAt
       FROM files ORDER BY uploaded_at DESC`
    );
    res.json({ files: rows });
  } catch (err) {
    console.error('list error:', err.message);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.post('/api/upload', (req, res) => {
  upload.array('files')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds size limit' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    const inserted = [];
    for (const f of req.files || []) {
      const original = decodeOriginal(f.originalname);
      try {
        await pool.query(
          `INSERT INTO files (id, original_name, stored_name, size, mime_type)
           VALUES (?, ?, ?, ?, ?)`,
          [f._id, original, f.filename, f.size, f.mimetype || null]
        );
        inserted.push({ id: f._id, name: original, size: f.size });
      } catch (dbErr) {
        console.error('insert error:', dbErr.message);
        fs.unlink(path.join(UPLOAD_DIR, f.filename), () => {}); // roll back the orphan
      }
    }
    res.json({ ok: true, files: inserted });
  });
});

app.get('/api/download/:id', async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [rows] = await pool.query(
      `SELECT original_name, stored_name, size, mime_type FROM files WHERE id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    const full = path.join(UPLOAD_DIR, row.stored_name);
    if (!full.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).json({ error: 'Invalid path' });

    fs.stat(full, (statErr, stat) => {
      if (statErr || !stat.isFile()) return res.status(404).json({ error: 'File missing on disk' });

      const asciiFallback = row.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`
      );
      const stream = fs.createReadStream(full);
      stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
      stream.pipe(res);
    });
  } catch (err) {
    console.error('download error:', err.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

app.delete('/api/delete/:id', async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [rows] = await pool.query(`SELECT stored_name FROM files WHERE id = ? LIMIT 1`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const stored = rows[0].stored_name;
    await pool.query(`DELETE FROM files WHERE id = ?`, [id]);
    fs.unlink(path.join(UPLOAD_DIR, stored), (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') console.error('unlink error:', unlinkErr.message);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete error:', err.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`File manager running at http://localhost:${PORT}`);
      console.log(`Upload directory: ${UPLOAD_DIR}`);
      console.log(`MySQL: ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    });
  })
  .catch((err) => {
    console.error('Failed to init MySQL:', err.message);
    console.error(`Check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD env vars. Current: ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}`);
    process.exit(1);
  });
