import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ status: "invalid" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ status: "forbidden" }, 401);

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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError?.status === 429) return reply({ status: "rate_limited" }, 429);
    if (userError?.status === 402) return reply({ status: "quota" }, 402);
    if (userError?.status && userError.status >= 500) return reply({ status: "retry" }, 503);
    if (!user) return reply({ status: "forbidden" }, 401);

    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    const params = {
      p_actor: user.id, p_section: section, p_name: name, p_attempt: attempt,
      p_hash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
    const { data: row, error } = await supabase.rpc("section_roster_import_row", params);
    if (error?.code === "PGRST202" || error?.code === "42883") return reply({ status: "setup" }, 503);
    if (error || !row) return reply({ status: "retry" }, 503);
    if (row.status !== "reserved") return reply(row);

    if (!row.hasAccount) {
      // A network error can arrive after Auth commits. Finalization checks
      // the reservation marker, so a concurrent request or retry is safe.
      const { error: createError } = await supabase.auth.admin.createUser({
        email: row.login, password, email_confirm: true,
        app_metadata: { graderaid_roster_id: row.reservation },
      });
      if (createError?.status === 429) return reply({ status: "rate_limited" }, 429);
      if (createError?.status === 402) return reply({ status: "quota" }, 402);
    }

    const { data, error: finishError } = await supabase.rpc("section_roster_import_row", {
      ...params, p_finish: true,
    });
    return finishError || !data ? reply({ status: "retry" }, 503) : reply(data);
  } catch {
    return reply({ status: "retry" }, 503);
  }
});
