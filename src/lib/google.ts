import { OAuth2Client } from "google-auth-library";
import { env } from "../env";

const client = new OAuth2Client();

export type GoogleProfile = { googleId: string; email: string; name?: string; photoUrl?: string };

/** App se aaya Google ID token verify karta hai. Galat ya expire token pe error phenkta hai. */
export async function verifyGoogleToken(idToken: string): Promise<GoogleProfile> {
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_IDS });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("token mein sub/email nahi");
  if (!p.email_verified) throw new Error("email verified nahi");
  return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name, photoUrl: p.picture };
}
