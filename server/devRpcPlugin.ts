/**
 * Dev-only bridge from the browser to the local Postgres cluster.
 *
 * This exists so the app can run end-to-end with no Supabase project, while
 * still exercising the REAL spin_campaign() function rather than a mock. It is
 * a Vite `serve`-only plugin, so nothing here reaches the production bundle.
 *
 * Two details are load-bearing:
 *
 *   1. It connects as `wheel_anon`, a plain login role, and issues
 *      `SET LOCAL ROLE anon` per transaction -- exactly what PostgREST does on
 *      Supabase. Connecting as a superuser would silently bypass RLS and make
 *      every local security check meaningless.
 *   2. Function names come from a fixed allowlist and are never interpolated
 *      from the request path.
 */
import type { Plugin } from 'vite';
import { Pool } from 'pg';

const ALLOWED = {
  resolve_campaign: ['passcode'],
  campaign_stage_info: ['campaign_id', 'passcode'],
  recent_winners: ['campaign_id', 'passcode', 'limit'],
  spin_campaign: ['campaign_id', 'passcode', 'prize_id', 'is_test', 'actor_label'],
  reveal_winner: ['spin_id', 'passcode'],
} as const;

type Fn = keyof typeof ALLOWED;

const SQL: Record<Fn, string> = {
  resolve_campaign: 'select resolve_campaign($1) as r',
  campaign_stage_info: 'select campaign_stage_info($1,$2) as r',
  recent_winners: 'select recent_winners($1,$2,$3) as r',
  spin_campaign: 'select spin_campaign($1,$2,$3,$4,$5) as r',
  reveal_winner: 'select reveal_winner($1,$2) as r',
};

export function devRpcPlugin(connectionString: string): Plugin {
  let pool: Pool | undefined;

  return {
    name: 'winner-wheel-dev-rpc',
    apply: 'serve',
    configureServer(server) {
      pool = new Pool({ connectionString, max: 8 });

      server.middlewares.use('/api/rpc', async (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        if (req.method !== 'POST') return send(405, { error: 'METHOD_NOT_ALLOWED' });

        const fn = (req.url ?? '').replace(/^\/+/, '').split('?')[0] as Fn;
        if (!Object.prototype.hasOwnProperty.call(ALLOWED, fn)) {
          return send(404, { error: 'UNKNOWN_FUNCTION' });
        }

        let body: Record<string, unknown> = {};
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'BAD_JSON' });
        }

        const params = ALLOWED[fn].map((k) => (body[k] === undefined ? null : body[k]));
        const client = await pool!.connect();
        try {
          await client.query('begin');
          await client.query('set local role anon');
          const out = await client.query(SQL[fn], params);
          await client.query('commit');
          send(200, out.rows[0].r);
        } catch (e) {
          await client.query('rollback').catch(() => {});
          // Postgres RAISE messages are our typed error codes (UNAUTHORIZED,
          // NO_PRIZES_REMAINING, ...). Pass the first line through so the UI
          // can map it to a friendly string.
          const msg = String((e as Error).message ?? 'ERROR').split('\n')[0];
          send(400, { error: msg });
        } finally {
          client.release();
        }
      });

      server.httpServer?.on('close', () => void pool?.end());
    },
  };
}
