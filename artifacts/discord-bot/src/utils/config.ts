export const CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || "",
  GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID!,
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
  DATABASE_URL: process.env.DATABASE_URL!,

  CHAPTER_CLAIM_TIMEOUT_HOURS: 12,
  SCRAPE_INTERVAL_MINUTES: 5,

  AVAILABLE_CHAPTERS_CHANNEL: "available-chapters",
  LOG_CHANNEL: "chapter-log",

  SOURCES: {
    ASURA: "https://asuracomic.net",
    NEWTOKI: "https://newtoki000.com",
    NIRVANA: "https://nirvanascans.com",
    VORTEX: "https://vortexscans.org",
    FLAME: "https://flamescans.org",
    REAPERSCANS: "https://reaperscans.com",
    LUMINOUS: "https://luminousscans.com",
    ALPHA: "https://alphascans.org",
    REALM: "https://realmscans.xyz",
    MANHWAFREAK: "https://manhwafreak.com",
    MANHUAPLUS: "https://manhuaplus.com",
    BATO: "https://bato.to",
    MANGADEX: "https://mangadex.org",
    WEBTOON: "https://www.webtoons.com",
    KAKAO: "https://page.kakao.com",
    NAVER: "https://comic.naver.com",
  },
};
