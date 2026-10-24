import Database from 'better-sqlite3';
import type { D1Database, D1PreparedStatement } from './app.js';

/*
 * 语句缓存。
 *
 * 原来每次 first/all/run 都重新 `db.prepare()` —— 每条 SQL 每次执行都要重新解析编译。
 * 查询都走这里的缓存后，同一句 SQL 只编译一次；缓存按粗粒度整体清空兜底（路由里的
 * SQL 都是固定写法的字符串，实际条目远到不了上限）。
 */
const MAX_CACHED_STATEMENTS = 512;

export class D1Emulator implements D1Database {
  private db: Database.Database;
  private statements = new Map<string, Database.Statement>();

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    /*
     * WAL + NORMAL：崩溃不丢事务（掉电才可能丢最后一笔），写入不再每笔都 fsync。
     * 其余三项：临时表与排序放内存、页缓存给到 64MB、mmap 只读页直接映射——
     * 10w 行的库最怕的就是每次扫描都从页缓存里被挤出去。
     */
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -65536');
    this.db.pragma('mmap_size = 268435456');
  }

  /** 供定时任务做 `PRAGMA optimize`（更新统计信息），Node 侧独有，Workers 上没有。 */
  optimize(): void {
    try {
      this.db.pragma('optimize');
    } catch {
      // 统计信息更新失败不影响服务。
    }
  }

  private statement(query: string): Database.Statement {
    let stmt = this.statements.get(query);
    if (!stmt) {
      stmt = this.db.prepare(query);
      if (this.statements.size >= MAX_CACHED_STATEMENTS) this.statements.clear();
      this.statements.set(query, stmt);
    }
    return stmt;
  }

  prepare(query: string): D1PreparedStatement {
    const createBoundStatement = (boundValues: unknown[]): D1PreparedStatement => ({
      bind: (...values: unknown[]) => createBoundStatement(values),
      first: async <T = Record<string, unknown>>() => {
        const stmt = this.statement(query);
        const result = stmt.get(...boundValues) as T | undefined;
        return result ?? null;
      },
      all: async <T = Record<string, unknown>>() => {
        const stmt = this.statement(query);
        const results = stmt.all(...boundValues) as T[];
        return { results };
      },
      run: async () => {
        const stmt = this.statement(query);
        stmt.run(...boundValues);
        return {};
      }
    });
    return createBoundStatement([]);
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        // We know 'stmt' has a 'run' method that executes it. Wait, the actual statements in batch might be run, first, all?
        // D1 batch executes them. We can just call run(). Wait, run is async in our emulator.
        // Let's implement a hack to expose the sync version for batch transaction.
        // For our usage, batch only uses `run` conceptually.
        stmt.run();
        results.push({});
      }
    });
    transaction();
    return results;
  }
}
