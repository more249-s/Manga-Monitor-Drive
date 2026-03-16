import { pool } from "../database/schema.js";

export async function recordSalary(
  discordId: string,
  projectId: number,
  chapterId: number,
  role: string,
  amount: number
): Promise<void> {
  const now = new Date();
  await pool.query(
    `INSERT INTO salary_records (discord_id, project_id, chapter_id, amount, role, month, year)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [discordId, projectId, chapterId, amount, role, now.getMonth() + 1, now.getFullYear()]
  );
}

export async function getMonthlySalary(
  discordId: string,
  month?: number,
  year?: number
): Promise<{ projectName: string; chapters: number; amount: number }[]> {
  const now = new Date();
  const m = month || now.getMonth() + 1;
  const y = year || now.getFullYear();

  const { rows } = await pool.query(
    `SELECT p.name as project_name, COUNT(*) as chapters, SUM(sr.amount) as amount
     FROM salary_records sr
     JOIN projects p ON sr.project_id = p.id
     WHERE sr.discord_id = $1 AND sr.month = $2 AND sr.year = $3
     GROUP BY p.name`,
    [discordId, m, y]
  );

  return rows.map((r) => ({
    projectName: r.project_name,
    chapters: parseInt(r.chapters),
    amount: parseFloat(r.amount),
  }));
}

export async function getTotalSalary(discordId: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) as total FROM salary_records WHERE discord_id = $1",
    [discordId]
  );
  return parseFloat(rows[0]?.total || "0");
}

export async function getTeamSalaryReport(
  month?: number,
  year?: number
): Promise<{ discordId: string; username: string; total: number; paid: boolean }[]> {
  const now = new Date();
  const m = month || now.getMonth() + 1;
  const y = year || now.getFullYear();

  const { rows } = await pool.query(
    `SELECT sr.discord_id, m.username, SUM(sr.amount) as total,
            BOOL_AND(sr.paid) as paid
     FROM salary_records sr
     JOIN members m ON sr.discord_id = m.discord_id
     WHERE sr.month = $1 AND sr.year = $2
     GROUP BY sr.discord_id, m.username
     ORDER BY total DESC`,
    [m, y]
  );

  return rows.map((r) => ({
    discordId: r.discord_id,
    username: r.username,
    total: parseFloat(r.total),
    paid: r.paid,
  }));
}

export async function markAsPaid(discordId: string, month: number, year: number): Promise<void> {
  await pool.query(
    "UPDATE salary_records SET paid = true, paid_at = NOW() WHERE discord_id = $1 AND month = $2 AND year = $3",
    [discordId, month, year]
  );
}
