'use strict';

// Wichtel-App – kleiner Node.js-Server ohne externe Abhängigkeiten.
// Start: `node server.js`  (Port über PORT, Daten über DATA_FILE konfigurierbar)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'wichteln.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 60;

// ---------- Persistenz ----------

function emptyData() {
  return { admin: null, participants: [], sessions: {} };
}

function loadData() {
  try {
    return { ...emptyData(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return emptyData();
  }
}

let data = loadData();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- Zugangscodes ----------

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateCode() {
  const used = new Set(data.participants.map((p) => p.code));
  let code;
  do {
    code = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (used.has(code));
  return code;
}

function formatCode(code) {
  return code.slice(0, 4) + '-' + code.slice(4);
}

// Ältere Datenbestände (mit Passwörtern) auf Zugangscodes umstellen
function migrate() {
  let changed = false;
  for (const p of data.participants) {
    if (!p.code) {
      p.code = generateCode();
      changed = true;
    }
    if ('password' in p) {
      delete p.password;
      changed = true;
    }
  }
  if (changed) save();
}

// ---------- Passwörter & Sitzungen ----------

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password, stored) {
  if (!stored) return false;
  const { hash } = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

function createSession(type, id) {
  const token = crypto.randomBytes(32).toString('hex');
  data.sessions[token] = { type, id, expires: Date.now() + SESSION_DAYS * 864e5 };
  return token;
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, s] of Object.entries(data.sessions)) {
    if (s.expires < now) delete data.sessions[token];
  }
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)wsid=([a-f0-9]{64})/);
  if (!match) return null;
  const s = data.sessions[match[1]];
  if (!s || s.expires < Date.now()) return null;
  if (s.type === 'player' && !data.participants.some((p) => p.id === s.id)) return null;
  return { token: match[1], ...s };
}

