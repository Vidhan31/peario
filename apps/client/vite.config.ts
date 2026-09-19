import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    plugins: [
      react({ compiler: true }),
      tailwindcss(),
      isDev ? mkcert({ savePath: "../../.certs" }) : undefined,
    ].filter(Boolean),
    build: {
      outDir: "dist",
      sourcemap: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                test: /node_modules\/react/,
                name: "react-vendor",
              },
              {
                test: /node_modules\/socket\.io-client/,
                name: "socket-vendor",
              },
            ],
          },
        },
      },
    },
    ...(isDev
      ? {
          server: {
            port: 5137,
            host: "127.0.0.1",
            proxy: {
              "/socket.io": {
                target: "https://127.0.0.1:8080",
                ws: true,
                secure: false,
              },
              "/api": {
                target: "https://127.0.0.1:8080",
                secure: false,
              },
            },
          },
        }
      : {}),
  };
});
