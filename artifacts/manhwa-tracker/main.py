"""
Manhwa RAW Tracker Bot — Python / discord.py
Improvements:
  - Duplicate notification prevention
  - Refresh button on alerts
  - Safer /download direct chapter flow
  - track_list shows status icons and last check
  - /track_stats, /track_edit, /track_pause, /track_resume
  - Cloudflare bypass (cloudscraper)
  - Auto-download + SmartStitch 14000px + Google Drive upload
"""

import os
import asyncio
import datetime
from typing import Optional

import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

import discord
from discord import app_commands
from discord.ext import tasks

import database as db
import scraper
import downloader
import drive_upload

TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
ROOT_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
GUILD_ID = 1219426192076312616
TARGET_GUILD = discord.Object(id=GUILD_ID)

SUPPORTED_SITES = [
    ("Asura Scans", "asuracomic.net"),
    ("NewToki", "newtoki.com"),
    ("Nirvana Scans", "nirvanacomic.com"),
    ("Vortex Scans", "vortexscans.org"),
    ("Flame Scans", "flamecomics.xyz"),
    ("Reaper Scans", "reaperscans.com"),
    ("Luminous Scans", "luminousscans.com"),
    ("MangaDex (API)", "mangadex.org"),
    ("Bato.to", "bato.to"),
    ("Manganelo", "manganelo.com"),
    ("Mangakakalot", "mangakakalot.com"),
    ("Webtoon", "webtoons.com"),
    ("Toonily", "toonily.com"),
    ("Isekai Scan", "isekaiscan.com"),
    ("Manhua Plus", "manhuaplus.com"),
    ("Kun Manga", "kunmanga.com"),
    ("Hiperdex", "hiperdex.com"),
    ("Manga Buddy", "mangabuddy.com"),
    ("Nitro Scans", "nitroscans.com"),
    ("Generic (أي موقع)", "*"),
]

STATUS_ICONS = {
    "notified": "🔔",
    "checked": "✅",
    "error": "❌",
    "manual_checked": "🔍",
    "manual_notified": "🚨",
    "paused": "⏸️",
    "": "⚪",
}


