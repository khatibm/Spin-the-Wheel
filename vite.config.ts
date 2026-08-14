import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { devRpcPlugin } from './server/devRpcPlugin.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // With no Supabase project configured, the app talks to the local Postgres
  // cluster through the dev RPC bridge -- same SQL function either way.
  const localDb =
    env.DEV_RPC_DATABASE_URL ??
    'postgres://wheel_anon:wheel_anon@127.0.0.1:5432/winner_wheel';

  return {
    plugins: [react(), tailwindcss(), devRpcPlugin(localDb)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { host: '127.0.0.1', port: 5173 },
  };
});
