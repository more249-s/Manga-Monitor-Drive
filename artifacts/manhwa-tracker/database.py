import sqlite3
import os

DB_PATH = os.environ.get("TRACKER_DB", "tracker.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _add_column_if_missing(conn, table, column, definition):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS trackers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id INTEGER NOT NULL,
                channel_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                site_name TEXT DEFAULT 'auto',
                manga_title TEXT DEFAULT 'Unknown',
                last_chapter REAL NOT NULL DEFAULT 0,
                custom_msg TEXT DEFAULT '',
                interval_hours INTEGER NOT NULL DEFAULT 6,
                last_checked TEXT NOT NULL DEFAULT '2000-01-01T00:00:00',
                last_notified_chapter REAL DEFAULT -1,
                last_result TEXT DEFAULT '',
                notify_user_id INTEGER,
                auto_download INTEGER DEFAULT 0,
                drive_folder_id TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tracker_id INTEGER,
                chapter REAL,
                status TEXT DEFAULT 'pending',
                drive_link TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
        """)
        # Safe migrations for existing DBs
        _add_column_if_missing(conn, "trackers", "last_notified_chapter", "REAL DEFAULT -1")
        _add_column_if_missing(conn, "trackers", "last_result", "TEXT DEFAULT ''")
    print("[DB] Database initialized.")


def add_tracker(guild_id, channel_id, url, site_name, manga_title,
                custom_msg, interval_hours, current_chapter,
                notify_user_id=None, auto_download=0, drive_folder_id=""):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO trackers
               (guild_id, channel_id, url, site_name, manga_title,
                last_chapter, custom_msg, interval_hours, last_checked,
                last_notified_chapter, notify_user_id, auto_download, drive_folder_id)
               VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,?,?,?)""",
            (guild_id, channel_id, url, site_name, manga_title,
             current_chapter, custom_msg, interval_hours,
             current_chapter, notify_user_id, auto_download, drive_folder_id),
        )


def get_all_trackers():
    with get_conn() as conn:
        return conn.execute("SELECT * FROM trackers").fetchall()


def get_guild_trackers(guild_id):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM trackers WHERE guild_id = ?", (guild_id,)
        ).fetchall()


def get_tracker(tracker_id):
    with get_conn() as conn:
        return conn.execute("SELECT * FROM trackers WHERE id = ?", (tracker_id,)).fetchone()


def remove_tracker(tracker_id, guild_id) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM trackers WHERE id = ? AND guild_id = ?",
            (tracker_id, guild_id),
        )
        return cur.rowcount > 0


def update_tracker_chapter(tracker_id, new_chapter):
    with get_conn() as conn:
        conn.execute(
            """UPDATE trackers
               SET last_chapter = ?, last_notified_chapter = ?,
                   last_checked = datetime('now'), last_result = 'notified'
               WHERE id = ?""",
            (new_chapter, new_chapter, tracker_id),
        )


def update_tracker_time(tracker_id, result="checked"):
    with get_conn() as conn:
        conn.execute(
            "UPDATE trackers SET last_checked = datetime('now'), last_result = ? WHERE id = ?",
            (result, tracker_id),
        )


def was_already_notified(tracker_id, chapter) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT last_notified_chapter FROM trackers WHERE id = ?", (tracker_id,)
        ).fetchone()
        if row:
            return float(row["last_notified_chapter"] or -1) >= float(chapter)
    return False


def log_download(tracker_id, chapter, status="pending", drive_link=""):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO downloads (tracker_id, chapter, status, drive_link) VALUES (?,?,?,?)",
            (tracker_id, chapter, status, drive_link),
        )
