import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import { Resend } from "resend";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database("gold-alerts.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purity TEXT NOT NULL,
    target_bhd REAL NOT NULL,
    email TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    triggered_at TEXT,
    created_at TEXT NOT NULL
  );
`);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const GOLD_API_URL =
  process.env.GOLD_API_URL ||
  "https://xaus.com/api/v1/spot?currency=USD&unit=gram";

const BHD_PER_USD = 0.376;
const purityFactor = { "24K": 1, "22K": 22/24, "21K": 21/24, "18K": 18/24 };

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function getGold24kUsdPerGram() {
  const r = await fetch(GOLD_API_URL, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Gold API returned ${r.status}`);
  const data = await r.json();

  // Supports xaus.com response shape and a few common response shapes.
  const price =
    data?.xau?.price ??
    data?.price ??
    data?.gold?.price ??
    data?.data?.price;

  if (typeof price !== "number") throw new Error("Could not find gold price in API response.");
  return price;
}

async function getPrices() {
  const usd24 = await getGold24kUsdPerGram();
  const bhd24 = usd24 * BHD_PER_USD;
  const prices = {};
  for (const [purity, factor] of Object.entries(purityFactor)) {
    prices[purity] = bhd24 * factor;
  }
  return { prices, updatedAt: new Date().toISOString() };
}

app.get("/api/gold", async (_req, res) => {
  try {
    res.json(await getPrices());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/alerts", (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) return res.json([]);
  const rows = db.prepare(`
    SELECT id, purity, target_bhd, email, active, triggered_at, created_at
    FROM alerts WHERE email = ? ORDER BY id DESC
  `).all(email);
  res.json(rows);
});

app.post("/api/alerts", (req, res) => {
  const { purity, target_bhd, email } = req.body;
  const target = Number(target_bhd);

  if (!purityFactor[purity]) return res.status(400).json({ error: "Invalid gold purity." });
  if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: "Invalid target price." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const result = db.prepare(`
    INSERT INTO alerts (purity, target_bhd, email, created_at)
    VALUES (?, ?, ?, ?)
  `).run(purity, target, email, new Date().toISOString());

  res.json({ id: result.lastInsertRowid });
});

app.delete("/api/alerts/:id", (req, res) => {
  const result = db.prepare("DELETE FROM alerts WHERE id = ?").run(Number(req.params.id));
  res.json({ deleted: result.changes > 0 });
});

app.post("/api/alerts/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE alerts SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?").run(id);
  res.json({ ok: true });
});

async function checkAlerts() {
  try {
    const { prices } = await getPrices();
    const alerts = db.prepare("SELECT * FROM alerts WHERE active = 1 AND triggered_at IS NULL").all();

    for (const alert of alerts) {
      const current = prices[alert.purity];
      if (current <= alert.target_bhd) {
        if (resend && process.env.EMAIL_FROM) {
          await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: [alert.email],
            subject: `🟢 Gold reached your target: ${alert.purity}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
                <h2>Gold Price Alert</h2>
                <p>Your target price has been reached.</p>
                <p><b>Gold:</b> ${alert.purity}</p>
                <p><b>Current price:</b> ${current.toFixed(3)} BHD / gram</p>
                <p><b>Your target:</b> ${Number(alert.target_bhd).toFixed(3)} BHD / gram</p>
                <p style="color:#b07b00">This is an automated price notification, not financial advice.</p>
              </div>`
          });
          db.prepare("UPDATE alerts SET triggered_at = ? WHERE id = ?")
            .run(new Date().toISOString(), alert.id);
        }
      }
    }
  } catch (e) {
    console.error("Alert check failed:", e.message);
  }
}

const interval = Number(process.env.CHECK_INTERVAL_MS || 300000);
setInterval(checkAlerts, interval);
checkAlerts();

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname,"index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Gold Alert running at http://localhost:${port}`));
