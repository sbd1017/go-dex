"""SQLite access: one file, WAL, foreign keys on, numbered SQL migrations, explicit transactions."""
import contextlib
import datetime as dt
import pathlib
import sqlite3

MIGRATIONS = pathlib.Path(__file__).resolve().parent / "migrations"


def now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()


class Database:
    def __init__(self, path: pathlib.Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        conn = self.connect()
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            migrate(conn)
        finally:
            conn.close()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    @contextlib.contextmanager
    def read(self):
        conn = self.connect()
        try:
            yield conn
        finally:
            conn.close()

    @contextlib.contextmanager
    def write(self):
        """One transaction; bumps data_version so cached datasets are refreshed."""
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version'")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def backup(self, dest: pathlib.Path) -> pathlib.Path:
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        src = self.connect()
        out = sqlite3.connect(dest)
        try:
            src.backup(out)
            if out.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("backup failed its integrity check")
        finally:
            out.close()
            src.close()
        return dest


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name in done:
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            for stmt in split_sql(path.read_text(encoding="utf-8")):
                conn.execute(stmt)
            conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (path.name, now()))
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def split_sql(text: str):
    buf = []
    for line in text.splitlines():
        buf.append(line)
        if sqlite3.complete_statement("\n".join(buf)):
            stmt = "\n".join(buf).strip()
            if stmt.strip(";").strip() and not all(line.strip().startswith("--") or not line.strip() for line in buf):
                yield stmt
            buf = []


def data_version(conn) -> int:
    return int(conn.execute("SELECT value FROM meta WHERE key = 'data_version'").fetchone()[0])
