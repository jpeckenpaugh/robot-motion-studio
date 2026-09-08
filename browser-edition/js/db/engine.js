/* Tiny sql.js query helpers bound to the worker's live database handle.
 *
 * The worker owns the single `SQL.Database` instance; this module exports
 * functions that operate on it directly (there is exactly one database, so a
 * module-level handle is unambiguous within the worker). This mirrors the
 * reference browser-POC pattern and keeps domain code readable.
 */

let database = null;

export function setDatabase(db) {
  database = db;
}

export function getDatabase() {
  return database;
}

/* Run a SELECT and return an array of plain objects (column name -> value). */
export function rows(sql, params = []) {
  const stmt = database.prepare(sql);
  const out = [];
  try {
    stmt.bind(params);
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

/* Run a SELECT and return the first row (or null). */
export function one(sql, params = []) {
  return rows(sql, params)[0] || null;
}

/* Execute a statement that returns no rows. */
export function run(sql, params = []) {
  database.run(sql, params);
}

/* Id of the last inserted row. */
export function lastId() {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
}