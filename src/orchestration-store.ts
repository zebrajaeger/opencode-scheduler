import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CoordinationError, type Json } from "./orchestration-domain.js";
import type { OrchestrationOptions } from "./orchestration-options.js";

const schemaVersion = 2;
const tables = ["tasks", "results", "jobs", "runs", "deliveries", "mailbox", "checkpoints", "target_gates"] as const;
export type RecordTable = typeof tables[number];

export class CoordinationStore {
  private closed = false;
  private transactionOpen = false;

  constructor(private readonly db: DatabaseSync, readonly instanceID: string) {}

  static async open(options: OrchestrationOptions): Promise<CoordinationStore> {
    try { return await CoordinationStore.initialize(options); }
    catch (error) {
      if (error instanceof CoordinationError) throw error;
      throw new CoordinationError("storage-unavailable", "Cannot initialize orchestration storage; preserve the data and check permissions, integrity, and local SQLite support");
    }
  }

  private static async initialize(options: OrchestrationOptions): Promise<CoordinationStore> {
    let Database: typeof DatabaseSync;
    try { Database = (await import("node:sqlite")).DatabaseSync; }
    catch { throw new CoordinationError("unsupported-runtime", "Built-in SQLite is unavailable"); }
    await mkdir(options.dataDirectory, { recursive: true });
    const directory = await realpath(options.dataDirectory);
    if (/^(\\\\|\/\/)/.test(directory)) throw new CoordinationError("invalid-input", "Storage must use a local filesystem");
    const file = path.join(directory, "orchestration.sqlite");
    try {
      const actual = await realpath(file);
      if (path.dirname(actual).toLowerCase() !== directory.toLowerCase()) throw new CoordinationError("invalid-input", "Storage file escapes its data directory");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    const db = new Database(file);
    const store = new CoordinationStore(db, options.instanceID);
    try {
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > schemaVersion) throw new CoordinationError("storage-unavailable", "Storage schema is newer than this plugin");
      if (version < 0 || !Number.isInteger(version)) throw new CoordinationError("storage-unavailable", "Invalid storage schema");
      db.exec("PRAGMA journal_mode = WAL;");
      store.transaction(() => {
        if (version === 0) {
          const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
          if (existing.length) throw new CoordinationError("storage-unavailable", "Unversioned nonempty storage is not a recognized scheduler database");
          db.exec(`
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE events (position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
              project_id TEXT NOT NULL, source TEXT NOT NULL, source_sequence INTEGER, body TEXT NOT NULL,
              UNIQUE(source, source_sequence));
            CREATE TABLE leases (key TEXT PRIMARY KEY, owner TEXT NOT NULL, fence INTEGER NOT NULL, expires_at INTEGER NOT NULL);
          `);
          for (const table of tables) db.exec(`CREATE TABLE ${table} (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner_id TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
            CREATE INDEX ${table}_scope ON ${table}(project_id, owner_id, id);`);
        }
        if (version < 2) db.exec(`
          CREATE TABLE retention_items (key TEXT PRIMARY KEY, collection TEXT NOT NULL, record_id TEXT NOT NULL,
            project_id TEXT NOT NULL, created_at INTEGER NOT NULL, unread INTEGER NOT NULL DEFAULT 0);
          CREATE INDEX retention_scope ON retention_items(project_id, created_at, key);
          CREATE TABLE retention_pins (holder TEXT NOT NULL, item_key TEXT NOT NULL, PRIMARY KEY(holder, item_key),
            FOREIGN KEY(item_key) REFERENCES retention_items(key) ON DELETE CASCADE);
          INSERT INTO retention_items(key, collection, record_id, project_id, created_at)
            SELECT 'events:' || id, 'events', id, project_id, 0 FROM events;
        `);
        if (version < 2) {
          for (const table of tables) db.exec(`INSERT INTO retention_items(key, collection, record_id, project_id, created_at)
            SELECT '${table}:' || id, '${table}', id, project_id, 0 FROM ${table}`);
          db.exec(`PRAGMA user_version = ${schemaVersion}`);
        }
        const binding = db.prepare("SELECT value FROM metadata WHERE key = 'policy'").get();
        const policy = JSON.stringify({ ...options, dataDirectory: directory });
        if (binding && binding.value !== policy) throw new CoordinationError("conflict", "Stored instance policy does not match configuration");
        if (!binding) db.prepare("INSERT INTO metadata(key, value) VALUES ('policy', ?)").run(policy);
      });
      return store;
    } catch (error) { db.close(); throw error; }
  }

  private active(): void {
    if (this.closed) throw new CoordinationError("storage-unavailable", "Storage is closed");
  }

  private table(table: RecordTable): RecordTable {
    if (!tables.includes(table)) throw new CoordinationError("invalid-input", "Unknown record collection");
    return table;
  }

