const SECRET_KEY = Deno.env.get("JWT_SECRET") ||
  "dev-secret-key-change-in-production";
export const TOKEN_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface TokenPayload {
  sub: number;
  jti?: string;
  iat: number;
  exp: number;
}

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateToken(
  userId: number,
  jti?: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: userId,
    ...(jti ? { jti } : {}),
    iat,
    exp: iat + Math.floor(TOKEN_EXPIRY_MS / 1000),
  };
  const payloadStr = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await signHMAC(payloadStr);
  return `${payloadStr}.${signature}`;
}

async function signHMAC(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64urlEncode(new Uint8Array(signature));
}

async function verifyHMAC(
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signature).buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;

  const valid = await verifyHMAC(payloadStr, signature);
  if (!valid) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadStr)),
    );
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
