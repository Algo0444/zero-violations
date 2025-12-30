// MySQL example
const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'mysql.railway.internal', // Railway handles this automatically
  user: 'root',      // provided by Railway
  password: 'AaEBPybYsGrfvusxcVoPDTHlBeHhfscJ',  // provided by Railway
  database: 'railway', // provided by Railway
});

connection.connect();


function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','viewer'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS prefs (
        user_id INTEGER PRIMARY KEY,
        theme_mode TEXT DEFAULT 'dark',
        accent TEXT DEFAULT '#0B7A4B',
        font_scale REAL DEFAULT 1.0,
        snow_enabled INTEGER DEFAULT 1,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // month results (draft & published)
    db.run(`
      CREATE TABLE IF NOT EXISTS month_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK(scope IN ('draft','published')),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope, year, month)
      )
    `);

    // optional: publish history
    db.run(`
      CREATE TABLE IF NOT EXISTS publish_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        published_at TEXT NOT NULL
      )
    `);
  });
}

module.exports = { db, initDb };
