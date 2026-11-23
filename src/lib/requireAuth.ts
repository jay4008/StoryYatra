import type { NextFunction, Request, Response } from "express";
import { verifyUserToken } from "./jwt";

export type AuthedRequest = Request & { userId?: string };

/** Header "Authorization: Bearer <jwt>" check karta hai, req.userId set karta hai. */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "login_required" });
  try {
    req.userId = await verifyUserToken(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