function sessionCookie(token, maxAgeSeconds) {
  return `wsid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// Einfache Bremse gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 10 Minuten.
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const entry = failedLogins.get(ip);
  return entry && entry.count >= 10 && Date.now() - entry.since < 10 * 60e3;
}
function recordFailure(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > 10 * 60e3) failedLogins.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

// ---------- Spiel-Logik ----------

function drawStarted() {
  return data.participants.some((p) => p.drawnId);
}

/**
 * Zieht für `drawer` einen zufälligen Namen aus dem Topf.
 * Regeln: niemand zieht sich selbst, jeder Name wird nur einmal gezogen.
 * Zusätzlich wird verhindert, dass die letzte Person nur noch sich selbst
 * ziehen könnte: Sind nur noch zwei Namen im Topf und ist die andere noch
 * nicht ziehende Person einer davon, muss sie jetzt gezogen werden.
 * (Bei zwei oder mehr verbleibenden Namen ist sonst immer eine gültige
 * Restverteilung möglich.)
 */
function drawFor(drawer) {
  const takenIds = new Set(data.participants.map((p) => p.drawnId).filter(Boolean));
  const pool = data.participants.filter((p) => !takenIds.has(p.id));
  let candidates = pool.filter((p) => p.id !== drawer.id);

  if (pool.length === 2) {
    const otherDrawer = data.participants.find((p) => !p.drawnId && p.id !== drawer.id);
    if (otherDrawer && pool.some((p) => p.id === otherDrawer.id)) {
      candidates = [otherDrawer];
    }
  }
  if (candidates.length === 0) return null;
  return candidates[crypto.randomInt(candidates.length)];
}

// ---------- HTTP-Hilfen ----------

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e5) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  });
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 200;
}

// ---------- API ----------

async function handleApi(req, res, pathname) {
  const method = req.method;
  const session = getSession(req);
  const ip = req.socket.remoteAddress || 'unknown';
  const body = method === 'POST' || method === 'DELETE' ? await readBody(req) : {};
  const isAdmin = session && session.type === 'admin';
  const player = session && session.type === 'player'
    ? data.participants.find((p) => p.id === session.id)
    : null;

  // Öffentlicher Status für die Startseite
  if (method === 'GET' && pathname === '/api/state') {
    return send(res, 200, {
      adminConfigured: Boolean(data.admin),
      hasParticipants: data.participants.length > 0,
      role: isAdmin ? 'admin' : player ? 'player' : null,
    });
  }

  // ----- Spieler -----

  if (method === 'POST' && pathname === '/api/login') {
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte in 10 Minuten erneut versuchen.' });
    const code = normalizeCode(body.code);
    const p = code.length === 8 ? data.participants.find((x) => x.code === code) : null;
    if (!p) {
      recordFailure(ip);
      return send(res, 401, { error: 'Dieser Zugangscode ist ungültig.' });
    }
    if (!p.firstLoginAt) p.firstLoginAt = new Date().toISOString();
    pruneSessions();
    const token = createSession('player', p.id);
    save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    if (session) {
      delete data.sessions[session.token];
      save();
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (method === 'GET' && pathname === '/api/me') {
    if (!player) return send(res, 401, { error: 'Bitte anmelden.' });
    const drawn = data.participants.find((p) => p.id === player.drawnId);
    return send(res, 200, {
      name: player.name,
      drawn: drawn ? drawn.name : null,
      canDraw: data.participants.length >= 2,
    });
  }

  if (method === 'POST' && pathname === '/api/draw') {
    if (!player) return send(res, 401, { error: 'Bitte anmelden.' });
    if (player.drawnId) {
      const drawn = data.participants.find((p) => p.id === player.drawnId);
      return send(res, 200, { drawn: drawn.name, already: true });
    }
    if (data.participants.length < 2) return send(res, 400, { error: 'Es müssen mindestens 2 Personen mitmachen.' });
    const pick = drawFor(player);
    if (!pick) return send(res, 409, { error: 'Es ist kein Name mehr übrig. Bitte wende dich an die Spielleitung.' });
    player.drawnId = pick.id;
    player.drawnAt = new Date().toISOString();
    save();
    return send(res, 200, { drawn: pick.name });
  }

  // ----- Spielleitung (Admin) -----

  if (method === 'POST' && pathname === '/api/admin/setup') {
    if (data.admin) return send(res, 409, { error: 'Die Spielleitung ist bereits eingerichtet.' });
    if (!validPassword(body.password)) return send(res, 400, { error: 'Das Passwort muss mindestens 4 Zeichen haben.' });
    data.admin = hashPassword(body.password);
    const token = createSession('admin', 'admin');
    save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    if (tooManyAttempts(ip)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte in 10 Minuten erneut versuchen.' });
    if (!checkPassword(String(body.password || ''), data.admin)) {
      recordFailure(ip);
      return send(res, 401, { error: 'Falsches Passwort.' });
    }
    pruneSessions();
    const token = createSession('admin', 'admin');
    save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (pathname.startsWith('/api/admin/') && !isAdmin) {
    return send(res, 401, { error: 'Nur für die Spielleitung.' });
  }

  if (method === 'GET' && pathname === '/api/admin/overview') {
    const takenIds = new Set(data.participants.map((p) => p.drawnId).filter(Boolean));
    return send(res, 200, {
      locked: drawStarted(),
      participants: data.participants.map((p) => ({
        id: p.id,
        name: p.name,
        code: formatCode(p.code),
        registered: Boolean(p.firstLoginAt),
        hasDrawn: Boolean(p.drawnId),
        wasDrawn: takenIds.has(p.id),
      })),
    });
  }

  if (method === 'POST' && pathname === '/api/admin/participants') {
    if (drawStarted()) return send(res, 409, { error: 'Es wurde schon gezogen. Neue Personen können erst nach einem Zurücksetzen hinzugefügt werden.' });
    const names = (Array.isArray(body.names) ? body.names : [body.name])
      .map((n) => String(n || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (names.length === 0) return send(res, 400, { error: 'Bitte einen Namen eingeben.' });
    const existing = new Set(data.participants.map((p) => p.name.toLowerCase()));
    const added = [];
    const skipped = [];
    for (const name of names) {
      if (name.length > 60 || existing.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      existing.add(name.toLowerCase());
      const p = { id: crypto.randomUUID(), name, code: null, drawnId: null };
      p.code = generateCode();
      data.participants.push(p);
      added.push(p.name);
    }
    save();
    return send(res, 200, { added, skipped });
  }

  const participantRoute = pathname.match(/^\/api\/admin\/participants\/([\w-]+)(\/new-code)?$/);
  if (participantRoute) {
    const p = data.participants.find((x) => x.id === participantRoute[1]);
    if (!p) return send(res, 404, { error: 'Person nicht gefunden.' });

    if (method === 'POST' && participantRoute[2]) {
      p.code = generateCode();
      delete p.firstLoginAt;
      for (const [token, s] of Object.entries(data.sessions)) {
        if (s.type === 'player' && s.id === p.id) delete data.sessions[token];
      }
      save();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE' && !participantRoute[2]) {
      if (drawStarted()) return send(res, 409, { error: 'Es wurde schon gezogen. Personen können erst nach einem Zurücksetzen entfernt werden.' });
      data.participants = data.participants.filter((x) => x.id !== p.id);
      save();
      return send(res, 200, { ok: true });
    }
  }

  if (method === 'POST' && pathname === '/api/admin/reset-draws') {
    for (const p of data.participants) {
      p.drawnId = null;
      delete p.drawnAt;
    }
    save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Unbekannte Anfrage.' });
}

migrate();

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 400, { error: 'Ungültige Anfrage.' });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🎁 Wichtel-App läuft auf http://localhost:${PORT}`);
  });
}

module.exports = { server, drawFor, _getData: () => data, _setData: (d) => { data = d; } };
