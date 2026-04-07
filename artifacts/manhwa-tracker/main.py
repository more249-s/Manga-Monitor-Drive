"""
Manhwa RAW Tracker Bot — Python / discord.py
Features:
  - Cloudflare bypass via cloudscraper
  - Radar loop: checks tracked works every N hours
  - Auto-download + stitch (14000px wide) + Google Drive upload
  - Slash commands: /track_add /track_list /track_remove /track_download /track_sites
"""

import os
import re
import ssl
import asyncio
import datetime
from typing import Optional

import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

import aiohttp
import discord
from discord import app_commands
from discord.ext import tasks

import database as db
import scraper
import downloader
import drive_upload

# ──────────────────────────────────────────────
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
ROOT_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
# ──────────────────────────────────────────────

SUPPORTED_SITES = [
    ("Asura Scans", "https://asuracomic.net"),
    ("NewToki", "https://newtoki.com"),
    ("Nirvana Scans", "https://nirvanacomic.com"),
    ("Vortex Scans", "https://vortexscans.org"),
    ("Flame Scans", "https://flamecomics.xyz"),
    ("Reaper Scans", "https://reaperscans.com"),
    ("Luminous Scans", "https://luminousscans.com"),
    ("MangaDex (API)", "https://mangadex.org"),
    ("Bato.to", "https://bato.to"),
    ("Manganelo", "https://manganelo.com"),
    ("Mangakakalot", "https://mangakakalot.com"),
    ("Webtoon", "https://webtoons.com"),
    ("Toonily", "https://toonily.com"),
    ("Isekai Scan", "https://isekaiscan.com"),
    ("Manhua Plus", "https://manhuaplus.com"),
    ("Kun Manga", "https://kunmanga.com"),
    ("Hiperdex", "https://hiperdex.com"),
    ("Manga Buddy", "https://mangabuddy.com"),
    ("Nitro Scans", "https://nitroscans.com"),
    ("Generic (any site)", "*"),
]


class ManhwaBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        db.init_db()
        self._register_commands()
        await self.tree.sync()
        print("[Bot] Slash commands synced globally.")
        self.radar_loop.start()

    def _register_commands(self):
        register_commands(self.tree, self)

    async def on_ready(self):
        print(f"[Bot] Ready as {self.user} (ID: {self.user.id})")
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="manhwa RAWs 📡",
            )
        )

    @tasks.loop(minutes=30)
    async def radar_loop(self):
        await self.wait_until_ready()
        now = datetime.datetime.now(datetime.timezone.utc)
        trackers = db.get_all_trackers()
        if not trackers:
            return

        print(f"[Radar] Checking {len(trackers)} tracker(s)...")

        for row in trackers:
            tracker_id = row["id"]
            guild_id = row["guild_id"]
            channel_id = row["channel_id"]
            url = row["url"]
            site_name = row["site_name"]
            manga_title = row["manga_title"]
            last_chapter = float(row["last_chapter"])
            custom_msg = row["custom_msg"] or ""
            interval_hours = int(row["interval_hours"])
            last_checked_str = row["last_checked"]
            notify_user_id = row["notify_user_id"]
            auto_download = bool(row["auto_download"])
            drive_folder_id = row["drive_folder_id"] or ROOT_FOLDER_ID

            try:
                last_checked = datetime.datetime.fromisoformat(last_checked_str).replace(
                    tzinfo=datetime.timezone.utc
                )
            except Exception:
                last_checked = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)

            if (now - last_checked).total_seconds() < interval_hours * 3600:
                continue

            print(f"[Radar] Checking: {manga_title} | Last ch: {last_chapter} | {url}")

            try:
                latest = await scraper.fetch_latest_chapter(url, last_chapter)

                if latest and latest > last_chapter:
                    print(f"[Radar] NEW chapter {latest} found for {manga_title}!")
                    channel = self.get_channel(channel_id)
                    if channel and isinstance(channel, discord.TextChannel):
                        mention = f"<@{notify_user_id}>" if notify_user_id else ""
                        content = f"{mention} {custom_msg}".strip()

                        embed = discord.Embed(
                            title=f"🚨 فصل جديد — {manga_title}",
                            description=(
                                f"**الفصل {latest:g}** متاح الآن!\n\n"
                                f"[اضغط هنا للقراءة]({url})"
                            ),
                            color=discord.Color.red(),
                        )
                        embed.set_footer(text=f"آخر فصل معروف: {last_chapter:g} → {latest:g}")
                        embed.timestamp = datetime.datetime.now(datetime.timezone.utc)

                        view = None
                        if auto_download:
                            embed.add_field(
                                name="⏳ التحميل",
                                value="جاري التحميل والرفع على Google Drive...",
                                inline=False,
                            )

                        msg = await channel.send(content=content or None, embed=embed)

                        # Auto-download if enabled
                        if auto_download and drive_folder_id:
                            asyncio.create_task(
                                self._auto_download_and_update(
                                    msg, url, manga_title, latest,
                                    drive_folder_id, tracker_id,
                                )
                            )

                    db.update_tracker_chapter(tracker_id, latest)

                else:
                    db.update_tracker_time(tracker_id)

            except Exception as e:
                print(f"[Radar] Error for tracker {tracker_id}: {e}")

    async def _auto_download_and_update(
        self,
        msg: discord.Message,
        url: str,
        manga_title: str,
        chapter: float,
        folder_id: str,
        tracker_id: int,
    ):
        try:
            site = scraper._detect_site(url)
            image_urls = await scraper.get_chapter_image_urls(url, site)

            if not image_urls:
                await msg.edit(
                    embed=msg.embeds[0].set_field_at(
                        -1, name="❌ التحميل", value="لم يتم العثور على صور الفصل.", inline=False
                    )
                )
                return

            result = await downloader.process_chapter(
                image_urls, manga_title, chapter, referer=url, stitch=True
            )

            if not result["zip"] and not result["stitched"]:
                return

            drive_result = await asyncio.get_event_loop().run_in_executor(
                None,
                drive_upload.upload_chapter,
                result["zip"],
                result["stitched"],
                manga_title,
                chapter,
                folder_id,
            )

            zip_url = drive_result.get("zip_url", "")
            stitched_url = drive_result.get("stitched_url", "")

            embed = msg.embeds[0]
            value = f"✅ {result['count']} صورة محملة\n"
            if zip_url:
                value += f"[📦 ZIP]({zip_url})  "
            if stitched_url:
                value += f"[🖼️ صورة مدمجة]({stitched_url})"

            embed.set_field_at(-1, name="📥 تم التحميل", value=value, inline=False)
            await msg.edit(embed=embed)

            db.log_download(tracker_id, chapter, "done", zip_url or stitched_url)

        except Exception as e:
            print(f"[AutoDownload] Error: {e}")


