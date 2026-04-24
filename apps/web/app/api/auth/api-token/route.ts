import { auth } from "@/auth";
import { SignJWT } from "jose";

function getSecret() {
  const s = process.env.API_AUTH_SECRET;
  if (!s) throw new Error("API_AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await new SignJWT({
    sub: session.user.email,
    name: session.user.name || "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSecret());

  return Response.json({ token });
}
