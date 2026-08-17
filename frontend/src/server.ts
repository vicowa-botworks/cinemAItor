const PORT = Number(Deno.env.get("FRONTEND_PORT") || 8124);
const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:8123";

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/" || url.pathname === "") {
    const filePath = "./index.html";
    const file = await Deno.readFile(filePath);
    return new Response(file, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (url.pathname.startsWith("/src/")) {
    const filePath = `.${url.pathname}`;
    try {
      const file = await Deno.readFile(filePath);
      const ext = url.pathname.split(".").pop();
      const contentType = ext === "js" ? "application/javascript" : "text/css";
      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  // Proxy API requests to backend
  if (url.pathname.startsWith("/api/")) {
    const backendReq = new Request(`${BACKEND_URL}${url.pathname}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return fetch(backendReq);
  }

  return new Response("Not Found", { status: 404 });
});

console.log(`Frontend server running on http://localhost:${PORT}`);
