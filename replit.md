# Workspace — Team X Scanlation Management System

## Overview

pnpm workspace monorepo (TypeScript) + Python Discord bot for manhwa RAW tracking.
The active Discord bot is the **Python Manhwa RAW Tracker** (`artifacts/manhwa-tracker/`).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (Node.js bot) / SQLite (Python bot)
- **Discord (Python)**: discord.py v2
- **Scraping**: cloudscraper (Cloudflare bypass) + BeautifulSoup4 + lxml
- **Storage**: Google Drive API (google-api-python-client)
- **Image stitching**: Pillow (14000px wide output)

## Structure

```text
artifacts/
├── api-server/           # Express API server
├── discord-bot/          # TypeScript Discord bot (team management — inactive)
├── manhwa-tracker/       # Python Discord bot (ACTIVE — RAW tracking)
│   ├── main.py           # Bot entry point + all slash commands
│   ├── scraper.py        # Multi-site scraper with Cloudflare bypass
│   ├── downloader.py     # Chapter image downloader + SmartStitch-style stitcher
│   ├── drive_upload.py   # Google Drive uploader
│   ├── database.py       # SQLite DB for trackers + download logs
│   └── requirements.txt  # Python dependencies
lib/
├── api-spec/             # OpenAPI spec + Orval codegen
├── api-client-react/     # Generated React Query hooks
├── api-zod/              # Generated Zod schemas
└── db/                   # Drizzle ORM schema
```

## Python Bot — Active Features

### Slash Commands
| Command | Description |
|---|---|
| `/track_add` | Add a manhwa to the radar (Cloudflare bypass, auto-detect site) |
| `/track_list` | List all tracked works in this server |
| `/track_remove` | Remove a work by ID |
| `/track_download` | Manually download a chapter → stitch → upload to Drive |
| `/track_check` | Immediately check for a new chapter (no waiting) |
| `/track_sites` | Show all supported sites |

### Automation
- **Radar loop**: checks tracked works every 30 minutes
- **Cloudflare bypass**: cloudscraper with Chrome browser emulation
- **Auto-download**: downloads images, stitches to 14000×N JPEG, zips, uploads to Google Drive
- **Discord notifications**: embed with chapter number + Drive links

### Supported Sites (19+)
Asura Scans, NewToki, Nirvana Scans, Vortex Scans, Flame Scans, Reaper Scans,
Luminous Scans, MangaDex (official API), Bato.to, Manganelo, Mangakakalot,
Webtoon, Toonily, Isekai Scan, Manhua Plus, Kun Manga, Hiperdex, Manga Buddy,
Nitro Scans, and any generic site via universal regex extractor.

## Required Secrets
- `DISCORD_BOT_TOKEN` — Bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` — Application ID
- `GOOGLE_DRIVE_FOLDER_ID` — Root folder for RAW uploads
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Google service account credentials JSON
- `DATABASE_URL` — Auto-provided by Replit (PostgreSQL for Node.js bot)

## Python Packages (installed via uv)
discord.py, cloudscraper, beautifulsoup4, lxml, requests, Pillow,
google-auth, google-api-python-client, aiohttp, certifi
Venv: `/home/runner/workspace/.venv`

## Workflows
- **Manhwa RAW Tracker** (RUNNING): `cd artifacts/manhwa-tracker && /home/runner/workspace/.venv/bin/python main.py`
- **Discord Bot** (disabled): TypeScript team management bot (same token, can't run simultaneously)
- **API Server** (running): Express API
