import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";
import { verifyUserToken } from "./jwt";

export type AuthedRequest = Request & { userId?: string };

/** Header "Authorization: Bearer <jwt>" check karta hai, req.userId set karta hai. */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "login_required" });
  let userId: string;
  try {
    userId = await verifyUserToken(token);
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
  // Tokens live a year; a deleted account's token must stop working instead of failing later on a foreign key.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) return res.status(401).json({ error: "user_not_found" });
  req.userId = userId;
  next();
}
