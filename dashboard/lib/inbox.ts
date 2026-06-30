// Reply-/bounce-tracking via IMAP. Leest ongelezen inkomende mail, herkent
// antwoorden van leads en bounces (mailer-daemon / delivery-failure), en
// werkt de lead-status + feedback + suppressielijst bij. Config-gestuurd:
// zonder IMAP-instellingen doet dit niets.

import { ImapFlow } from "imapflow";
import { getSettings } from "./settings";
import { findLeadByContactEmail, markLeadReplied, markLeadBounced, suppressEmail } from "./db";
import { addFeedback, postMessage } from "./agents/store";

const BOUNCE_FROM = ["mailer-daemon", "postmaster", "mail delivery", "microsoftexchange"];
const BOUNCE_SUBJECT = /undeliverable|delivery (status|failure|has failed)|returned mail|failure notice|nie (został|została) dostarczon|zwrot/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export async function pollInbox(): Promise<{ replies: number; bounces: number } | null> {
  const imap = getSettings().imap;
  if (!imap?.enabled || !imap.host || !imap.user || !imap.pass) return null;

  const client = new ImapFlow({
    host: imap.host, port: imap.port || 993, secure: true,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });

  let replies = 0, bounces = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return { replies, bounces };
      const recent = uids.slice(-100); // niet meer dan 100 per ronde

      for await (const msg of client.fetch(recent, { envelope: true, source: true }, { uid: true })) {
        const from = (msg.envelope?.from?.[0]?.address || "").toLowerCase();
        const subject = msg.envelope?.subject || "";
        const raw = msg.source ? msg.source.toString("utf-8").slice(0, 20000) : "";
        const isBounce = BOUNCE_FROM.some((b) => from.includes(b)) || BOUNCE_SUBJECT.test(subject);

        if (isBounce) {
          // Zoek het mislukte adres in de body en match op een gemailde lead.
          const candidates = Array.from(new Set((raw.match(EMAIL_RE) || []).map((e) => e.toLowerCase())));
          for (const addr of candidates) {
            const lead = findLeadByContactEmail(addr);
            if (lead) {
              markLeadBounced(lead.place_id);
              suppressEmail(addr, "bounce");
              addFeedback({ kind: "email_outcome", leadPlaceId: lead.place_id, metric: "bounced", value: { addr } });
              bounces++;
              break;
            }
          }
        } else if (from) {
          const lead = findLeadByContactEmail(from);
          if (lead) {
            markLeadReplied(lead.place_id);
            addFeedback({ kind: "email_outcome", leadPlaceId: lead.place_id, metric: "replied", value: { category: lead.category_query } });
            replies++;
          }
        }
        // Markeer als gelezen zodat we 'm niet opnieuw verwerken.
        try { await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true }); } catch { /* ignore */ }
      }
    } finally {
      lock.release();
    }
    if (replies || bounces) {
      postMessage({ from: "manager", kind: "feedback", body: `📥 Inbox: ${replies} antwoord(en), ${bounces} bounce(s) verwerkt.` });
    }
    return { replies, bounces };
  } catch (err) {
    postMessage({ from: "manager", kind: "alert", body: `Inbox-check faalde: ${err instanceof Error ? err.message : "onbekend"}` });
    return null;
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}
