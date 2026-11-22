const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { transformSync } = require('esbuild');

const source = fs.readFileSync('supabase/functions/import-section-roster/index.ts', 'utf8');
const script = transformSync(source.replace(/^import .*;\n/, ''), { loader: 'ts' }).code;
const run = async ({ reservationError, createError, finish, finishError, missingConfig = false } = {}) => {
  let handler;
  const logs = [], calls = [];
  const fake = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'teacher' } } }),
      admin: { createUser: async () => { calls.push('auth-create'); return { error: createError }; } },
    },
    rpc: async (_name, args) => {
      calls.push(args.p_finish ? 'link-profile' : 'reserve-row');
      assert.match(args.p_hash, /^[0-9a-f]{64}$/);
      if (!args.p_finish) return { data: { status: 'reserved', login: 'test', reservation: 'fixture' }, error: reservationError };
      return { data: finish ?? { status: 'retry' }, error: finishError };
    },
  };
  vm.runInNewContext(script, {
    Deno: { serve: fn => { handler = fn; }, env: { get: () => missingConfig ? undefined : 'configured' } },
    createClient: () => fake, TextEncoder, Response, crypto: webcrypto,
    console: { warn: value => logs.push(JSON.parse(value)) },
  });
  const preflight = await handler(new Request('http://localhost/import-section-roster', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://eduquest-gamified.vercel.app',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info,x-region',
    },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  for (const name of ['authorization', 'apikey', 'content-type', 'x-client-info', 'x-region']) {
    assert.ok(preflight.headers.get('access-control-allow-headers').split(',').map(value => value.trim()).includes(name));
  }
  assert.deepEqual(calls, [], 'Preflight reaches neither Auth nor the database');
  const unsigned = await handler(new Request('http://localhost/import-section-roster', { method: 'POST' }));
  assert.equal(unsigned.status, 401, 'Disabling gateway verification does not permit unsigned account creation');
  const password = 'Aa7!ABCDEFGHJKLMNPQR';
  const response = await handler(new Request('http://localhost/import-section-roster', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture' },
    body: JSON.stringify({ name: 'Example Student', section: 'room', password, attempt: webcrypto.randomUUID() }),
  }));
  return { body: await response.json(), status: response.status, logs, calls };
};

(async () => {
  let result = await run({ missingConfig: true });
  assert.equal(result.body.status, 'server_config');
  assert.deepEqual(result.calls, []);

  result = await run({ reservationError: { code: 'PGRST202' } });
  assert.equal(result.body.status, 'migration_missing');
  assert.deepEqual(result.calls, ['reserve-row']);

  const createError = { code: 'email_address_invalid', status: 422, message: 'Sensitive student information' };
  result = await run({ createError });
  assert.equal(result.body.status, 'auth_create_failed');
  assert.equal(result.logs[0].requestId, result.body.requestId);
  assert.equal(result.logs[0].providerCode, createError.code);
  assert.doesNotMatch(JSON.stringify(result.logs), /Example Student|Sensitive student information|Aa7!/);

  result = await run({ createError: { code: 'email_exists', status: 422 }, finish: { status: 'created', login: 'test' } });
  assert.equal(result.status, 200, 'A duplicate response after a commit must still reconcile');
  assert.deepEqual(result.calls, ['reserve-row', 'auth-create', 'link-profile']);

  result = await run({ finishError: { code: '23502' } });
  assert.equal(result.body.status, 'profile_failed');
  assert.equal(result.logs[0].stage, 'link_profile');
  assert.equal(result.logs[0].providerCode, '23502');

  result = await run({ createError: { code: 'over_request_rate_limit', status: 429 } });
  assert.equal(result.status, 429);
  assert.equal(result.body.status, 'rate_limited');
  console.log('PASS: roster Edge Function diagnoses configuration, migration, Auth and profile failures, preserves reconciliation, and correlates sanitized logs.');
})().catch(error => { console.error(error); process.exitCode = 1; });
