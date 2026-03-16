import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      discord_id VARCHAR(32) UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      role VARCHAR(10) NOT NULL DEFAULT 'TR',
      chapter_rate DECIMAL(10,2) DEFAULT 0.50,
      payment_method VARCHAR(50),
      payment_info TEXT,
      total_chapters INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      source_site VARCHAR(100) NOT NULL,
      source_url TEXT,
      project_type VARCHAR(20) DEFAULT 'competitive',
      current_raw INTEGER DEFAULT 0,
      current_working INTEGER,
      translator_id VARCHAR(32),
      editor_id VARCHAR(32),
      channel_id VARCHAR(32),
      dashboard_message_id VARCHAR(32),
      status VARCHAR(20) DEFAULT 'active',
      chapter_payment DECIMAL(10,2) DEFAULT 6.00,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      chapter_number INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'available',
      claimed_by VARCHAR(32),
      role_needed VARCHAR(10) DEFAULT 'TL',
      claim_message_id VARCHAR(32),
      claim_channel_id VARCHAR(32),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      raw_url TEXT,
      drive_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS salary_records (
      id SERIAL PRIMARY KEY,
      discord_id VARCHAR(32) NOT NULL,
      project_id INTEGER REFERENCES projects(id),
      chapter_id INTEGER REFERENCES chapters(id),
      amount DECIMAL(10,2) NOT NULL,
      role VARCHAR(10) NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      paid BOOLEAN DEFAULT FALSE,
      paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tracked_sources (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      source_name VARCHAR(100) NOT NULL,
      source_url TEXT NOT NULL,
      last_chapter INTEGER DEFAULT 0,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      project_id INTEGER,
      chapter_id INTEGER,
      discord_id VARCHAR(32),
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("[DB] Tables initialized");
}
