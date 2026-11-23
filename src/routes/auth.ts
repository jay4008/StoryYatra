import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db";
import { verifyGoogleToken } from "../lib/google";
import { verifyAppleToken } from "../lib/apple";
import { signUserToken } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../lib/requireAuth";

export const authRouter = Router();

// ek IP se 15 minute mein 30 login try
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

type Provider = "google" | "apple";
type Login = { provider: Provider; providerId: string; email: string | null; linkByEmail: boolean; name?: string | null; photoUrl?: string | null };

const publicUser = (u: { id: string; email: string | null; name: string | null; photoUrl: string | null }) => ({
  id: u.id, email: u.email, name: u.name, photoUrl: u.photoUrl,
});

/**
 * Ek hi user, chahe Google se aaye ya Apple se:
 * 1. provider ki id se dhoondo  2. nahi mila to verified email se dhoondo aur provider jod do  3. nahi to naya user.
 * Apple naam sirf pehli baar bhejta hai, isliye naam/photo khaali ho to purana naam nahi mitate.
 */
async function loginWith(l: Login) {
  try {
    return await findOrCreateUser(l);
  } catch (error) {
    // Do taps ek saath aaye to doosra unique error khata hai; tab tak user ban chuka hota hai.
    if ((error as { code?: string }).code === "P2002") return findOrCreateUser(l);
    throw error;
  }
}

async function findOrCreateUser(l: Login) {
  const idField = l.provider === "google" ? "googleId" : "appleId";
  let user = await prisma.user.findUnique({ where: { [idField]: l.providerId } as any });
  if (!user && l.email && l.linkByEmail) user = await prisma.user.findUnique({ where: { email: l.email } });

  const patch: Record<string, unknown> = { [idField]: l.providerId, lastLoginAt: new Date() };
  if (l.email && !user?.email) patch.email = l.email;
  if (l.name) patch.name = l.name;
  if (l.photoUrl) patch.photoUrl = l.photoUrl;

  if (user) return prisma.user.update({ where: { id: user.id }, data: patch });
  return prisma.user.create({ data: { ...patch, email: l.email, name: l.name ?? null, photoUrl: l.photoUrl ?? null } as any });
}

authRouter.post("/auth/google", loginLimit, async (req, res) => {
  const body = z.object({ idToken: z.string().min(20) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "idToken_required" });

  let g;
  try {
    g = await verifyGoogleToken(body.data.idToken);
  } catch {
    return res.status(401).json({ error: "invalid_google_token" });
  }

  const user = await loginWith({ provider: "google", providerId: g.googleId, email: g.email, linkByEmail: true, name: g.name, photoUrl: g.photoUrl });
  res.json({ token: await signUserToken(user.id), user: publicUser(user) });
});

authRouter.post("/auth/apple", loginLimit, async (req, res) => {
  const body = z.object({
    identityToken: z.string().min(20),
    // Apple poora naam sirf pehli login pe app ko deta hai; app wahi yahan bhejti hai
    fullName: z.string().max(100).optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "identityToken_required" });

  let a;
  try {
    a = await verifyAppleToken(body.data.identityToken);
  } catch {
    return res.status(401).json({ error: "invalid_apple_token" });
  }

  // "Hide my email" wala relay address kisi doosre (Google) account se link nahi karte
  const user = await loginWith({ provider: "apple", providerId: a.appleId, email: a.email, linkByEmail: a.emailVerified && !a.emailIsPrivate, name: body.data.fullName ?? null });
  res.json({ token: await signUserToken(user.id), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "user_not_found" });
  res.json({ user: { ...publicUser(user), providers: { google: !!user.googleId, apple: !!user.appleId } } });
});

authRouter.delete("/me", requireAuth, async (req: AuthedRequest, res) => {
  // Play Store + App Store ka account-delete niyam. (Apple token revoke: agla phase, README dekho)
  await prisma.user.delete({ where: { id: req.userId } }).catch(() => null);
  res.status(204).end();
});
