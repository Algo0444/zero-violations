require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db, initDb } = require("./db");

const app = express();

// ✅ CORS + JSON
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ✅ SERVE FRONTEND (public folder)
app.use(express.static(path.join(__dirname, "../public")));

// ✅ INIT DB
initDb();

// ====== CONFIG ======
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const PORT = process.env.PORT || 5050;

function nowIso() {
  return new Date().toISOString();
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

// ====== SEED 2 ACCOUNTS (admin + viewer) ======
function seedTwoAccounts() {
  db.get(`SELECT COUNT(*) as c FROM users`, (err, row) => {
    if (err) {
      console.error("Seed check error:", err);
      return;
    }
    if ((row?.c || 0) > 0) return; // already seeded

    const adminHash = bcrypt.hashSync("Admin@12345", 10);
    const viewerHash = bcrypt.hashSync("Viewer@12345", 10);

    db.serialize(() => {
      db.run(
        `INSERT INTO users(username,password_hash,role) VALUES(?,?,?)`,
        ["admin", adminHash, "admin"]
      );
      db.run(
        `INSERT INTO users(username,password_hash,role) VALUES(?,?,?)`,
        ["viewer", viewerHash, "viewer"]
      );

      db.get(`SELECT id FROM users WHERE username='admin'`, (e, r) => {
        if (r?.id) db.run(`INSERT OR IGNORE INTO prefs(user_id) VALUES(?)`, [r.id]);
      });

      db.get(`SELECT id FROM users WHERE username='viewer'`, (e, r) => {
        if (r?.id) db.run(`INSERT OR IGNORE INTO prefs(user_id) VALUES(?)`, [r.id]);
      });

      console.log("✅ Seeded 2 accounts:");
      console.log("Admin:  admin / Admin@12345");
      console.log("Viewer: viewer / Viewer@12345");
    });
  });
}
seedTwoAccounts();

// ====== AUTH ======
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Missing credentials" });

  db.get(`SELECT * FROM users WHERE username=?`, [username], (err, user) => {
    if (err) return res.status(500).json({ error: "DB error" });
    if (!user) return res.status(401).json({ error: "Invalid username or password" });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid username or password" });

    db.run(`INSERT OR IGNORE INTO prefs(user_id) VALUES(?)`, [user.id]);

    res.json({
      token: signToken(user),
      user: { username: user.username, role: user.role }
    });
  });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role } });
});

// ====== PREFS ======
app.get("/api/prefs", auth, (req, res) => {
  db.get(
    `SELECT theme_mode, accent, font_scale, snow_enabled
     FROM prefs WHERE user_id=?`,
    [req.user.uid],
    (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(
        row || { theme_mode: "dark", accent: "#0B7A4B", font_scale: 1, snow_enabled: 1 }
      );
    }
  );
});

app.post("/api/prefs", auth, (req, res) => {
  const { theme_mode, accent, font_scale, snow_enabled } = req.body || {};
  db.run(
    `UPDATE prefs
     SET theme_mode=?, accent=?, font_scale=?, snow_enabled=?
     WHERE user_id=?`,
    [
      theme_mode ?? "dark",
      accent ?? "#0B7A4B",
      Number(font_scale ?? 1),
      snow_enabled ? 1 : 0,
      req.user.uid
    ],
    (err) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ ok: true });
    }
  );
});

// ====== RESULTS ======
app.get("/api/results/month", auth, (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  const scope = String(req.query.scope || "published");

  if (!year || !month) return res.status(400).json({ error: "Missing year/month" });

  if (req.user.role !== "admin" && scope !== "published") {
    return res.status(403).json({ error: "Viewer can only read published" });
  }

  db.get(
    `SELECT data_json, updated_at
     FROM month_results
     WHERE scope=? AND year=? AND month=?`,
    [scope, year, month],
    (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.json({ data: null, updated_at: null });
      res.json({ data: JSON.parse(row.data_json), updated_at: row.updated_at });
    }
  );
});

// admin saves draft
app.post("/api/results/month/draft", auth, requireAdmin, (req, res) => {
  const { year, month, data } = req.body || {};
  if (!year || !month || !data) return res.status(400).json({ error: "Missing payload" });

  const updated_at = nowIso();
  const json = JSON.stringify(data);

  db.run(
    `INSERT INTO month_results(scope,year,month,data_json,updated_at)
     VALUES('draft',?,?,?,?)
     ON CONFLICT(scope,year,month)
     DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`,
    [Number(year), Number(month), json, updated_at],
    (err) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ ok: true, updated_at });
    }
  );
});

// admin publishes draft -> published
app.post("/api/results/month/publish", auth, requireAdmin, (req, res) => {
  const { year, month } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: "Missing year/month" });

  db.get(
    `SELECT data_json FROM month_results
     WHERE scope='draft' AND year=? AND month=?`,
    [Number(year), Number(month)],
    (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!row) return res.status(400).json({ error: "No draft data to publish" });

      const updated_at = nowIso();
      db.run(
        `INSERT INTO month_results(scope,year,month,data_json,updated_at)
         VALUES('published',?,?,?,?)
         ON CONFLICT(scope,year,month)
         DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`,
        [Number(year), Number(month), row.data_json, updated_at],
        (err2) => {
          if (err2) return res.status(500).json({ error: "DB error" });
          res.json({ ok: true, published_at: updated_at });
        }
      );
    }
  );
});

// ✅ FALLBACK TO FRONTEND (must be AFTER API routes)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// START
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
