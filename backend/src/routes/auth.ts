import { Router } from "@oak/oak/router";
import { type AuthedContext, authMiddleware, generateToken } from "@cinemaItor/middleware/auth.ts";
import { createUser, getUserByEmail, getUserById } from "@cinemaItor/db/schema.ts";

const router = new Router()
  .post("/api/auth/register", async (ctx, _next) => {
    const body = ctx.request.body;
    if (body.type() !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const { email, password, display_name } = await body.json();

    if (!email || !password || !display_name) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "Email, password, and display_name are required",
      };
      return;
    }

    if (password.length < 8) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Password must be at least 8 characters" };
      return;
    }

    const existingUser = getUserByEmail(email);
    if (existingUser) {
      ctx.response.status = 409;
      ctx.response.body = { error: "Email already registered" };
      return;
    }

    const passwordHash = await hashPassword(password);
    const userId = createUser(email, passwordHash, display_name);
    const token = await generateToken(userId);

    ctx.response.status = 201;
    ctx.response.body = {
      token,
      user: { id: userId, email, display_name },
    };
  })
  .post("/api/auth/login", async (ctx, _next) => {
    const body = ctx.request.body;
    if (body.type() !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const { email, password } = await body.json();

    if (!email || !password) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Email and password are required" };
      return;
    }

    const user = getUserByEmail(email);
    if (!user) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid credentials" };
      return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid credentials" };
      return;
    }

    const token = await generateToken(user.id);

    ctx.response.body = {
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      },
    };
  })
  .get("/api/auth/me", authMiddleware, (ctx, _next) => {
    const userId = (ctx as unknown as AuthedContext).userId;
    const user = userId ? getUserById(userId) : null;

    if (!user) {
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found" };
      return;
    }

    ctx.response.body = {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
    };
  });

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltStr = base64urlEncode(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );

  const hash = base64urlEncode(new Uint8Array(derivedBits));
  return `${saltStr}:${hash}`;
}

async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [saltStr, hashStr] = hash.split(":");
  if (!saltStr || !hashStr) return false;

  const salt = base64urlDecode(saltStr);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );

  const derivedHash = base64urlEncode(new Uint8Array(derivedBits));
  return derivedHash === hashStr;
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

export { router };
