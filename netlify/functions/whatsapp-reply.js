const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/xml'
  };

  // Twilio שולח POST עם פרטי ההודעה
  const params = new URLSearchParams(event.body || '');
  const from   = params.get('From') || ''; // whatsapp:+972528814087
  const body   = (params.get('Body') || '').trim();

  console.log('Reply from:', from, 'Body:', body);

  const phone = from.replace('whatsapp:+', '').replace('whatsapp:', '');
  const FB_HOST = 'pool-pro-app-df546-default-rtdb.firebaseio.com';

  try {
    // קרא לקוחות ותורים מ-Firebase
    const [clients, appts, statuses] = await Promise.all([
      fbGet(FB_HOST, '/clients.json'),
      fbGet(FB_HOST, '/appts.json'),
      fbGet(FB_HOST, '/statuses.json')
    ]);

    // מצא לקוח לפי טלפון
    const clientEntry = Object.entries(clients || {}).find(([, c]) => {
      const p = (c.phone || '').replace(/[^0-9]/g, '');
      const ph = phone.replace(/[^0-9]/g, '');
      return p === ph || p === '0' + ph.slice(3) || '972' + p.slice(1) === ph;
    });

    if (!clientEntry) {
      console.log('Client not found for phone:', phone);
      return { statusCode: 200, headers, body: '<Response></Response>' };
    }

    const [clientId] = clientEntry;
    console.log('Found client:', clientId);

    // מצא תורים מחר או היום
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr  = tomorrow.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const apptEntry = Object.entries(appts || {}).find(([, a]) => {
      if (!a) return false;
      const dateMatch = a.date === tStr || a.date === today;
      if (!dateMatch) return false;
      if (a.type === 'private' && a.clientId === clientId) return true;
      if (a.type === 'group' && a.participants?.[clientId]) return true;
      return false;
    });

    if (!apptEntry) {
      console.log('No appointment found for client:', clientId);
      return { statusCode: 200, headers, body: '<Response></Response>' };
    }

    const [apptId, appt] = apptEntry;
    const dateStr = appt.date;
    const answer  = body;

    let newStatus = null;
    if (answer === '1' || answer.includes('אשר') || answer.includes('כן') || answer.includes('מאשר')) {
      newStatus = 'confirmed';
    } else if (answer === '2' || answer.includes('בטל') || answer.includes('לא') || answer.includes('מבטל')) {
      newStatus = 'declined';
    }

    if (newStatus) {
      const key = appt.type === 'group'
        ? `${apptId}_${clientId}_${dateStr}`
        : `${apptId}_${dateStr}`;
      await fbPut(FB_HOST, `/statuses/${key}.json`, `"${newStatus}"`);
      console.log('Status updated:', key, '->', newStatus);
    }

    // החזר הודעת אישור ללקוח
    let replyMsg = '';
    if (newStatus === 'confirmed') {
      replyMsg = `תודה! ✅ התור שלך ב-${dateStr} בשעה ${appt.time} אושר. נשמח לראותך! 🌊`;
    } else if (newStatus === 'declined') {
      replyMsg = `הבנו ❌ התור שלך בוטל. ליצירת קשר לתיאום מחדש אנחנו כאן. 😊`;
    } else {
      replyMsg = `לא הבנו את תשובתך. ענה *1* לאישור או *2* לביטול.`;
    }

    return {
      statusCode: 200,
      headers,
      body: `<Response><Message>${replyMsg}</Message></Response>`
    };

  } catch (e) {
    console.log('Error:', e.message);
    return { statusCode: 200, headers, body: '<Response></Response>' };
  }
};

function fbGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'GET' }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function fbPut(host, path, body) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => resolve(res.statusCode < 300));
    req.on('error', () => resolve(false)); req.write(body); req.end();
  });
}
