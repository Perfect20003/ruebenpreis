// Schickt den Rübenpreis vom Tag in einen Discord-Channel (läuft über GitHub Actions).
// Webhook-URL kommt aus dem Secret DISCORD_WEBHOOK, Rollen-ID (optional) aus DISCORD_ROLE_ID.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const ROLLE = (process.env.DISCORD_ROLE_ID || '').trim();
const ERZWINGEN = process.env.ERZWINGEN === 'true';
const WEBSITE = 'https://ruebenpreis.de';
const STAND = new URL('./zuletzt-gepostet.txt', import.meta.url);
const QUERY = 'https://firestore.googleapis.com/v1/projects/ruebentimer/databases/(default)/documents/settings/global:runQuery'
  + '?key=AIzaSyB6dxEUrQsk3FAIHDGA0rObqwXSYE3jt1w';

if (!WEBHOOK) { console.error('Secret DISCORD_WEBHOOK fehlt.'); process.exit(1); }

const berlinTag = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(ms));
const zahl = (n) => Math.round(n).toLocaleString('de-DE');

// Letzte Einträge holen (lesen darf jeder)
const res = await fetch(QUERY, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'priceHistory' }],
    orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
    limit: 10 } })
});
if (!res.ok) { console.error('Firestore:', res.status, await res.text()); process.exit(1); }
const eintraege = (await res.json())
  .map(r => r.document?.fields).filter(Boolean)
  .map(f => ({ preis: Number(f.price?.integerValue), ts: Number(f.timestamp?.integerValue), sender: f.sender?.stringValue || '' }))
  .filter(e => e.preis > 0 && e.ts > 0);

if (!eintraege.length) { console.log('Keine Preise.'); process.exit(0); }
const heute = berlinTag(Date.now());
const neu = eintraege[0];
const tag = berlinTag(neu.ts);
if (tag !== heute) { console.log('Heute noch kein Preis (' + heute + ').'); process.exit(0); }

const schon = existsSync(STAND) ? readFileSync(STAND, 'utf8').trim() : '';
if (schon === tag && !ERZWINGEN) { console.log('Für ' + tag + ' schon gepostet.'); process.exit(0); }

// Vortag = letzter Eintrag von einem früheren Tag
const alt = eintraege.find(e => berlinTag(e.ts) < tag);
const r = alt ? neu.preis / alt.preis : 1;
let status = 'Unverändert', farbe = 0x9ca3af;
if (r < 0.9) { status = 'Abgestürzt'; farbe = 0xef4444; }
else if (r < 1) { status = 'Gefallen'; farbe = 0xf97316; }
else if (r > 1) { status = 'Gestiegen'; farbe = 0x22c55e; }

const [j, m, d] = tag.split('-');
const prozent = alt ? ((r - 1) * 100) : 0;
const vz = prozent > 0 ? '+' : '';
const linie = '-'.repeat(28);
const name = neu.sender.replace(/\s*\(.*\)$/, '').trim();

const embed = {
  title: `Datum: ${d}.${m}.${j} | ${status}`,
  url: WEBSITE,
  color: farbe,
  description: [
    linie,
    `Aktueller Preis: **${zahl(neu.preis)} Taler**`,
    alt ? `Seit gestern: **[${vz}${prozent.toFixed(2)}% - ${zahl(alt.preis)}]**` : 'Seit gestern: erster Eintrag',
    linie,
    `-# [Verlauf, Prognose & Tippspiel auf ruebenpreis.de](${WEBSITE})`
  ].join('\n'),
  timestamp: new Date(neu.ts).toISOString()
};
if (/^[A-Za-z0-9_]{3,16}$/.test(name)) {
  embed.footer = { text: 'gesendet von ' + name, icon_url: `https://mc-heads.net/avatar/${name}/32` };
}

const nachricht = {
  username: 'Rübenpreis',
  content: ROLLE ? `<@&${ROLLE}>` : '',
  allowed_mentions: { roles: ROLLE ? [ROLLE] : [] },
  embeds: [embed]
};

const post = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nachricht) });
if (!post.ok) { console.error('Discord:', post.status, await post.text()); process.exit(1); }
writeFileSync(STAND, tag + '\n');
console.log('Gepostet für ' + tag + ': ' + neu.preis);