def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not isinstance(interaction.user, discord.Member):
            return False
        return interaction.user.guild_permissions.manage_channels
    return app_commands.check(predicate)


def register_commands(tree: app_commands.CommandTree, bot: ManhwaBot):

    @tree.command(name="track_add", description="[أدمن] أضف عملاً لقائمة المتابعة")
    @app_commands.describe(
        url="رابط العمل (أي موقع مانجا/مانهوا)",
        channel="القناة التي سيُرسل إليها الإشعار",
        manga_title="اسم العمل",
        current_chapter="رقم الفصل الحالي",
        interval_hours="كل كم ساعة يتحقق البوت؟ (افتراضي: 6)",
        custom_message="رسالة مخصصة أو منشن (مثال: @everyone)",
        notify_user="منشن مستخدم معين عند نزول الفصل",
        auto_download="تحميل الفصل تلقائياً ورفعه على Drive؟",
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
            await interaction.response.send_message(
                "❌ أقل مدة للتحقق هي ساعة واحدة.", ephemeral=True
            )
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

        embed = discord.Embed(
            title="📡 تم تفعيل الرادار!",
            color=discord.Color.green(),
        )
        embed.add_field(name="العمل", value=manga_title, inline=True)
        embed.add_field(name="الموقع", value=site, inline=True)
        embed.add_field(name="آخر فصل", value=f"{current_chapter:g}", inline=True)
        embed.add_field(name="كل كم؟", value=f"{interval_hours} ساعة", inline=True)
        embed.add_field(name="القناة", value=channel.mention, inline=True)
        embed.add_field(
            name="تحميل تلقائي؟",
            value="✅ نعم" if auto_download else "❌ لا",
            inline=True,
        )
        if notify_user:
            embed.add_field(name="سيتم منشن", value=notify_user.mention, inline=True)

        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ─────────────────────────────────────────────────

    @tree.command(name="track_list", description="عرض الأعمال المتابعة في هذا السيرفر")
    @app_commands.guild_only()
    async def track_list(interaction: discord.Interaction):
        rows = db.get_guild_trackers(interaction.guild_id)
        if not rows:
            await interaction.response.send_message(
                "لا توجد أعمال قيد المتابعة.", ephemeral=True
            )
            return

        embed = discord.Embed(
            title="📡 قائمة الرادار",
            color=discord.Color.blue(),
            description=f"إجمالي: **{len(rows)}** عمل",
        )

        for row in rows[:15]:
            ch_val = f"{row['channel_id']}"
            chan = bot.get_channel(int(ch_val))
            chan_mention = chan.mention if chan else "#unknown"
            dl_icon = "📥" if row["auto_download"] else "—"
            embed.add_field(
                name=f"`ID {row['id']}` — {row['manga_title']}",
                value=(
                    f"**الموقع:** {row['site_name']}\n"
                    f"**الفصل:** {float(row['last_chapter']):g}\n"
                    f"**القناة:** {chan_mention}\n"
                    f"**كل:** {row['interval_hours']}h  {dl_icon}\n"
                    f"[رابط]({row['url']})"
                ),
                inline=True,
            )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ─────────────────────────────────────────────────

    @tree.command(name="track_remove", description="[أدمن] إزالة عمل من قائمة المتابعة")
    @app_commands.describe(tracker_id="رقم ID (من track_list)")
    @is_admin()
    @app_commands.guild_only()
    async def track_remove(interaction: discord.Interaction, tracker_id: int):
        success = db.remove_tracker(tracker_id, interaction.guild_id)
        if success:
            await interaction.response.send_message(
                f"✅ تمت إزالة الرادار `{tracker_id}` بنجاح.", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                "❌ لم يتم العثور على هذا الـ ID.", ephemeral=True
            )

    # ─────────────────────────────────────────────────

    @tree.command(name="track_download", description="تحميل فصل معين يدوياً ورفعه على Drive")
    @app_commands.describe(
        tracker_id="ID العمل (من track_list)",
        chapter_url="رابط صفحة الفصل مباشرة",
        chapter_number="رقم الفصل",
        stitch="دمج الصور في صورة واحدة طويلة؟",
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

        await interaction.response.send_message(
            f"⏳ جاري تحميل الفصل **{chapter_number:g}** من **{manga_title}**...",
            ephemeral=True,
        )

        try:
            site = scraper._detect_site(chapter_url)
            image_urls = await scraper.get_chapter_image_urls(chapter_url, site)

            if not image_urls:
                await interaction.followup.send("❌ لم يتم العثور على صور الفصل.", ephemeral=True)
                return

            result = await downloader.process_chapter(
                image_urls, manga_title, chapter_number, referer=chapter_url, stitch=stitch
            )

            drive_result = await asyncio.get_event_loop().run_in_executor(
                None,
                drive_upload.upload_chapter,
                result["zip"],
                result["stitched"] if stitch else None,
                manga_title,
                chapter_number,
                folder_id,
            )

            zip_url = drive_result.get("zip_url", "")
            stitched_url = drive_result.get("stitched_url", "")

            embed = discord.Embed(
                title=f"✅ تم التحميل — {manga_title} الفصل {chapter_number:g}",
                color=discord.Color.green(),
            )
            embed.add_field(name="عدد الصور", value=f"{result['count']}", inline=True)
            if zip_url:
                embed.add_field(name="📦 ZIP", value=f"[فتح]({zip_url})", inline=True)
            if stitched_url:
                embed.add_field(
                    name="🖼️ صورة مدمجة (14000px)", value=f"[فتح]({stitched_url})", inline=True
                )

            await interaction.followup.send(embed=embed, ephemeral=True)
            db.log_download(tracker_id, chapter_number, "done", zip_url or stitched_url)

        except Exception as e:
            print(f"[Download command] Error: {e}")
            await interaction.followup.send(f"❌ خطأ أثناء التحميل: {e}", ephemeral=True)

    # ─────────────────────────────────────────────────

    @tree.command(name="track_sites", description="عرض المواقع المدعومة")
    async def track_sites(interaction: discord.Interaction):
        embed = discord.Embed(
            title="🌐 المواقع المدعومة",
            color=discord.Color.purple(),
            description="البوت يدعم أي موقع مانهوا عام بالإضافة إلى التالي:",
        )
        value = "\n".join(
            f"• **{name}**" + (f" — {link}" if link != "*" else " — أي موقع عام")
            for name, link in SUPPORTED_SITES
        )
        embed.description = value
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # ─────────────────────────────────────────────────

    @tree.command(name="track_check", description="[أدمن] تحقق فوري من فصل جديد لعمل معين")
    @app_commands.describe(tracker_id="ID العمل (من track_list)")
    @is_admin()
    @app_commands.guild_only()
    async def track_check(interaction: discord.Interaction, tracker_id: int):
        rows = db.get_guild_trackers(interaction.guild_id)
        tracker = next((r for r in rows if r["id"] == tracker_id), None)

        if not tracker:
            await interaction.response.send_message("❌ ID غير موجود.", ephemeral=True)
            return

        await interaction.response.send_message(
            f"🔍 جاري الفحص الفوري لـ **{tracker['manga_title']}**...", ephemeral=True
        )

        latest = await scraper.fetch_latest_chapter(tracker["url"], float(tracker["last_chapter"]))
        if latest and latest > float(tracker["last_chapter"]):
            await interaction.followup.send(
                f"🚨 وُجد فصل جديد! **الفصل {latest:g}** (الحالي: {float(tracker['last_chapter']):g})",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(
                f"✅ لا يوجد فصل جديد. آخر فصل: **{float(tracker['last_chapter']):g}**",
                ephemeral=True,
            )


bot = ManhwaBot()

if __name__ == "__main__":
    if not TOKEN:
        raise ValueError("DISCORD_BOT_TOKEN is not set!")
    bot.run(TOKEN)
