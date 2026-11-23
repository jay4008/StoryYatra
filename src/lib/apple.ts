import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env";

// Apple ki public keys (jose khud cache karta hai)
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type AppleProfile = { appleId: string; email: string | null; emailIsPrivate: boolean; emailVerified: boolean };

/** App se aaya Apple identityToken verify karta hai. Galat ya expire token pe error phenkta hai. */
export async function verifyAppleToken(identityToken: string): Promise<AppleProfile> {
  const { payload } = await jwtVerify(identityToken, appleKeys, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_IDS,
  });
  if (!payload.sub) throw new Error("token mein sub nahi");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const priv = payload.is_private_email === true || payload.is_private_email === "true";
  const verified = payload.email_verified === true || payload.email_verified === "true";
  return { appleId: payload.sub, email, emailIsPrivate: priv, emailVerified: verified };
}
