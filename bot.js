// bot.js — WhatsApp mention-all via "#" avec override, throttle configurable et suppression du trigger
global.crypto = require('crypto');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');

const delay = ms => new Promise(res => setTimeout(res, ms));

// configuration via env
const THROTTLE_SEC = parseInt(process.env.THROTTLE_SEC || "1", 10); // en secondes
const THROTTLE_MS = THROTTLE_SEC * 1000;
const ENABLE_FEEDBACK = process.env.THROTTLE_FEEDBACK === "1";

const lastAll = new Map(); // timestamp du dernier # par groupe
const processed = new Set(); // éviter double traitement

function extractText(msg) {
  if (!msg.message) return '';
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.documentMessage?.caption ||
    ''
  );
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '22.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 Scanne ce QR code :');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('✅ Bot connecté à WhatsApp');
    }

    if (connection === 'close') {
      const reasonCode = lastDisconnect?.error?.output?.statusCode;
      console.log('🔌 Déconnecté. Reason:', reasonCode || lastDisconnect?.error);
      const shouldReconnect = reasonCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('↻ Tentative de reconnexion dans 5 secondes...');
        await delay(5000);
        start();
      } else {
        console.log('❌ Session logout. Supprime ./auth et rescanne le QR si nécessaire.');
      }
    }
  });

  // Maintenir une présence pour éviter idle
  setInterval(() => {
    try {
      sock.sendPresenceUpdate('available');
    } catch {}
  }, 30_000);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg || !msg.message) return;

    const msgId = msg.key.id;
    if (processed.has(msgId)) return;
    processed.add(msgId);

    // on ne traite que tes propres commandes
    if (!msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return; // uniquement groupes

    let text = extractText(msg).trim();
    if (!text) return;

    const isForce = text.startsWith('#!');
    if (!text.startsWith('#') && !isForce) return;

    const payload = isForce ? text.slice(2).trim() : text.slice(1).trim();
    if (!payload) return;

    const now = Date.now();
    const last = lastAll.get(remoteJid) || 0;
    if (!isForce && now - last < THROTTLE_MS) {
      const remaining = Math.ceil((THROTTLE_MS - (now - last)) / 1000);
      console.log(`⏳ Throttled # pour ${remoteJid}, encore ${remaining}s (override avec #!)`);
      if (ENABLE_FEEDBACK) {
        try {
          await sock.sendMessage(remoteJid, {
            text: `⏳ Patiente encore ${remaining}s avant de réutiliser \`#\`.`
          });
        } catch (e) {
          console.error('Erreur feedback throttle:', e);
        }
      }
      return;
    }
    lastAll.set(remoteJid, now);

    try {
      const groupMetadata = await sock.groupMetadata(remoteJid);
      const mentions = groupMetadata.participants.map(p => p.id);
      console.log(`📍 # déclenché dans ${remoteJid}, membres:`, mentions);
      await sock.sendMessage(remoteJid, {
        text: `📣 ${payload}`,
        mentions
      });
      console.log(`✅ Mentionné ${mentions.length} membres dans ${remoteJid}`);

      // essayer de supprimer le message original
      try {
        await sock.sendMessage(remoteJid, { delete: msg.key });
        console.log('🗑️ Message de commande supprimé.');
      } catch (delErr) {
        console.warn('⚠️ Impossible de supprimer le trigger original :', delErr.message || delErr);
      }
    } catch (e) {
      console.error('Erreur lors du #:', e);
    }
  });
}

start();