  transaction<T>(work: () => T): T {
    this.active();
    if (this.transactionOpen) throw new CoordinationError("conflict", "Nested transactions are not supported");
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionOpen = true;
    try {
      const result = work();
      if (result && typeof result === "object" && "then" in result) throw new CoordinationError("invalid-input", "Transactions must not await host operations");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally { this.transactionOpen = false; }
  }

  insert(table: RecordTable, id: string, projectID: string, ownerID: string, body: Json): void {
    this.active();
    const work = () => {
      this.db.prepare(`INSERT INTO ${this.table(table)}(id, project_id, owner_id, body) VALUES (?, ?, ?, ?)`)
        .run(id, projectID, ownerID, JSON.stringify(body));
      this.db.prepare("INSERT INTO retention_items(key, collection, record_id, project_id, created_at, unread) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`${table}:${id}`, table, id, projectID, Date.now(), table === "mailbox" ? 1 : 0);
    };
    if (this.transactionOpen) work(); else this.transaction(work);
  }

  get(table: RecordTable, id: string, projectID: string): { revision: number; ownerID: string; body: Json } | undefined {
    this.active();
    const row = this.db.prepare(`SELECT revision, owner_id, body FROM ${this.table(table)} WHERE id = ? AND project_id = ?`).get(id, projectID);
    if (!row) return undefined;
    return { revision: Number(row.revision), ownerID: String(row.owner_id), body: JSON.parse(String(row.body)) as Json };
  }

  update(table: RecordTable, id: string, projectID: string, ownerID: string, expectedRevision: number, body: Json): number {
    this.active();
    const result = this.db.prepare(`UPDATE ${this.table(table)} SET revision = revision + 1, body = ?
      WHERE id = ? AND project_id = ? AND owner_id = ? AND revision = ?`)
      .run(JSON.stringify(body), id, projectID, ownerID, expectedRevision);
    if (Number(result.changes) !== 1) throw new CoordinationError("conflict", "Record changed or is not owned by this session");
    return expectedRevision + 1;
  }

  list(table: RecordTable, projectID: string, ownerID: string, limit = 100, after = ""): { id: string; body: Json }[] {
    this.active();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError("invalid-input", "Read limit must be between 1 and 100");
    return this.db.prepare(`SELECT id, body FROM ${this.table(table)} WHERE project_id = ? AND owner_id = ? AND id > ? ORDER BY id LIMIT ?`)
      .all(projectID, ownerID, after, limit).map(row => ({ id: String(row.id), body: JSON.parse(String(row.body)) as Json }));
  }

  projectRecords(table: RecordTable, projectID: string, after = "", limit = 100): { id: string; revision: number; ownerID: string; body: Json }[] {
    this.active();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError("invalid-input", "Invalid project page size");
    return this.db.prepare(`SELECT id, revision, owner_id, body FROM ${this.table(table)} WHERE project_id = ? AND id > ? ORDER BY id LIMIT ?`)
      .all(projectID, after, limit).map(row => ({ id: String(row.id), revision: Number(row.revision), ownerID: String(row.owner_id), body: JSON.parse(String(row.body)) as Json }));
  }

  eventWatermark(projectID: string): number {
    this.active();
    return Number(this.db.prepare("SELECT coalesce(max(position), 0) AS watermark FROM events WHERE project_id = ?").get(projectID)?.watermark);
  }

  assertCompleteHistory(projectID: string): void {
    this.active();
    if (this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(`pruned:${projectID}`)) throw new CoordinationError("history-unavailable", "Retained project history has gaps; use a known result or future-only condition");
  }

  appendEvent(id: string, projectID: string, source: string, sequence: number | undefined, body: Json): { position: number; inserted: boolean } {
    this.active();
    if (!this.transactionOpen) return this.transaction(() => this.appendEvent(id, projectID, source, sequence, body));
    const result = this.db.prepare("INSERT INTO events(id, project_id, source, source_sequence, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(id, projectID, source, sequence ?? null, JSON.stringify(body));
    const row = this.db.prepare("SELECT position, id, body FROM events WHERE id = ? OR (source = ? AND source_sequence = ?)").get(id, source, sequence ?? null);
    if (!row || row.id !== id || row.body !== JSON.stringify(body)) throw new CoordinationError("conflict", "Event identity conflicts with persisted evidence");
    if (Number(result.changes) === 1) this.db.prepare("INSERT INTO retention_items(key, collection, record_id, project_id, created_at) VALUES (?, 'events', ?, ?, ?)")
      .run(`events:${id}`, id, projectID, Date.now());
    return { position: Number(row.position), inserted: Number(result.changes) === 1 };
  }

  events(projectID: string, after = 0, limit = 100): { position: number; id: string; body: Json }[] {
    this.active();
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError("invalid-input", "Invalid event page");
    return this.db.prepare("SELECT position, id, body FROM events WHERE project_id = ? AND position > ? ORDER BY position LIMIT ?")
      .all(projectID, after, limit).map(row => ({ position: Number(row.position), id: String(row.id), body: JSON.parse(String(row.body)) as Json }));
  }

  claim(key: string, owner: string, now: number, lifetime: number): number | undefined {
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lifetime) || lifetime < 1 || !Number.isSafeInteger(now + lifetime)) throw new CoordinationError("invalid-input", "Invalid lease timing");
    return this.transaction(() => {
      const row = this.db.prepare("SELECT owner, fence, expires_at FROM leases WHERE key = ?").get(key);
      if (row && Number(row.expires_at) > now) return undefined;
      const fence = row ? Number(row.fence) + 1 : 1;
      this.db.prepare("INSERT INTO leases(key, owner, fence, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, fence=excluded.fence, expires_at=excluded.expires_at")
        .run(key, owner, fence, now + lifetime);
      return fence;
    });
  }

  withClaim<T>(key: string, owner: string, fence: number, now: number, work: () => T): T {
    return this.transaction(() => {
      if (!this.ownsClaim(key, owner, fence, now)) throw new CoordinationError("conflict", "Worker claim is stale");
      return work();
    });
  }

  ownsClaim(key: string, owner: string, fence: number, now: number): boolean {
    this.active();
    const row = this.db.prepare("SELECT owner, fence, expires_at FROM leases WHERE key = ?").get(key);
    return !!row && row.owner === owner && Number(row.fence) === fence && Number(row.expires_at) > now;
  }

  release(key: string, owner: string, fence: number): boolean {
    this.active();
    // Keep the row so the fencing counter never returns to one after release.
    return Number(this.db.prepare("UPDATE leases SET expires_at = 0 WHERE key = ? AND owner = ? AND fence = ?")
      .run(key, owner, fence).changes) === 1;
  }

  pin(holder: string, collection: RecordTable | "events", id: string, projectID: string): void {
    this.active();
    const key = `${collection}:${id}`;
    const item = this.db.prepare("SELECT project_id FROM retention_items WHERE key = ?").get(key);
    if (!item || item.project_id !== projectID) throw new CoordinationError("history-unavailable", "Required retained evidence is unavailable");
    this.db.prepare("INSERT OR IGNORE INTO retention_pins(holder, item_key) VALUES (?, ?)").run(holder, key);
  }

  unpin(holder: string): void {
    this.active();
    this.db.prepare("DELETE FROM retention_pins WHERE holder = ?").run(holder);
  }

  markRead(id: string, projectID: string, ownerID: string): void {
    this.active();
    this.db.prepare(`UPDATE retention_items SET unread = 0 WHERE key = ? AND project_id = ?
      AND EXISTS(SELECT 1 FROM mailbox WHERE id = ? AND owner_id = ? AND project_id = ?)`)
      .run(`mailbox:${id}`, projectID, id, ownerID, projectID);
  }

  enforceCapacity(projectID: string, maximum: number): void {
    this.active();
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new CoordinationError("invalid-input", "Invalid retention quota");
    const count = Number(this.db.prepare("SELECT count(*) AS total FROM retention_items WHERE project_id = ?").get(projectID)?.total);
    if (count >= maximum) throw new CoordinationError("resource-limit", "Project retained-data capacity exhausted; required evidence was preserved");
  }

  prune(projectID: string, before: number, maximumUnreferenced: number): number {
    return this.transaction(() => {
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(maximumUnreferenced) || maximumUnreferenced < 1) throw new CoordinationError("invalid-input", "Invalid retention policy");
      // Only terminal/read historical records are collectible. Jobs, tasks,
      // checkpoints, and delivery gates require explicit lifecycle cleanup.
      const candidates = this.db.prepare(`SELECT key, collection, record_id, created_at FROM retention_items AS r
        WHERE project_id = ? AND unread = 0 AND collection IN ('events', 'results', 'mailbox')
        AND NOT EXISTS(SELECT 1 FROM retention_pins AS p WHERE p.item_key = r.key)
        ORDER BY created_at DESC, key DESC`).all(projectID);
      let removed = 0;
      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i]!;
        if (i < maximumUnreferenced && Number(row.created_at) >= before) continue;
        const collection = row.collection === "events" ? "events" : this.table(String(row.collection) as RecordTable);
        this.db.prepare(`DELETE FROM ${collection} WHERE id = ? AND project_id = ?`).run(String(row.record_id), projectID);
        if (collection === "events") this.db.prepare("INSERT INTO metadata(key, value) VALUES (?, 'true') ON CONFLICT(key) DO NOTHING").run(`pruned:${projectID}`);
        this.db.prepare("DELETE FROM retention_items WHERE key = ?").run(String(row.key));
        removed++;
      }
      return removed;
    });
  }

  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
