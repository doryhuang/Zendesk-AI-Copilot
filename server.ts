import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/config", (req, res) => {
    res.json({
      subdomain: process.env.ZENDESK_SUBDOMAIN || "",
    });
  });

  // API Proxy for Zendesk
  app.get("/api/zendesk/tickets", async (req, res) => {
    const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN } = process.env;
    
    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(400).json({ error: "Zendesk configuration missing" });
    }

    const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    
    try {
      // 恢復為讀取所有工單以確保連線穩定
      const response = await fetch(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json?sort_by=updated_at&sort_order=desc`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Zendesk API Error [${response.status}]:`, errorText);
        return res.status(response.status).json({ 
          error: "Zendesk API returned an error", 
          details: errorText,
          status: response.status 
        });
      }

      const data = await response.json();
      res.json({ tickets: data.tickets || [] });
    } catch (error) {
      console.error("Fetch Error:", error);
      res.status(500).json({ error: "Failed to connect to Zendesk", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/zendesk/tickets/:id/single", async (req, res) => {
    const { id } = req.params;
    const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN } = process.env;
    
    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(400).json({ error: "Zendesk configuration missing" });
    }

    const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    
    try {
      const response = await fetch(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}.json`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Zendesk API error: ${response.statusText}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch ticket" });
    }
  });

  app.get("/api/zendesk/tickets/:id", async (req, res) => {
    const { id } = req.params;
    const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN } = process.env;
    
    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(400).json({ error: "Zendesk configuration missing" });
    }

    const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    
    try {
      // Fetch ticket comments to get the full conversation
      const response = await fetch(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${id}/comments.json`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Zendesk API error: ${response.statusText}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch ticket comments" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