class RefreshView(discord.ui.View):
    def __init__(self, tracker_id: int):
        super().__init__(timeout=None)
        button = discord.ui.Button(label="🔄 تحقق الآن", style=discord.ButtonStyle.primary, custom_id=f"radar_refresh:{tracker_id}")
        button.callback = self._callback
        self.add_item(button)
        self.tracker_id = tracker_id

    async def _callback(self, interaction: discord.Interaction):
        tracker = db.get_tracker(self.tracker_id)
        if not tracker:
            await interaction.response.send_message("❌ العمل غير موجود.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            latest = await scraper.fetch_latest_chapter(tracker["url"], float(tracker["last_chapter"]))
        except Exception as e:
            db.update_tracker_time(self.tracker_id, "error")
            await interaction.followup.send(f"❌ خطأ أثناء الفحص: {e}", ephemeral=True)
            return

        if latest and latest > float(tracker["last_chapter"]):
            if db.was_already_notified(self.tracker_id, latest):
                await interaction.followup.send(f"⚠️ الفصل {latest:g} سبق إشعاره.", ephemeral=True)
            else:
                db.update_tracker_chapter(self.tracker_id, latest)
                await interaction.followup.send(f"🚨 فصل جديد **{latest:g}** لـ **{tracker['manga_title']}**!", ephemeral=True)
        else:
            db.update_tracker_time(self.tracker_id, "manual_checked")
            await interaction.followup.send(f"✅ لا يوجد فصل جديد. آخر فصل: **{float(tracker['last_chapter']):g}**", ephemeral=True)


class ManhwaBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self._views: dict[int, RefreshView] = {}

    async def setup_hook(self):
        db.init_db()
        _register_commands(self.tree, self)
        self.tree.copy_global_to(guild=TARGET_GUILD)
        await self.tree.sync(guild=TARGET_GUILD)
        print(f"[Bot] Commands synced to guild {GUILD_ID}.")
        self.radar_loop.start()

    async def on_ready(self):
        print(f"[Bot] Ready as {self.user} (ID: {self.user.id})")
        await self.change_presence(activity=discord.Activity(type=discord.ActivityType.watching, name="manhwa RAWs 📡"))

    def get_or_create_view(self, tracker_id: int) -> RefreshView:
        if tracker_id not in self._views:
            self._views[tracker_id] = RefreshView(tracker_id)
        return self._views[tracker_id]

    @tasks.loop(minutes=30)
    async def radar_loop(self):
        await self.wait_until_ready()
        now = datetime.datetime.now(datetime.timezone.utc)
        trackers = db.get_all_trackers()
        if not trackers:
            return

        print(f"[Radar] Checking {len(trackers)} tracker(s)…")
        for row in trackers:
            tid = row["id"]
            url = row["url"]
            manga_title = row["manga_title"]
            last_chapter = float(row["last_chapter"])
            custom_msg = row["custom_msg"] or ""
            interval_hours = int(row["interval_hours"])
            last_checked_str = row["last_checked"]
            notify_user_id = row["notify_user_id"]
            auto_dl = bool(row["auto_download"])
            folder_id = row["drive_folder_id"] or ROOT_FOLDER_ID
            last_result = row["last_result"] or ""

            if last_result == "paused":
                continue

            try:
                last_checked = datetime.datetime.fromisoformat(last_checked_str).replace(tzinfo=datetime.timezone.utc)
            except Exception:
                last_checked = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)

            if (now - last_checked).total_seconds() < interval_hours * 3600:
                continue

            try:
                latest = await scraper.fetch_latest_chapter(url, last_chapter)
            except Exception as e:
                print(f"[Radar] Error fetching {url}: {e}")
                db.update_tracker_time(tid, "error")
                continue

            if latest and latest > last_chapter:
                if db.was_already_notified(tid, latest):
                    db.update_tracker_time(tid, "checked")
                    continue

                channel = self.get_channel(row["channel_id"])
                if channel and isinstance(channel, discord.TextChannel):
                    mention = f"<@{notify_user_id}>" if notify_user_id else ""
                    content = f"{mention} {custom_msg}".strip() or None
                    embed = discord.Embed(
                        title=f"🚨 فصل جديد — {manga_title}",
                        description=f"**الفصل {latest:g}** متاح الآن!\n\n[📖 اضغط للقراءة]({url})",
                        color=discord.Color.red(),
                    )
                    embed.add_field(name="الفصل السابق", value=f"{last_chapter:g}", inline=True)
                    embed.add_field(name="الفصل الجديد", value=f"{latest:g}", inline=True)
                    embed.timestamp = now
                    msg = await channel.send(content=content, embed=embed, view=self.get_or_create_view(tid))
                    if auto_dl and folder_id:
                        asyncio.create_task(self._auto_download(msg, url, manga_title, latest, folder_id, tid))
                db.update_tracker_chapter(tid, latest)
            else:
                db.update_tracker_time(tid, "checked")

    async def _auto_download(self, msg, url, manga_title, chapter, folder_id, tracker_id):
        try:
            site = scraper._detect_site(url)
            image_urls = await scraper.get_chapter_image_urls(url, site)
            if not image_urls:
                embed = msg.embeds[0]
                embed.add_field(name="التحميل", value="لم يتم العثور على صور.", inline=False)
                await msg.edit(embed=embed)
                return

            result = await downloader.process_chapter(image_urls, manga_title, chapter, referer=url, stitch=True)
            drive_result = await asyncio.get_event_loop().run_in_executor(
                None,
                drive_upload.upload_chapter,
                result["zip"],
                result["stitched"],
                manga_title,
                chapter,
                folder_id,
            )
            embed = msg.embeds[0]
            value = f"✅ {result['count']} صورة"
            if drive_result.get("zip_url"):
                value += f"\n[📦 ZIP]({drive_result['zip_url']})"
            if drive_result.get("stitched_url"):
                value += f"\n[🖼️ صورة مدمجة]({drive_result['stitched_url']})"
            embed.add_field(name="تم التحميل", value=value, inline=False)
            await msg.edit(embed=embed)
            db.log_download(tracker_id, chapter, "done", drive_result.get("zip_url") or drive_result.get("stitched_url", ""))
        except Exception as e:
            print(f"[AutoDL] Error: {e}")


def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        return isinstance(interaction.user, discord.Member) and interaction.user.guild_permissions.manage_channels
    return app_commands.check(predicate)


