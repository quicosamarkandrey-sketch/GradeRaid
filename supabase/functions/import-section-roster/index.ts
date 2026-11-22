import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

function failure(
  requestId: string,
  stage: string,
  status: string,
  httpStatus: number,
  providerError?: { code?: string; status?: number } | null,
) {
  const code = providerError?.code;
  // Provider messages can contain student data or credentials. Log only
  // identifiers needed to match the invocation with its upstream failure.
  console.warn(JSON.stringify({
    event: "roster_import_failed", requestId, stage, status,
    ...(code && /^[a-z0-9_]{1,64}$/i.test(code) ? { providerCode: code } : {}),
    ...(providerError?.status ? { providerStatus: providerError.status } : {}),
  }));
  return reply({ status, requestId }, httpStatus);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ status: "invalid" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ status: "forbidden" }, 401);

  const requestId = crypto.randomUUID();
  let stage = "request";
  try {
    const content = await request.text();
    if (content.length > 2048) return reply({ status: "invalid" }, 413);
    let body;
    try { body = JSON.parse(content); }
    catch { return reply({ status: "invalid" }, 400); }
    if (!body || typeof body !== "object") return reply({ status: "invalid" }, 400);
    const { section, name, attempt, password } = body;
    if (typeof section !== "string" || !section || section.length > 200 ||
      typeof name !== "string" || name.length > 120 ||
      typeof attempt !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(attempt) ||
      typeof password !== "string" || !/^Aa7![A-HJ-NP-Z2-9]{16}$/.test(password)) {
      return reply({ status: "invalid" }, 400);
    }

    stage = "configuration";
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return failure(requestId, stage, "server_config", 503);
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    stage = "verify_session";
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError?.status === 429) return failure(requestId, stage, "rate_limited", 429, userError);
    if (userError?.status === 402) return failure(requestId, stage, "quota", 402, userError);
    if (userError && (!userError.status || userError.status >= 500)) {
      return failure(requestId, stage, "auth_unavailable", 503, userError);
    }
    if (!user) return reply({ status: "forbidden" }, 401);

    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const params = {
      p_actor: user.id, p_section: section, p_name: name, p_attempt: attempt,
      p_hash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
    stage = "reserve_row";
    const { data: row, error } = await supabase.rpc("section_roster_import_row", params);
    if (error?.code === "PGRST202" || error?.code === "42883") {
      return failure(requestId, stage, "migration_missing", 503, error);
    }
    if (error || !row) return failure(requestId, stage, "reservation_failed", 503, error);
    if (row.status !== "reserved") return reply(row);

    stage = "create_auth_user";
    const createError = row.hasAccount ? null : (await supabase.auth.admin.createUser({
      email: row.login, password, email_confirm: true,
      app_metadata: { graderaid_roster_id: row.reservation },
    })).error;

    // Always reconcile first. Auth can commit before returning an error, and
    // a concurrent retry can see an account created by the original request.
    stage = "link_profile";
    const { data, error: finishError } = await supabase.rpc("section_roster_import_row", {
      ...params, p_finish: true,
    });
    if (finishError || !data) return failure(requestId, stage, "profile_failed", 503, finishError);
    if (data.status !== "retry") return reply(data);

    if (createError?.status === 429) return failure(requestId, "create_auth_user", "rate_limited", 429, createError);
    if (createError?.status === 402) return failure(requestId, "create_auth_user", "quota", 402, createError);
    if (createError) return failure(requestId, "create_auth_user", "auth_create_failed", 503, createError);
    return failure(requestId, stage, "profile_failed", 503);
  } catch {
    return failure(requestId, stage, "retry", 503);
  }
});
