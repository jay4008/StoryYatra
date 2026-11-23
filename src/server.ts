import cors from "cors";
import express from "express";
import "express-async-errors"; // routes that reject reach the error handler instead of crashing the process
import { env } from "./env";
import { prisma } from "./lib/db";
import { authRouter } from "./routes/auth";
import { storiesRouter } from "./routes/stories";

const app = express();
app.set("trust proxy", 1); // nginx/Cloudflare ke peeche asli IP (rate limit ke liye)
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }));

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use(authRouter);
app.use(storiesRouter);

app.use((_req, res) => res.status(404).json({ error: "not_found" }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

app.listen(env.PORT, env.HOST, () => console.log(`storyyatra-api on ${env.HOST}:${env.PORT}`));