def _register_commands(tree: app_commands.CommandTree, bot: ManhwaBot):
    @tree.command(name="track_add", description="[أدمن] أضف عملاً للرادار")
    @app_commands.describe(url="رابط العمل", channel="قناة التنبيه", manga_title="اسم العمل", current_chapter="رقم الفصل الحالي", interval_hours="كل كم ساعة يفحص؟", custom_message="رسالة إضافية", notify_user="منشن عضو", auto_download="تحميل تلقائي؟")
    @is_admin()
    @app_commands.guild_only()
    async def track_add(interaction: discord.Interaction, url: str, channel: discord.TextChannel, manga_title: str, current_chapter: float, interval_hours: int = 6, custom_message: str = "", notify_user: Optional[discord.Member] = None, auto_download: bool = False):
        if interval_hours < 1:
            await interaction.response.send_message("❌ أقل مدة هي ساعة.", ephemeral=True)
            return
        site = scraper._detect_site(url)
        db.add_tracker(interaction.guild_id, channel.id, url, site, manga_title, custom_message, interval_hours, current_chapter, notify_user.id if notify_user else None, 1 if auto_download else 0, ROOT_FOLDER_ID)
        await interaction.response.send_message(embed=discord.Embed(title="📡 تم تفعيل الرادار!", color=discord.Color.green()).add_field(name="العمل", value=manga_title, inline=True) if False else f"✅ تم تفعيل الرادار لـ **{manga_title}**.", ephemeral=True)

    @tree.command(name="track_list", description="عرض الأعمال المتابعة")
    @app_commands.guild_only()
    async def track_list(interaction: discord.Interaction):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not rows:
            await interaction.response.send_message("📭 لا توجد أعمال قيد المتابعة.", ephemeral=True)
            return
        embed = discord.Embed(title="📡 قائمة الرادار", color=discord.Color.blue(), description=f"**{len(rows)}** عمل متابع")
        for row in rows[:15]:
            chan = bot.get_channel(int(row["channel_id"]))
            chan_txt = chan.mention if chan else "#unknown"
            status_icon = STATUS_ICONS.get(row["last_result"] or "", "⚪")
            last_ch_str = row["last_checked"].split("T")[0] if row["last_checked"] else "—"
            embed.add_field(name=f"`{row['id']}` {status_icon} {row['manga_title']}", value=f"**الموقع:** {row['site_name']}\n**آخر فصل:** {float(row['last_chapter']):g}\n**القناة:** {chan_txt}\n**آخر فحص:** {last_ch_str}", inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name="track_remove", description="[أدمن] إزالة عمل")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_remove(interaction: discord.Interaction, tracker_id: int):
        ok = db.remove_tracker(tracker_id, interaction.guild_id)
        if ok:
            bot._views.pop(tracker_id, None)
            await interaction.response.send_message(f"✅ تم حذف `{tracker_id}`.", ephemeral=True)
        else:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)

    @tree.command(name="track_check", description="[أدمن] فحص فوري")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_check(interaction: discord.Interaction, tracker_id: int):
        tracker = db.get_tracker(tracker_id)
        if not tracker or tracker["guild_id"] != interaction.guild_id:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        latest = await scraper.fetch_latest_chapter(tracker["url"], float(tracker["last_chapter"]))
        if latest and latest > float(tracker["last_chapter"]):
            if db.was_already_notified(tracker_id, latest):
                await interaction.followup.send(f"⚠️ الفصل {latest:g} سبق إشعاره.", ephemeral=True)
            else:
                db.update_tracker_chapter(tracker_id, latest)
                await interaction.followup.send(f"🚨 فصل جديد **{latest:g}** لـ **{tracker['manga_title']}**!", ephemeral=True)
        else:
            db.update_tracker_time(tracker_id, "manual_checked")
            await interaction.followup.send(f"✅ لا يوجد فصل جديد. آخر فصل: **{float(tracker['last_chapter']):g}**", ephemeral=True)

    @tree.command(name="track_pause", description="[أدمن] إيقاف متابعة عمل")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_pause(interaction: discord.Interaction, tracker_id: int):
        tracker = db.get_tracker(tracker_id)
        if not tracker or tracker["guild_id"] != interaction.guild_id:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        db.update_tracker_time(tracker_id, "paused")
        await interaction.response.send_message(f"⏸️ تم إيقاف `{tracker_id}` مؤقتاً.", ephemeral=True)

    @tree.command(name="track_resume", description="[أدمن] استئناف متابعة عمل")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_resume(interaction: discord.Interaction, tracker_id: int):
        tracker = db.get_tracker(tracker_id)
        if not tracker or tracker["guild_id"] != interaction.guild_id:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        db.update_tracker_time(tracker_id, "checked")
        await interaction.response.send_message(f"▶️ تم استئناف `{tracker_id}`.", ephemeral=True)

    @tree.command(name="track_edit", description="[أدمن] تعديل متابعة")
    @app_commands.describe(tracker_id="ID العمل", interval_hours="الفترة بالساعات", channel="قناة جديدة", notify_user="منشن جديد", current_chapter="تحديث الفصل الحالي")
    @is_admin()
    @app_commands.guild_only()
    async def track_edit(interaction: discord.Interaction, tracker_id: int, interval_hours: Optional[int] = None, channel: Optional[discord.TextChannel] = None, notify_user: Optional[discord.Member] = None, current_chapter: Optional[float] = None):
        tracker = db.get_tracker(tracker_id)
        if not tracker or tracker["guild_id"] != interaction.guild_id:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        updates = []
        vals = []
        if interval_hours is not None:
            updates.append("interval_hours = ?"); vals.append(interval_hours)
        if channel is not None:
            updates.append("channel_id = ?"); vals.append(channel.id)
        if notify_user is not None:
            updates.append("notify_user_id = ?"); vals.append(notify_user.id)
        if current_chapter is not None:
            updates.append("last_chapter = ?"); vals.append(current_chapter)
            updates.append("last_notified_chapter = ?"); vals.append(current_chapter)
        if not updates:
            await interaction.response.send_message("ℹ️ لم يتم تحديد أي تغييرات.", ephemeral=True)
            return
        vals.append(tracker_id)
        from database import get_conn
        with get_conn() as conn:
            conn.execute(f"UPDATE trackers SET {', '.join(updates)} WHERE id = ?", vals)
        await interaction.response.send_message(f"✅ تم تحديث `{tracker_id}`.", ephemeral=True)

    @tree.command(name="download", description="حمّل فصل مباشر من رابطه")
    @app_commands.describe(chapter_url="رابط صفحة الفصل", manga_title="اسم العمل", chapter_number="رقم الفصل (اختياري)", stitch="دمج الصور؟")
    @is_admin()
    @app_commands.guild_only()
    async def download_direct(interaction: discord.Interaction, chapter_url: str, manga_title: str, chapter_number: Optional[float] = None, stitch: bool = True):
        await interaction.response.defer(ephemeral=True)
        status_msg = await interaction.followup.send("⏳ جاري فحص الرابط…", ephemeral=True, wait=True)
        try:
            site = scraper._detect_site(chapter_url)
            image_urls = await scraper.get_chapter_image_urls(chapter_url, site)
            if not image_urls:
                await status_msg.edit(content="❌ لم أجد صوراً في الرابط. لازم رابط فصل مباشر.")
                return
            await status_msg.edit(content=f"📥 وُجد **{len(image_urls)}** صورة — جاري التحميل…")
            ch_label = chapter_number if chapter_number is not None else 0.0
            result = await downloader.process_chapter(image_urls, manga_title, ch_label, referer=chapter_url, stitch=stitch)
            if not ROOT_FOLDER_ID:
                await status_msg.edit(content="❌ Google Drive Folder ID غير مضبوط.")
                return
            await status_msg.edit(content="☁️ جاري الرفع على Google Drive…")
            drive_result = await asyncio.get_event_loop().run_in_executor(None, drive_upload.upload_chapter, result["zip"], result["stitched"] if stitch else None, manga_title, ch_label, ROOT_FOLDER_ID)
            embed = discord.Embed(title=f"✅ اكتمل التحميل — {manga_title}" + (f" ف{ch_label:g}" if ch_label else ""), color=discord.Color.green())
            embed.add_field(name="الموقع", value=site, inline=True)
            embed.add_field(name="عدد الصور", value=str(result["count"]), inline=True)
            if stitch:
                embed.add_field(name="العرض", value="14000px", inline=True)
            if drive_result.get("zip_url"):
                embed.add_field(name="📦 ZIP", value=f"[فتح الملف]({drive_result['zip_url']})", inline=False)
            if drive_result.get("stitched_url"):
                embed.add_field(name="🖼️ صورة مدمجة", value=f"[فتح الصورة]({drive_result['stitched_url']})", inline=False)
            await status_msg.edit(content=None, embed=embed)
        except Exception as e:
            print(f"[/download] Error: {e}")
            await status_msg.edit(content=f"❌ خطأ: {e}")

    @tree.command(name="track_stats", description="إحصائيات الرادار")
    @app_commands.guild_only()
    async def track_stats(interaction: discord.Interaction):
        rows = db.get_guild_trackers(interaction.guild_id)
        total = len(rows)
        active = sum(1 for r in rows if (r["last_result"] or "") != "paused")
        paused = total - active
        auto_dl = sum(1 for r in rows if r["auto_download"])
        embed = discord.Embed(title="📊 إحصائيات الرادار", color=discord.Color.blurple())
        embed.add_field(name="إجمالي الأعمال", value=str(total), inline=True)
        embed.add_field(name="نشط", value=str(active), inline=True)
        embed.add_field(name="موقوف", value=str(paused), inline=True)
        embed.add_field(name="تحميل تلقائي", value=str(auto_dl), inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name="track_sites", description="قائمة المواقع المدعومة")
    async def track_sites(interaction: discord.Interaction):
        lines = [f"{('🌐' if link != '*' else '🔵')} **{name}**" + (f" — `{link}`" if link != "*" else "") for name, link in SUPPORTED_SITES]
        await interaction.response.send_message(embed=discord.Embed(title="🌐 المواقع المدعومة", description="\n".join(lines), color=discord.Color.purple()), ephemeral=True)


bot = ManhwaBot()

if __name__ == "__main__":
    if not TOKEN:
        raise ValueError("DISCORD_BOT_TOKEN is not set!")
    bot.run(TOKEN)
