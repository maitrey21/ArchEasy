import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Vercel serves everything in /api as serverless functions in production.
 * The plain Vite dev server does not, so this plugin mounts the same handler
 * as dev middleware. That keeps `npm run dev` working without `vercel dev`,
 * and — importantly — the API key stays in the Node process, never in the
 * browser bundle, in dev exactly like in production.
 */
function apiDevServer(): Plugin {
  return {
    name: "api-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        // Resolve /api/<name> to api/<name>.ts. Reject anything with path
        // traversal or nested segments so dev can't be tricked into loading
        // arbitrary files off disk.
        const route = url.split("?")[0].replace(/^\/api\//, "").replace(/\/$/, "");
        if (!/^[a-z0-9-]+$/i.test(route)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Unknown API route" }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf-8");

          // Adapt Node's req/res to the Vercel handler signature.
          const vercelReq = Object.assign(req, {
            body: raw ? JSON.parse(raw) : undefined,
          });

          const vercelRes = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return vercelRes;
            },
            json(payload: unknown) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(payload));
              return vercelRes;
            },
          });

          const mod = await server.ssrLoadModule(`/api/${route}.ts`);
          await mod.default(vercelReq, vercelRes);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Dev API error";
          const notFound = /Failed to load url|Cannot find module|ENOENT/i.test(message);
          res.statusCode = notFound ? 404 : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: notFound ? "Unknown API route" : message }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load ALL env vars (empty prefix), not just VITE_ ones, so the dev
  // middleware can read OPENROUTER_API_KEY from .env the same way Vercel
  // reads it from project settings. These stay server-side only.
  const env = loadEnv(mode, process.cwd(), "");
  process.env = { ...process.env, ...env };

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      apiDevServer(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
