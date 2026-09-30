// Supabase Edge Function "send-push".
//
// EINRICHTUNG (im Supabase-Dashboard, kein Terminal nötig):
// 1. Dashboard -> Edge Functions -> "Deploy a new function" -> Name: send-push
// 2. Den kompletten Inhalt dieser Datei in den Editor einfügen, speichern/deployen.
// 3. Dashboard -> Edge Functions -> send-push -> Secrets (oder Project Settings
//    -> Edge Functions -> Secrets) und folgende Secrets anlegen:
//      VAPID_PUBLIC_KEY   = BCECIKIptHj5TyB37TeiNMp5zx7EeUQ9tTorWUAYGLPme5dpGfo_reDSMeP5avpddRTiGlpp3Qlrm9XMwfKo1Is
//      VAPID_PRIVATE_KEY  = WOkmDZcDc8ggdKzdYXMS58_DisbSUlhVn8yXKp0bY08
//      VAPID_SUBJECT      = mailto:info@qamarnetwork.ch   (deine echte Kontakt-Adresse)
//      PUSH_TRIGGER_SECRET = 0D8dZGAM_zMDopfy35jQDVwH68N0uDDI
//    (Diese Werte müssen exakt zu den Werten in 21_push_notifications.sql und
//    in index.html passen — sie gehören zusammen.)
// 4. Unter "Enforce JWT Verification" für diese Funktion AUSSCHALTEN
//    (die Funktion wird nur von der Datenbank selbst aufgerufen, per
//    pg_net-Trigger, und prüft stattdessen ihr eigenes Secret unten).
//
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY werden von Supabase automatisch
// als Umgebungsvariablen bereitgestellt, die musst du nicht selbst setzen.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;
const PUSH_TRIGGER_SECRET = Deno.env.get("PUSH_TRIGGER_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-trigger-secret") !== PUSH_TRIGGER_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { recipient_id, sender_id, body } = await req.json();
    if (!recipient_id || !sender_id || !body) {
      return new Response("Bad request", { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: sender } = await supabase
      .from("profiles")
      .select("first_name,last_name")
      .eq("id", sender_id)
      .maybeSingle();

    const title = sender
      ? `${sender.first_name ?? ""} ${sender.last_name ?? ""}`.trim() || "Neue Nachricht"
      : "Neue Nachricht";

    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", recipient_id);

    if (subsErr || !subs || subs.length === 0) {
      return new Response("No subscriptions", { status: 200 });
    }

    const payload = JSON.stringify({
      title,
      body: String(body).slice(0, 140),
      openchat: sender_id,
    });

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
        } catch (err) {
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            // Subscription ist abgelaufen (Browser abgemeldet/App deinstalliert) -> aufräumen.
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }),
    );

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("Error", { status: 500 });
  }
});
