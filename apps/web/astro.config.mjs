import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Output 'server' (not 'static') so the future admin UI can add dynamic routes
// without rewiring the output mode. v1 has no dynamic data, but every request
// returns the same HTML from a Node process running on Heroku.
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  server: {
    host: true,
    port: Number(process.env.PORT) || 4321,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
