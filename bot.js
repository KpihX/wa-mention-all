// bot.js — Version Finale (Détection d'identité Robuste)
global.crypto = require('crypto');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser // Fonction officielle Baileys pour nettoyer les IDs !
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');

const delay = ms => new Promise(res => setTimeout(res, ms));

// --- CONFIGURATION ---
const THROTTLE_SEC = parseInt(process.env.THROTTLE_SEC || "1", 10);
const THROTTLE_MS = THROTTLE_SEC * 1000;

// On prépare la liste blanche depuis le .env
const RAW_ALLOWED = process.env.ALLOWED_IDS || "";
// On nettoie les IDs du .env pour être sûr qu'ils sont au bon format
const ALLOWED_IDS = RAW_ALLOWED.split(',').map(id => jidNormalizedUser(id.trim())).filter(id => id.length > 0);

const lastAll = new Map();
const processed = new Set();

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
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🤖 Démarrage du bot v${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  let presenceInterval = null;

  // --- GESTION CONNEXION ---
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nSCANNEZ CE QR CODE :');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      // On récupère le VRAI ID du bot connecté (Ex: 33612345678@s.whatsapp.net)
      const botId = jidNormalizedUser(sock.user.id);
      console.log(`✅ Connecté en tant que : ${botId}`);
      console.log(`🛡️ Whitelist (.env) : ${ALLOWED_IDS.join(', ')}`);

      if (presenceInterval) clearInterval(presenceInterval);
      presenceInterval = setInterval(() => {
        try { if (sock.user) sock.sendPresenceUpdate('available'); } catch (e) {}
      }, 30000); 
    }

    if (connection === 'close') {
      if (presenceInterval) clearInterval(presenceInterval);
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`🔌 Déco (Code ${reason}). Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) { await delay(5000); start(); }
      else { process.exit(1); }
    }
  });

  // --- GESTION MESSAGES ---
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg || !msg.message) return;

    const msgId = msg.key.id;
    if (processed.has(msgId)) return;
    processed.add(msgId);

    // --- 1. IDENTIFICATION DE L'AUTEUR (NORMALISÉE) ---
    // L'auteur brut (peut être un LID, un JID avec :device, etc.)
    const rawAuthor = msg.key.participant || msg.key.remoteJid;
    // L'auteur propre (336...@s.whatsapp.net)
    const author = jidNormalizedUser(rawAuthor);
    
    // Le Bot lui-même (Moi)
    const botMe = jidNormalizedUser(sock.user?.id);

    // --- 2. LOGIQUE DE SÉCURITÉ ---
    // Est-ce que le message vient de "Moi" (peu importe le device) ?
    const isMe = (author === botMe);
    
    // Est-ce que l'auteur est dans la liste blanche ?
    const isWhitelisted = ALLOWED_IDS.includes(author);

    // Verdict : Autorisé ou pas ?
    const isAuthorized = isMe || isWhitelisted;

    // Logs de debug clairs
    // console.log(`DEBUG: Auteur=${author} | Bot=${botMe} | isMe=${isMe} | Auth=${isAuthorized}`);

    // --- 3. FILTRAGE GROUPE & TEXTE ---
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return;

    const textRaw = extractText(msg).trim();
    const isForce = textRaw.startsWith('#!');
    if (!textRaw.startsWith('#') && !isForce) return; // Pas une commande

    // Si c'est une commande mais non autorisé -> On log et on stop
    if (!isAuthorized) {
        console.log(`⛔ Commande bloquée de ${author} (Non autorisé)`);
        return;
    }

    // --- 4. EXÉCUTION ---
    console.log(`🚀 Commande validée de ${author} !`);
    const payload = isForce ? textRaw.slice(2).trim() : textRaw.slice(1).trim();
    const finalPayload = payload.length > 0 ? payload : "Attention tout le monde !";

    const now = Date.now();
    const last = lastAll.get(remoteJid) || 0;
    
    if (!isForce && now - last < THROTTLE_MS) {
      console.log(`⏳ Throttled`);
      return;
    }
    lastAll.set(remoteJid, now);

    try {
      const groupMetadata = await sock.groupMetadata(remoteJid);
      const mentions = groupMetadata.participants.map(p => p.id);
      
      await sock.sendMessage(remoteJid, { text: `📣 ${finalPayload}`, mentions });
      
      try { await sock.sendMessage(remoteJid, { delete: msg.key }); } catch (e) {}
      
    } catch (e) {
      console.error('Erreur:', e);
    }
  });
}

start();