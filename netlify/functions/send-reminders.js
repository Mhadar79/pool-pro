const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const TWILIO_SID   = process.env.TWILIO_SID;
  const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
  const TWILIO_FROM  = 'whatsapp:+14155238886';
  const FB_HOST      = 'pool-pro-app-df546-default-rtdb.firebaseio.com';

  try {
    const [appts, clients] = await Promise.all([
      fbGet(FB_HOST, '/appts.json'),
      fbGet(FB_HOST, '/clients.json')
    ]);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = tomorrow.toISOString().slice(0, 10);

    const dayAppts = getAppts(appts || {}, tStr);

    if (!dayAppts.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: 0, message: 'אין תורים מחר' }) };
    }

    let sent = 0, skipped = 0, failed = 0;

    for (const a of dayAppts) {
      if (a.type === 'private') {
        const c = (clients || {})[a.clientId];
        if (!c?.phone) { skipped++; continue; }
        const msg = `שלום ${c.first||''} 😊\nתזכורת לתור שלך מחר (${tStr}) בשעה ${a.time}.\n\nענה *1* לאישור ✅\nענה *2* לביטול ❌`;
        const ok = await sendWA(TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, c.phone, msg);
        if (ok) { sent++; await fbPut(FB_HOST, `/statuses/${a.id}_${tStr}.json`, '"sent"'); }
        else failed++;
      } else if (a.type === 'group') {
        for (const cId of Object.keys(a.participants || {})) {
          const c = (clients || {})[cId];
          if (!c?.phone) { skipped++; continue; }
          const msg = `שלום ${c.first||''} 😊\nתזכורת לשיעור "${a.groupName||'קבוצה'}" מחר (${tStr}) בשעה ${a.time}.\n\nענה *1* לאישור ✅\nענה *2* לביטול ❌`;
          const ok = await sendWA(TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, c.phone, msg);
          if (ok) { sent++; await fbPut(FB_HOST, `/statuses/${a.id}_${cId}_${tStr}.json`, '"sent"'); }
          else failed++;
        }
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent, skipped, failed, tomorrow: tStr }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};

function sendWA(sid, token, from, phone, message) {
  return new Promise((resolve) => {
    const intl = phone.replace(/[^0-9]/g, '');
    const to   = intl.startsWith('0') ? '972' + intl.slice(1) : intl;
    console.log('Sending to:', 'whatsapp:+'+to);
    const body = `From=${encodeURIComponent(from)}&To=${encodeURIComponent('whatsapp:+'+to)}&Body=${encodeURIComponent(message)}`;
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const req  = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${sid}/Messages.json`,
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = ''; 
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Twilio response status:', res.statusCode);
        console.log('Twilio response body:', d);
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
    });
    req.on('error', (e) => { console.log('Request error:', e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

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

function getAppts(appts, dateStr) {
  const list = [];
  Object.entries(appts).forEach(([id, a]) => {
    if (!a) return;
    if (a.date === dateStr) { list.push({ ...a, id }); return; }
    if (a.recurring === 'weekly') {
      const diff = Math.round((new Date(dateStr) - new Date(a.date)) / 86400000);
      if (diff > 0 && diff % 7 === 0) list.push({ ...a, id });
    }
    if (a.recurring === 'biweekly') {
      const diff = Math.round((new Date(dateStr) - new Date(a.date)) / 86400000);
      if (diff > 0 && diff % 14 === 0) list.push({ ...a, id });
    }
  });
  return list;
}
