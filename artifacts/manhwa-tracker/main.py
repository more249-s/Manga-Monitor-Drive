"""
Manhwa RAW Tracker Bot — Python / discord.py
Improvements:
  - Duplicate notification prevention (tracks last_notified_chapter)
  - Refresh button on every alert — lets you manually re-check without a command
  - track_list now shows last check time + status icon
  - /track_stats  — global stats per server
  - /track_edit   — edit interval/channel/user without removing & re-adding
  - /track_pause and /track_resume
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


# ─────────────────────────────────────────────────────────────
# Refresh Button View
# ─────────────────────────────────────────────────────────────

class RefreshView(discord.ui.View):
    """Persistent view with a refresh button — custom_id encodes tracker_id."""

    def __init__(self, tracker_id: int):
        super().__init__(timeout=None)
        btn = discord.ui.Button(
            label="🔄 تحقق الآن",
            style=discord.ButtonStyle.primary,
            custom_id=f"radar_refresh:{tracker_id}",
        )
        btn.callback = self._on_click
        self.add_item(btn)
        self.tracker_id = tracker_id

    async def _on_click(self, interaction: discord.Interaction):
        tracker = db.get_tracker(self.tracker_id)
        if not tracker:
            await interaction.response.send_message("❌ العمل غير موجود في قاعدة البيانات.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            latest = await scraper.fetch_latest_chapter(tracker["url"], float(tracker["last_chapter"]))
        except Exception as e:
            await interaction.followup.send(f"❌ خطأ أثناء الفحص: {e}", ephemeral=True)
            return

        if latest and latest > float(tracker["last_chapter"]):
            if not db.was_already_notified(self.tracker_id, latest):
                db.update_tracker_chapter(self.tracker_id, latest)
                await interaction.followup.send(
                    f"🚨 **فصل جديد {latest:g}** لـ **{tracker['manga_title']}**!", ephemeral=True
                )
            else:
                await interaction.followup.send(
                    f"⚠️ الفصل {latest:g} سبق إشعاره مسبقاً.", ephemeral=True
                )
        else:
            db.update_tracker_time(self.tracker_id, "manual_checked")
            await interaction.followup.send(
                f"✅ لا يوجد فصل جديد. آخر فصل: **{float(tracker['last_chapter']):g}**", ephemeral=True
            )


# ─────────────────────────────────────────────────────────────
# Bot
# ─────────────────────────────────────────────────────────────

class ManhwaBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        # Map tracker_id → RefreshView for persistent buttons
        self._views: dict[int, RefreshView] = {}

    async def setup_hook(self):
        db.init_db()
        _register_commands(self.tree, self)
        await self.tree.sync()
        print("[Bot] Slash commands synced globally.")
        self.radar_loop.start()

    async def on_ready(self):
        print(f"[Bot] Ready as {self.user} (ID: {self.user.id})")
        await self.change_presence(
            activity=discord.Activity(type=discord.ActivityType.watching, name="manhwa RAWs 📡")
        )

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

            # Skip paused trackers
            if last_result == "paused":
                continue

            # Respect interval
            try:
                last_checked = datetime.datetime.fromisoformat(last_checked_str).replace(
                    tzinfo=datetime.timezone.utc
                )
            except Exception:
                last_checked = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)

            if (now - last_checked).total_seconds() < interval_hours * 3600:
                continue

            print(f"[Radar] {manga_title} | ch {last_chapter} | {url}")

            try:
                latest = await scraper.fetch_latest_chapter(url, last_chapter)
            except Exception as e:
                print(f"[Radar] Error fetching {url}: {e}")
                db.update_tracker_time(tid, "error")
                continue

            if latest and latest > last_chapter:
                # Duplicate prevention
                if db.was_already_notified(tid, latest):
                    print(f"[Radar] Already notified ch {latest} for {manga_title}, skipping.")
                    db.update_tracker_time(tid, "checked")
                    continue

                print(f"[Radar] NEW ch {latest} → {manga_title}")
                channel = self.get_channel(row["channel_id"])
                if channel and isinstance(channel, discord.TextChannel):
                    mention = f"<@{notify_user_id}>" if notify_user_id else ""
                    content = f"{mention} {custom_msg}".strip() or None

                    embed = discord.Embed(
                        title=f"🚨 فصل جديد — {manga_title}",
                        description=(
                            f"**الفصل {latest:g}** متاح الآن!\n\n"
                            f"[📖 اضغط للقراءة]({url})"
                        ),
                        color=discord.Color.red(),
                    )
                    embed.add_field(name="الفصل السابق", value=f"{last_chapter:g}", inline=True)
                    embed.add_field(name="الفصل الجديد", value=f"{latest:g}", inline=True)
                    embed.set_footer(text=f"Tracker ID: {tid}")
                    embed.timestamp = now

                    if auto_dl:
                        embed.add_field(
                            name="⏳ التحميل",
                            value="جاري التحميل والرفع على Google Drive…",
                            inline=False,
                        )

                    view = self.get_or_create_view(tid)
                    msg = await channel.send(content=content, embed=embed, view=view)

                    if auto_dl and folder_id:
                        asyncio.create_task(
                            self._auto_download(msg, url, manga_title, latest, folder_id, tid)
                        )

                db.update_tracker_chapter(tid, latest)

            else:
                db.update_tracker_time(tid, "checked")

    async def _auto_download(self, msg, url, manga_title, chapter, folder_id, tracker_id):
        try:
            site = scraper._detect_site(url)
            image_urls = await scraper.get_chapter_image_urls(url, site)

            if not image_urls:
                embed = msg.embeds[0]
                embed.set_field_at(-1, name="❌ التحميل", value="لم يُعثر على صور الفصل.", inline=False)
                await msg.edit(embed=embed)
                return

            result = await downloader.process_chapter(image_urls, manga_title, chapter, referer=url, stitch=True)

            drive_result = await asyncio.get_event_loop().run_in_executor(
                None,
                drive_upload.upload_chapter,
                result["zip"], result["stitched"], manga_title, chapter, folder_id,
            )

            zip_url = drive_result.get("zip_url", "")
            stitched_url = drive_result.get("stitched_url", "")

            value = f"✅ {result['count']} صورة\n"
            if zip_url:
                value += f"[📦 ZIP]({zip_url})  "
            if stitched_url:
                value += f"[🖼️ stitched 14000px]({stitched_url})"

            embed = msg.embeds[0]
            embed.set_field_at(-1, name="📥 تم الرفع", value=value, inline=False)
            await msg.edit(embed=embed)
            db.log_download(tracker_id, chapter, "done", zip_url or stitched_url)

        except Exception as e:
            print(f"[AutoDL] Error: {e}")


# ─────────────────────────────────────────────────────────────
# Admin check
# ─────────────────────────────────────────────────────────────

def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not isinstance(interaction.user, discord.Member):
            return False
        return interaction.user.guild_permissions.manage_channels
    return app_commands.check(predicate)


# ─────────────────────────────────────────────────────────────
# Commands
# ─────────────────────────────────────────────────────────────

def _register_commands(tree: app_commands.CommandTree, bot: ManhwaBot):

    # ── track_add ──────────────────────────────────────────────
    @tree.command(name="track_add", description="[أدمن] أضف عملاً لرادار الفصول")
    @app_commands.describe(
        url="رابط صفحة العمل (أي موقع مانجا/مانهوا)",
        channel="القناة التي تصلها التنبيهات",
        manga_title="اسم العمل",
        current_chapter="رقم الفصل الحالي (لا يُشعر بما قبله)",
        interval_hours="كل كم ساعة يفحص البوت؟ (افتراضي: 6)",
        custom_message="رسالة مخصصة مع التنبيه (مثلاً: @everyone فصل جديد!)",
        notify_user="منشن عضو معين عند نزول فصل",
        auto_download="تحميل تلقائي + رفع Google Drive",
    )
    @is_admin()
    @app_commands.guild_only()
    async def track_add(
        interaction: discord.Interaction,
        url: str,
        channel: discord.TextChannel,
        manga_title: str,
        current_chapter: float,
        interval_hours: int = 6,
        custom_message: str = "",
        notify_user: Optional[discord.Member] = None,
        auto_download: bool = False,
    ):
        if interval_hours < 1:
            await interaction.response.send_message("❌ أقل مدة هي ساعة واحدة.", ephemeral=True)
            return

        site = scraper._detect_site(url)
        db.add_tracker(
            guild_id=interaction.guild_id,
            channel_id=channel.id,
            url=url,
            site_name=site,
            manga_title=manga_title,
            custom_msg=custom_message,
            interval_hours=interval_hours,
            current_chapter=current_chapter,
            notify_user_id=notify_user.id if notify_user else None,
            auto_download=1 if auto_download else 0,
            drive_folder_id=ROOT_FOLDER_ID,
        )

        embed = discord.Embed(title="📡 تم تفعيل الرادار!", color=discord.Color.green())
        embed.add_field(name="العمل", value=manga_title, inline=True)
        embed.add_field(name="الموقع المكتشف", value=site, inline=True)
        embed.add_field(name="الفصل الحالي", value=f"{current_chapter:g}", inline=True)
        embed.add_field(name="يفحص كل", value=f"{interval_hours} ساعة", inline=True)
        embed.add_field(name="القناة", value=channel.mention, inline=True)
        embed.add_field(name="تحميل تلقائي", value="✅" if auto_download else "❌", inline=True)
        if notify_user:
            embed.add_field(name="سيُنشن", value=notify_user.mention, inline=True)
        embed.set_footer(text="سيتم تجاهل الفصول المكررة تلقائياً")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ── track_list ─────────────────────────────────────────────
    @tree.command(name="track_list", description="عرض الأعمال المتابعة في السيرفر")
    @app_commands.guild_only()
    async def track_list(interaction: discord.Interaction):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not rows:
            await interaction.response.send_message("📭 لا توجد أعمال قيد المتابعة.", ephemeral=True)
            return

        embed = discord.Embed(
            title="📡 قائمة الرادار",
            color=discord.Color.blue(),
            description=f"**{len(rows)}** عمل مُتابع",
        )

        for row in rows[:15]:
            chan = bot.get_channel(int(row["channel_id"]))
            chan_txt = chan.mention if chan else "#unknown"
            status_icon = STATUS_ICONS.get(row["last_result"] or "", "⚪")
            dl_icon = "📥" if row["auto_download"] else "—"
            last_ch_str = row["last_checked"].split("T")[0] if row["last_checked"] else "—"
            embed.add_field(
                name=f"`{row['id']}` {status_icon} {row['manga_title']}",
                value=(
                    f"**الموقع:** {row['site_name']}\n"
                    f"**آخر فصل:** {float(row['last_chapter']):g}\n"
                    f"**القناة:** {chan_txt}\n"
                    f"**كل:** {row['interval_hours']}h  {dl_icon}\n"
                    f"**آخر فحص:** {last_ch_str}\n"
                    f"[🔗 رابط]({row['url']})"
                ),
                inline=True,
            )

        embed.set_footer(text="🔔=أُشعر | ✅=فحص | ❌=خطأ | ⏸️=موقوف")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ── track_remove ───────────────────────────────────────────
    @tree.command(name="track_remove", description="[أدمن] إزالة عمل من الرادار")
    @app_commands.describe(tracker_id="رقم ID (من track_list)")
    @is_admin()
    @app_commands.guild_only()
    async def track_remove(interaction: discord.Interaction, tracker_id: int):
        success = db.remove_tracker(tracker_id, interaction.guild_id)
        if success:
            bot._views.pop(tracker_id, None)
            await interaction.response.send_message(f"✅ تمت إزالة الرادار `{tracker_id}`.", ephemeral=True)
        else:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)

    # ── track_check ────────────────────────────────────────────
    @tree.command(name="track_check", description="[أدمن] فحص فوري لعمل معين")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_check(interaction: discord.Interaction, tracker_id: int):
        rows = db.get_guild_trackers(interaction.guild_id)
        tracker = next((r for r in rows if r["id"] == tracker_id), None)
        if not tracker:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            latest = await scraper.fetch_latest_chapter(tracker["url"], float(tracker["last_chapter"]))
        except Exception as e:
            await interaction.followup.send(f"❌ خطأ: {e}", ephemeral=True)
            return

        if latest and latest > float(tracker["last_chapter"]):
            if db.was_already_notified(tracker_id, latest):
                await interaction.followup.send(
                    f"⚠️ الفصل **{latest:g}** موجود لكن سبق إشعاره. استخدم `/track_force` للإشعار مجدداً.",
                    ephemeral=True,
                )
            else:
                db.update_tracker_chapter(tracker_id, latest)
                await interaction.followup.send(
                    f"🚨 فصل جديد! **الفصل {latest:g}** لـ **{tracker['manga_title']}**\n"
                    f"تم تحديث قاعدة البيانات.", ephemeral=True,
                )
        else:
            db.update_tracker_time(tracker_id, "manual_checked")
            await interaction.followup.send(
                f"✅ لا يوجد فصل جديد. آخر فصل: **{float(tracker['last_chapter']):g}**",
                ephemeral=True,
            )

    # ── track_pause / track_resume ─────────────────────────────
    @tree.command(name="track_pause", description="[أدمن] إيقاف مؤقت لمتابعة عمل")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_pause(interaction: discord.Interaction, tracker_id: int):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not any(r["id"] == tracker_id for r in rows):
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        db.update_tracker_time(tracker_id, "paused")
        await interaction.response.send_message(f"⏸️ تم إيقاف الرادار `{tracker_id}` مؤقتاً.", ephemeral=True)

    @tree.command(name="track_resume", description="[أدمن] استئناف متابعة عمل موقوف")
    @app_commands.describe(tracker_id="ID العمل")
    @is_admin()
    @app_commands.guild_only()
    async def track_resume(interaction: discord.Interaction, tracker_id: int):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not any(r["id"] == tracker_id for r in rows):
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return
        db.update_tracker_time(tracker_id, "checked")
        await interaction.response.send_message(f"▶️ استُؤنف الرادار `{tracker_id}`.", ephemeral=True)

    # ── track_edit ─────────────────────────────────────────────
    @tree.command(name="track_edit", description="[أدمن] تعديل إعدادات متابعة عمل")
    @app_commands.describe(
        tracker_id="ID العمل (من track_list)",
        interval_hours="تغيير الفترة الزمنية بالساعات",
        channel="تغيير القناة",
        notify_user="تغيير الشخص المُنشَن",
        current_chapter="تصحيح رقم الفصل الحالي يدوياً",
    )
    @is_admin()
    @app_commands.guild_only()
    async def track_edit(
        interaction: discord.Interaction,
        tracker_id: int,
        interval_hours: Optional[int] = None,
        channel: Optional[discord.TextChannel] = None,
        notify_user: Optional[discord.Member] = None,
        current_chapter: Optional[float] = None,
    ):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not any(r["id"] == tracker_id for r in rows):
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return

        from database import get_conn
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
            await interaction.response.send_message("ℹ️ لم تُحدد أي تغييرات.", ephemeral=True)
            return

        vals.append(tracker_id)
        with get_conn() as conn:
            conn.execute(f"UPDATE trackers SET {', '.join(updates)} WHERE id = ?", vals)

        await interaction.response.send_message(f"✅ تم تحديث الرادار `{tracker_id}`.", ephemeral=True)

    # ── track_download ─────────────────────────────────────────
    @tree.command(name="track_download", description="[أدمن] تحميل فصل يدوياً ورفعه على Drive")
    @app_commands.describe(
        tracker_id="ID العمل",
        chapter_url="رابط صفحة الفصل مباشرة",
        chapter_number="رقم الفصل",
        stitch="دمج الصور في صورة واحدة؟",
    )
    @is_admin()
    @app_commands.guild_only()
    async def track_download(
        interaction: discord.Interaction,
        tracker_id: int,
        chapter_url: str,
        chapter_number: float,
        stitch: bool = True,
    ):
        rows = db.get_guild_trackers(interaction.guild_id)
        tracker = next((r for r in rows if r["id"] == tracker_id), None)
        if not tracker:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return

        manga_title = tracker["manga_title"]
        folder_id = tracker["drive_folder_id"] or ROOT_FOLDER_ID

        await interaction.response.defer(ephemeral=True)

        try:
            site = scraper._detect_site(chapter_url)
            image_urls = await scraper.get_chapter_image_urls(chapter_url, site)

            if not image_urls:
                await interaction.followup.send("❌ لم يُعثر على صور الفصل.", ephemeral=True)
                return

            result = await downloader.process_chapter(
                image_urls, manga_title, chapter_number, referer=chapter_url, stitch=stitch
            )

            drive_result = await asyncio.get_event_loop().run_in_executor(
                None,
                drive_upload.upload_chapter,
                result["zip"], result["stitched"] if stitch else None,
                manga_title, chapter_number, folder_id,
            )

            zip_url = drive_result.get("zip_url", "")
            stitched_url = drive_result.get("stitched_url", "")

            embed = discord.Embed(
                title=f"✅ تم التحميل — {manga_title} ف{chapter_number:g}",
                color=discord.Color.green(),
            )
            embed.add_field(name="صور محملة", value=str(result["count"]), inline=True)
            if zip_url:
                embed.add_field(name="📦 ZIP", value=f"[فتح]({zip_url})", inline=True)
            if stitched_url:
                embed.add_field(name="🖼️ Stitched 14000px", value=f"[فتح]({stitched_url})", inline=True)

            await interaction.followup.send(embed=embed, ephemeral=True)
            db.log_download(tracker_id, chapter_number, "done", zip_url or stitched_url)

        except Exception as e:
            print(f"[DL cmd] {e}")
            await interaction.followup.send(f"❌ خطأ: {e}", ephemeral=True)

    # ── track_stats ────────────────────────────────────────────
    @tree.command(name="track_stats", description="إحصائيات الرادار لهذا السيرفر")
    @app_commands.guild_only()
    async def track_stats(interaction: discord.Interaction):
        rows = db.get_guild_trackers(interaction.guild_id)

        total = len(rows)
        active = sum(1 for r in rows if (r["last_result"] or "") != "paused")
        paused = total - active
        auto_dl = sum(1 for r in rows if r["auto_download"])
        notified = sum(1 for r in rows if (r["last_result"] or "") in ("notified", "manual_notified"))

        site_counts: dict[str, int] = {}
        for r in rows:
            s = r["site_name"] or "generic"
            site_counts[s] = site_counts.get(s, 0) + 1

        top_sites = sorted(site_counts.items(), key=lambda x: -x[1])[:5]

        embed = discord.Embed(
            title="📊 إحصائيات رادار الفصول",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="إجمالي الأعمال", value=str(total), inline=True)
        embed.add_field(name="نشط", value=str(active), inline=True)
        embed.add_field(name="موقوف", value=str(paused), inline=True)
        embed.add_field(name="تحميل تلقائي", value=str(auto_dl), inline=True)
        embed.add_field(name="أُشعر اليوم", value=str(notified), inline=True)
        if top_sites:
            embed.add_field(
                name="أكثر المواقع",
                value="\n".join(f"• {s}: {c}" for s, c in top_sites),
                inline=False,
            )
        embed.set_footer(text=f"يفحص كل 30 دقيقة")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ── track_sites ────────────────────────────────────────────
    @tree.command(name="track_sites", description="قائمة المواقع المدعومة")
    async def track_sites(interaction: discord.Interaction):
        lines = [
            f"{'🌐' if link != '*' else '🔵'} **{name}**" + (f" — `{link}`" if link != "*" else "")
            for name, link in SUPPORTED_SITES
        ]
        embed = discord.Embed(
            title="🌐 المواقع المدعومة",
            description="\n".join(lines),
            color=discord.Color.purple(),
        )
        embed.set_footer(text="يدعم أي موقع عبر الكشف التلقائي")
        await interaction.response.send_message(embed=embed, ephemeral=True)


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────

bot = ManhwaBot()

if __name__ == "__main__":
    if not TOKEN:
        raise ValueError("DISCORD_BOT_TOKEN is not set!")
    bot.run(TOKEN)
