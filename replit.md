# Workspace — Team X Scanlation Management System

## Overview

pnpm workspace monorepo using TypeScript. Contains a full Discord bot for managing a manhwa scanlation team (Team X), with automated RAW tracking, Google Drive uploads, salary management, and chapter workflows.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Discord**: discord.js v14
- **Scraping**: Cheerio + Axios + Puppeteer
- **Storage**: Google Drive API (googleapis)

## Structure

```text
artifacts/
├── api-server/         # Express API server
├── discord-bot/        # Discord bot (Team X manager)
│   └── src/
│       ├── commands/   # /project /chapter /member /profile /salary /stats
│       ├── scrapers/   # Asura, NewToki, Nirvana, Vortex, Flame, Reaper, Luminous, MangaDex, Generic
│       ├── services/   # Google Drive, Salary, Dashboard
│       ├── buttons/    # Claim button handler
│       ├── events/     # RAW tracker (cron every 5 min)
│       ├── database/   # PostgreSQL schema & init
│       └── utils/      # Config, payment list
lib/
├── api-spec/           # OpenAPI spec + Orval codegen config
├── api-client-react/   # Generated React Query hooks
├── api-zod/            # Generated Zod schemas from OpenAPI
└── db/                 # Drizzle ORM schema + DB connection
```

## Discord Bot Features

### Slash Commands
- `/project create/remove/info/list/setsource` — Admin project management
- `/chapter open/start/finish/status/download` — Chapter workflow
- `/member add/remove/setrate/list` — Team member management
- `/profile [user]` — View member stats & earnings
- `/salary view/report/markpaid/paymentlist` — Salary management
- `/stats` — Team & monthly statistics

### Automation
- RAW chapter tracker checks all sources every 5 minutes
- Auto-downloads free chapters → zips → uploads to Google Drive
- Sends Discord notifications when new RAW is detected
- Claim timeout system (12 hours, then auto-release)
- Dashboard auto-updates in project channels

### Supported RAW Sources
Asura Scans, NewToki, Nirvana Scans, Vortex Scans, Flame Scans, Reaper Scans, Luminous Scans, MangaDex, and any generic manhwa site

## Required Secrets
- `DISCORD_BOT_TOKEN` — Bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` — Application ID
- `GOOGLE_DRIVE_FOLDER_ID` — Root folder ID for RAW uploads
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Google service account credentials JSON
- `DATABASE_URL` — Auto-provided by Replit

## Database Tables
- `members` — Team member profiles, roles, rates
- `projects` — Manhwa projects with source tracking
- `chapters` — Chapter status, claims, drive links
- `salary_records` — Monthly earnings per member/chapter
- `tracked_sources` — URLs to monitor per project
- `logs` — Event audit log

## Payment List
Pre-loaded with ~100 manhwa titles and their rates from the team's payment sheet.
