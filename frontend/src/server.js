const PORT = Number(Deno.env.get("FRONTEND_PORT") || 8124);
const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:8123";

const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  wasm: "application/wasm",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "") {
    const file = await Deno.readFile("./index.html");
    return new Response(file, {
      headers: { "Content-Type": MIME.html },
    });
  }

  if (pathname.startsWith("/src/")) {
    const filePath = `.${pathname}`;
    try {
      const source = await Deno.readFile(filePath);
      const ext = pathname.split(".").pop() ?? "";
      return new Response(source, {
        headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  // Proxy API requests to backend
  if (pathname.startsWith("/api/")) {
    const backendReq = new Request(`${BACKEND_URL}${pathname}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return fetch(backendReq);
  }

  return new Response("Not Found", { status: 404 });
});

console.log(`Frontend server running on http://localhost:${PORT}`);
