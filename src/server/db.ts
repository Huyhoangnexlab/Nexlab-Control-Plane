import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { AppError, conflict, invalid } from "./errors";
import { MIGRATIONS } from "./schema";

// timestamptz → chuỗi ISO (an toàn để chuyển sang Client Component); int8 → number.
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(20, (v) => Number(v));

export interface Db {
  q<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

const DEFAULT_URL = "postgres://nexlab:nexlab_dev@localhost:5433/nexlab_cp";

interface Globals {
  __cpPool?: Pool;
  __cpReady?: Promise<void>;
}
const g = globalThis as unknown as Globals;

function connectionString(): string {
  return process.env.DATABASE_URL || DEFAULT_URL;
}

function schemaName(): string | null {
  const s = process.env.CP_DB_SCHEMA;
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(s)) throw new Error("CP_DB_SCHEMA không hợp lệ");
  return s;
}

function getPool(): Pool {
  if (!g.__cpPool) {
    const schema = schemaName();
    g.__cpPool = new Pool({
      connectionString: connectionString(),
      max: 8,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    g.__cpPool.on("error", (e) => console.error("[cp-db] lỗi kết nối nhàn rỗi:", e.message));
  }
  return g.__cpPool;
}

function wrap(runner: Pool | PoolClient): Db {
  return {
    async q<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
      return (await runner.query<T>(sql, params)).rows;
    },
    async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = (await runner.query<T>(sql, params)).rows;
      return rows.length > 0 ? rows[0] : null;
    },
  };
}

/** Lỗi DB → lỗi nghiệp vụ (để UI hiện tiếng Việt thay vì stack trace). */
function mapDbError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const err = e as { code?: string; message?: string; constraint?: string };
  if (err.code === "23505") return conflict("Dữ liệu bị trùng (đã tồn tại).");
  if (err.code === "23503") return invalid("Dữ liệu tham chiếu không còn tồn tại.");
  if (err.code === "23514") return invalid("Dữ liệu vi phạm ràng buộc.");
  if (err.code === "P0001") return invalid(err.message ?? "Dữ liệu không hợp lệ.");
  return e;
}

async function migrate(): Promise<void> {
  const schema = schemaName();
  if (schema) {
    const bootstrap = new Pool({ connectionString: connectionString(), max: 1 });
    try {
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    } finally {
      await bootstrap.end();
    }
  }
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ version: number }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
  if (process.env.CP_AUTO_SEED === "1") {
    const { seedIfEmpty } = await import("./seed");
    await seedIfEmpty(wrap(getPool()));
  }
}

/** Chạy migration (và seed nếu bật CP_AUTO_SEED) đúng một lần cho mỗi tiến trình. */
export function ready(): Promise<void> {
  if (!g.__cpReady) {
    g.__cpReady = migrate().catch((e) => {
      g.__cpReady = undefined; // cho phép thử lại (vd. Postgres chưa kịp lên)
      throw e;
    });
  }
  return g.__cpReady;
}

/** Đọc / ghi đơn lẻ (không giao dịch). */
export async function db(): Promise<Db> {
  await ready();
  return wrap(getPool());
}

/** Giao dịch: mọi thay đổi + audit + tăng policy_version phải nằm trong cùng một `tx`. */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  await ready();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw mapDbError(e);
  } finally {
    client.release();
  }
}

/** Dùng trong test / script để đóng pool và xoá schema tạm. */
export async function closeDb(dropSchema = false): Promise<void> {
  const schema = schemaName();
  if (dropSchema && schema && g.__cpPool) {
    await g.__cpPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await g.__cpPool?.end();
  g.__cpPool = undefined;
  g.__cpReady = undefined;
}
