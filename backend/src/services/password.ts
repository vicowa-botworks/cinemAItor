const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 minimum for SHA-256

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
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );

  const hash = base64urlEncode(new Uint8Array(derivedBits));
  return `${saltStr}:${hash}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltStr, hashStr] = stored.split(":");
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
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );

  const derivedBytes = new Uint8Array(derivedBits);

  // Decode the stored base64url hash back to bytes for constant-time comparison
  const storedBytes = base64urlDecodeToBytes(hashStr);

  // Constant-time comparison to prevent timing attacks
  if (derivedBytes.length !== storedBytes.length) return false;
  return constantTimeEqual(derivedBytes, storedBytes);
}

/**
 * Constant-time byte comparison to prevent timing attacks.
 * XORs all bytes without short-circuiting, so timing is uniform.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Decode a base64url-encoded string back to its original bytes.
 */
function base64urlDecodeToBytes(input: string): Uint8Array {
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

export { hashPassword, verifyPassword };
