import sqlite3
import os

DB_PATH = os.environ.get("TRACKER_DB", "tracker.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
                last_notification TEXT,
                last_result TEXT,
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
        conn.execute("ALTER TABLE trackers ADD COLUMN last_notification TEXT")
        conn.execute("ALTER TABLE trackers ADD COLUMN last_result TEXT")
    print("[DB] Database initialized.")


def add_tracker(guild_id, channel_id, url, site_name, manga_title,
                custom_msg, interval_hours, current_chapter,
                notify_user_id=None, auto_download=0, drive_folder_id=""):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO trackers
               (guild_id, channel_id, url, site_name, manga_title,
                last_chapter, custom_msg, interval_hours, last_checked,
                notify_user_id, auto_download, drive_folder_id)
               VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,?,?)""",
            (guild_id, channel_id, url, site_name, manga_title,
             current_chapter, custom_msg, interval_hours,
             notify_user_id, auto_download, drive_folder_id),
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
            "UPDATE trackers SET last_chapter = ?, last_checked = datetime('now') WHERE id = ?",
            (new_chapter, tracker_id),
        )


def update_tracker_status(tracker_id, last_checked=None, last_notification=None, last_result=None):
    parts = []
    values = []
    if last_checked is not None:
        parts.append("last_checked = ?")
        values.append(last_checked)
    if last_notification is not None:
        parts.append("last_notification = ?")
        values.append(last_notification)
    if last_result is not None:
        parts.append("last_result = ?")
        values.append(last_result)
    if not parts:
        return
    values.append(tracker_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE trackers SET {', '.join(parts)} WHERE id = ?", values)


def log_download(tracker_id, chapter, status="pending", drive_link=""):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO downloads (tracker_id, chapter, status, drive_link) VALUES (?,?,?,?)",
            (tracker_id, chapter, status, drive_link),
        )


def update_download_status(tracker_id, chapter, status, drive_link=""):
    with get_conn() as conn:
        conn.execute(
            "UPDATE downloads SET status=?, drive_link=? WHERE tracker_id=? AND chapter=?",
            (status, drive_link, tracker_id, chapter),
        )
