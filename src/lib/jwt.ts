import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

const key = new TextEncoder().encode(env.JWT_SECRET);

export function signUserToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_EXPIRES_DAYS}d`)
    .sign(key);
}

export async function verifyUserToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  if (!payload.sub) throw new Error("sub nahi");
  return payload.sub;
}
