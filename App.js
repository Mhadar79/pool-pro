// ════════════════════════════════════════════════════════════════
//  POOL PRO — app.js
//  Firebase Realtime DB + full calendar logic
// ════════════════════════════════════════════════════════════════

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, remove, push }
                           from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/* ── FIREBASE ── */
const fbApp = initializeApp({
  apiKey:            "AIzaSyAwjNkqhgRNzXIhNakOuPLlDLxAq82fruE",
  authDomain:        "pool-pro-app-df546.firebaseapp.com",
  databaseURL:       "https://pool-pro-app-df546-default-rtdb.firebaseio.com",
  projectId:         "pool-pro-app-df546",
  storageBucket:     "pool-pro-app-df546.firebasestorage.app",
  messagingSenderId: "30350309720",
  appId:             "1:30350309720:web:3cc94d0dc437a430720d2d"
});
const db = getDatabase(fbApp);

/* ── CONSTANTS ── */
const COLORS = [
  '#22d3ee','#3b82f6','#a78bfa','#f472b6',
  '#fb923c','#34d399','#f87171','#fbbf24',
  '#60a5fa','#e879f9','#4ade80','#f97316'
];
const DAYS_HE   = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const THERAPISTS = { t1: 'מטפלת א׳', t2: 'מטפלת ב׳' };

/* ── STATE ── */
let clients   = {};
let appts     = {};
let statuses  = {};
let viewDate  = new Date();
let selColor  = COLORS[0];
let _groupParticipantCount = 0;
let toastTimer;

/* ════════════════════════════════════════
   FIREBASE LISTENERS
════════════════════════════════════════ */
onValue(ref(db,'clients'),  s => { clients  = s.val()||{}; Calendar.render(); Clients.render(); Reports.refresh(); });
onValue(ref(db,'appts'),    s => { appts    = s.val()||{}; Calendar.render(); Reports.refresh(); });
onValue(ref(db,'statuses'), s => { statuses = s.val()||{}; Calendar.render(); Reports.refresh(); });
document.getElementById('syncBadge').textContent = '🟢';

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function isoDate(d) { return d.toISOString().slice(0,10); }
function toast(msg, dur=2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), dur);
}
function clientName(id) {
  const c = clients[id]; if (!c) return '—';
  return `${c.first||''} ${c.last||''}`.trim() || '—';
}
function clientColor(id) { return (clients[id]||{}).color || '#22d3ee'; }
function clientPhone(id) { return ((clients[id]||{}).phone||'').replace(/[^0-9]/g,''); }
function buildWaUrl(clientId, appt) {
  const phone = clientPhone(clientId);
  if (!phone) return '';
  const name  = clientName(clientId);
  const intl  = phone.startsWith('0') ? '972'+phone.slice(1) : phone;
  const msg   = encodeURIComponent(`שלום ${name} 😊\nתזכורת לתור שלך ב-${appt.date} בשעה ${appt.time}.\nנשמח לראותך! 🌊`);
  return `https://wa.me/${intl}?text=${msg}`;
}

/* ════════════════════════════════════════
   APP — navigation & date
════════════════════════════════════════ */
window.App = {
  openPanel(name) {
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
    document.getElementById('panel-'+name).classList.add('active');
    document.getElementById('ntab-'+name)?.classList.add('active');
    document.getElementById('fabBtn').style.display = name==='calendar' ? 'flex' : 'none';
    document.getElementById('headerDateNav').style.display = name==='calendar' ? 'flex' : 'none';
    if (name==='reports') Reports.renderDaily();
    if (name==='clients') Clients.render();
  },
  shiftDay(d) { viewDate.setDate(viewDate.getDate()+d); Calendar.render(); },
  goToday()   { viewDate = new Date(); Calendar.render(); },
  openDatePicker() { const el=document.getElementById('hiddenDatePicker'); el.value=isoDate(viewDate); el.showPicker?.(); el.click(); },
  setDateFromPicker(v) { if(v){ viewDate=new Date(v+'T12:00:00'); Calendar.render(); } }
};

/* ════════════════════════════════════════
   CALENDAR
════════════════════════════════════════ */
window.Calendar = {
  getDayAppts(dateStr) {
    const list = [];
    Object.entries(appts).forEach(([id,a]) => {
      if (!a) return;
      if (a.date === dateStr) { list.push({...a,id}); return; }
      if (a.recurring==='weekly') {
        const diff = Math.round((new Date(dateStr)-new Date(a.date))/86400000);
        if (diff>0 && diff%7===0) list.push({...a,id,recInstance:true});
      }
      if (a.recurring==='biweekly') {
        const diff = Math.round((new Date(dateStr)-new Date(a.date))/86400000);
        if (diff>0 && diff%14===0) list.push({...a,id,recInstance:true});
      }
    });
    return list.sort((a,b)=>a.time>b.time?1:-1);
  },

  render() {
    const hDay  = document.getElementById('hDayName');
    const hDate = document.getElementById('hDate');
    hDay.textContent  = `יום ${DAYS_HE[viewDate.getDay()]}`;
    hDate.textContent = `${viewDate.getDate()} ${MONTHS_HE[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

    const dateStr = isoDate(viewDate);
    const list    = this.getDayAppts(dateStr);
    const grid    = document.getElementById('calendarGrid');

    if (!list.length) {
      grid.innerHTML = `<div class="empty-day"><div class="icon">🏊</div><p>אין תורים היום</p><p style="font-size:.78rem;margin-top:5px">לחץ + להוסיף תור</p></div>`;
      return;
    }

    // check therapist conflicts
    const therapistHours = {};
    list.forEach(a => {
      const k = `${a.therapist||'t1'}_${a.time}`;
      therapistHours[k] = (therapistHours[k]||0)+1;
    });

    grid.innerHTML = list.map((a,i) => {
      const isGroup   = a.type === 'group';
      const statusKey = `${a.id}_${dateStr}`;
      const status    = statuses[statusKey] || 'pending';
      const conflict  = (therapistHours[`${a.therapist||'t1'}_${a.time}`]||0) > 1;

      if (isGroup) return this._groupCard(a, dateStr, i, conflict);
      return this._privateCard(a, dateStr, i, conflict);
    }).join('');
  },

  _privateCard(a, dateStr, i, conflict) {
    const cId     = a.clientId;
    const color   = clientColor(cId);
    const name    = clientName(cId);
    const statusKey = `${a.id}_${dateStr}`;
    const status  = statuses[statusKey] || 'pending';
    const waUrl   = buildWaUrl(cId, a);
    const conf    = status==='confirmed';
    const decl    = status==='declined';
    const ther    = THERAPISTS[a.therapist||'t1'];

    return `<div class="appt-card ${conf?'':''}${decl?'':''}" 
      style="padding-right:18px;animation-delay:${i*0.04}s"
      onclick="Calendar.openDetail('${a.id}','${dateStr}')">
      <div class="color-bar" style="background:${color}"></div>
      <div class="card-top">
        <div>
          <div class="card-title">${name}</div>
          <div class="card-meta">${a.time} · ${a.duration||60} דק׳ · ${ther}</div>
        </div>
        <div style="text-align:left">
          <div class="card-time">${a.time}</div>
        </div>
      </div>
      <div class="card-badges">
        <span class="badge badge-private">🏊 פרטני</span>
        <span class="badge ${conf?'badge-confirmed':decl?'badge-declined':'badge-pending'}">
          ${conf?'✅ אישר':decl?'❌ ביטל':'⏳ ממתין'}
        </span>
        ${a.recInstance||a.recurring!=='none'?'<span class="badge badge-recurring">🔁 קבוע</span>':''}
        ${conflict?'<span class="badge" style="background:#f59e0b18;color:#f59e0b">⚠️ חפיפה</span>':''}
      </div>
      <div class="card-actions" onclick="event.stopPropagation()">
        ${waUrl?`<button class="icon-btn wa-btn" onclick="window.open('${waUrl}','_blank')" title="ווטסאפ">💬</button>`:''}
        <button class="icon-btn chk-btn ${conf?'confirmed':decl?'declined':''}" 
          onclick="Calendar.cycleStatus('${a.id}','${dateStr}')" title="סטטוס">
          ${conf?'✓':decl?'✕':'○'}
        </button>
      </div>
    </div>`;
  },

  _groupCard(a, dateStr, i, conflict) {
    const participants = a.participants || {};
    const pList = Object.entries(participants);
    const color = '#a78bfa';
    const ther  = THERAPISTS[a.therapist||'t1'];
    const confirmedCount = pList.filter(([cId])=>statuses[`${a.id}_${cId}_${dateStr}`]==='confirmed').length;

    const pRows = pList.map(([cId])=>{
      const st  = statuses[`${a.id}_${cId}_${dateStr}`]||'pending';
      const col = clientColor(cId);
      const wa  = buildWaUrl(cId, a);
      return `<div class="participant-row">
        <div class="participant-dot" style="background:${col}"></div>
        <div class="participant-name">${clientName(cId)}</div>
        <span class="participant-status">${st==='confirmed'?'✅':st==='declined'?'❌':'⏳'}</span>
        <button class="icon-btn chk-btn ${st==='confirmed'?'confirmed':st==='declined'?'declined':''}" 
          style="width:24px;height:24px;font-size:.7rem"
          onclick="event.stopPropagation();Calendar.cycleGroupStatus('${a.id}','${cId}','${dateStr}')">
          ${st==='confirmed'?'✓':st==='declined'?'✕':'○'}
        </button>
        ${wa?`<button class="icon-btn wa-btn" style="width:24px;height:24px;font-size:.7rem" onclick="event.stopPropagation();window.open('${wa}','_blank')">💬</button>`:''}
      </div>`;
    }).join('');

    return `<div class="appt-card" style="padding-right:18px;animation-delay:${i*0.04}s" id="gcard-${a.id}">
      <div class="color-bar" style="background:${color}"></div>
      <div class="card-top" onclick="Calendar.toggleGroup('${a.id}')">
        <div>
          <div class="card-title">👥 ${a.groupName||'קבוצה'}</div>
          <div class="card-meta">${a.time} · ${a.duration||60} דק׳ · ${ther} · ${pList.length} משתתפים</div>
        </div>
        <div style="font-size:.8rem;color:var(--muted)">${confirmedCount}/${pList.length} ✅</div>
      </div>
      <div class="card-badges" onclick="Calendar.toggleGroup('${a.id}')">
        <span class="badge badge-group">👥 קבוצתי</span>
        ${a.recInstance||a.recurring!=='none'?'<span class="badge badge-recurring">🔁 קבוע</span>':''}
        ${conflict?'<span class="badge" style="background:#f59e0b18;color:#f59e0b">⚠️ חפיפה</span>':''}
        <span style="font-size:.7rem;color:var(--muted);margin-right:4px">▼ לחץ להרחבה</span>
      </div>
      <div class="group-participants" id="gp-${a.id}">
        ${pRows}
        <button class="btn-ghost btn-sm" style="margin-top:8px;font-size:.75rem" 
          onclick="event.stopPropagation();Appointments.openEdit('${a.id}')">✏️ ערוך</button>
      </div>
    </div>`;
  },

  toggleGroup(id) {
    const el = document.getElementById(`gp-${id}`);
    if (el) el.classList.toggle('open');
  },

  async cycleStatus(apptId, dateStr) {
    const key = `${apptId}_${dateStr}`;
    const cur = statuses[key]||'pending';
    const next = cur==='pending'?'confirmed':cur==='confirmed'?'declined':'pending';
    await set(ref(db,`statuses/${key}`), next);
    toast(next==='confirmed'?'✅ אישר הגעה':next==='declined'?'❌ ביטל':'↩️ ממתין');
  },

  async cycleGroupStatus(apptId, clientId, dateStr) {
    const key = `${apptId}_${clientId}_${dateStr}`;
    const cur = statuses[key]||'pending';
    const next = cur==='pending'?'confirmed':cur==='confirmed'?'declined':'pending';
    await set(ref(db,`statuses/${key}`), next);
    toast(next==='confirmed'?'✅ אישר':next==='declined'?'❌ ביטל':'↩️');
  },

  openDetail(apptId, dateStr) {
    const a = appts[apptId]; if(!a) return;
    const isGroup = a.type==='group';
    const ther  = THERAPISTS[a.therapist||'t1'];
    let html = '';

    if (!isGroup) {
      const cId   = a.clientId;
      const color = clientColor(cId);
      const name  = clientName(cId);
      const st    = statuses[`${apptId}_${dateStr}`]||'pending';
      const c     = clients[cId]||{};
      const wa    = buildWaUrl(cId, a);
      html = `<div class="detail-header">
        <div class="detail-avatar" style="background:${color}">${(name[0]||'?')}</div>
        <div><div class="detail-title">${name}</div><div class="detail-sub">${a.date} · ${a.time}</div></div>
      </div>
      <div class="detail-section">
        <h4>פרטי תור</h4>
        <div style="font-size:.85rem;line-height:2">
          ⏱️ משך: ${a.duration||60} דק׳<br>
          👩‍⚕️ מטפלת: ${ther}<br>
          🔁 חזרה: ${a.recurring==='weekly'?'שבועי':a.recurring==='biweekly'?'דו שבועי':'חד פעמי'}<br>
          ${a.notes?`📝 הערות: ${a.notes}<br>`:''}
          📞 טלפון: ${c.phone||'לא קיים'}<br>
          ${c.notes?`🏥 רפואי: ${c.notes}`:''}
        </div>
      </div>
      <div class="detail-section">
        <h4>סטטוס הגעה</h4>
        <span class="badge ${st==='confirmed'?'badge-confirmed':st==='declined'?'badge-declined':'badge-pending'}" style="font-size:.85rem;padding:5px 12px">
          ${st==='confirmed'?'✅ אישר הגעה':st==='declined'?'❌ ביטל':'⏳ ממתין לאישור'}
        </span>
      </div>
      <div class="detail-actions">
        <button class="btn-full" onclick="Calendar.cycleStatus('${apptId}','${dateStr}');Modal.close('modal-detail')">
          ${st==='pending'?'✅ אשר הגעה':st==='confirmed'?'❌ סמן ביטול':'↩️ איפוס'}
        </button>
        ${wa?`<button class="btn-full" style="background:linear-gradient(135deg,#128C7E,#25D366)" onclick="window.open('${wa}','_blank')">💬 ווטסאפ</button>`:''}
      </div>
      <button class="btn-ghost btn-sm" style="width:100%;margin-top:8px;padding:9px" onclick="Appointments.openEdit('${apptId}')">✏️ ערוך תור</button>`;
    } else {
      const pList = Object.entries(a.participants||{});
      const pRows = pList.map(([cId])=>{
        const st  = statuses[`${apptId}_${cId}_${dateStr}`]||'pending';
        const wa  = buildWaUrl(cId,a);
        const col = clientColor(cId);
        return `<div class="participant-row" style="border-bottom:1px solid var(--border);padding-bottom:7px;margin-bottom:7px">
          <div class="participant-dot" style="background:${col}"></div>
          <div class="participant-name">${clientName(cId)}</div>
          <span class="badge ${st==='confirmed'?'badge-confirmed':st==='declined'?'badge-declined':'badge-pending'}">${st==='confirmed'?'✅':st==='declined'?'❌':'⏳'}</span>
          <button class="icon-btn chk-btn ${st==='confirmed'?'confirmed':''}" onclick="Calendar.cycleGroupStatus('${apptId}','${cId}','${dateStr}')">
            ${st==='confirmed'?'✓':st==='declined'?'✕':'○'}
          </button>
          ${wa?`<button class="icon-btn wa-btn" onclick="window.open('${wa}','_blank')">💬</button>`:''}
        </div>`;
      }).join('');

      html = `<div class="detail-header">
        <div class="detail-avatar" style="background:#a78bfa">👥</div>
        <div><div class="detail-title">${a.groupName||'קבוצה'}</div><div class="detail-sub">${a.date} · ${a.time} · ${pList.length} משתתפים</div></div>
      </div>
      <div class="detail-section"><h4>משתתפים</h4>${pRows}</div>
      <button class="btn-ghost btn-sm" style="width:100%;margin-top:4px;padding:9px" onclick="Appointments.openEdit('${apptId}')">✏️ ערוך תור</button>`;
    }

    document.getElementById('detailContent').innerHTML = html;
    Modal.open('modal-detail');
  }
};

/* ════════════════════════════════════════
   APPOINTMENTS
════════════════════════════════════════ */
window.Appointments = {
  switchType(type) {
    document.getElementById('apptType').value = type;
    document.getElementById('privateFields').style.display = type==='private'?'block':'none';
    document.getElementById('groupFields').style.display   = type==='group'?'block':'none';
    document.getElementById('ftab-private').classList.toggle('active', type==='private');
    document.getElementById('ftab-group').classList.toggle('active',   type==='group');
  },

  openAdd() {
    this._reset();
    document.getElementById('apptModalTitle').textContent = 'תור חדש';
    document.getElementById('deleteApptBtn').style.display = 'none';
    document.getElementById('apptDate').value = isoDate(viewDate);
    this._fillClientSelect();
    Modal.open('modal-appt');
  },

  openEdit(id) {
    const a = appts[id]; if (!a) return;
    this._reset();
    document.getElementById('apptModalTitle').textContent = 'עריכת תור';
    document.getElementById('deleteApptBtn').style.display = 'block';
    document.getElementById('apptId').value  = id;
    document.getElementById('apptDate').value = a.date||'';
    document.getElementById('apptTime').value = a.time||'09:00';
    document.getElementById('apptDuration').value  = a.duration||'60';
    document.getElementById('apptTherapist').value = a.therapist||'t1';
    document.getElementById('apptRecurring').value = a.recurring||'none';
    document.getElementById('apptNotes').value     = a.notes||'';

    if (a.type==='group') {
      this.switchType('group');
      document.getElementById('groupName').value = a.groupName||'';
      _groupParticipantCount = 0;
      document.getElementById('groupParticipants').innerHTML = '';
      Object.keys(a.participants||{}).forEach(cId => this.addParticipant(cId));
    } else {
      this.switchType('private');
      this._fillClientSelect(a.clientId);
    }
    Modal.close('modal-detail');
    Modal.open('modal-appt');
  },

  _reset() {
    document.getElementById('apptId').value  = '';
    document.getElementById('apptType').value = 'private';
    document.getElementById('apptDate').value = '';
    document.getElementById('apptTime').value = '09:00';
    document.getElementById('apptDuration').value  = '60';
    document.getElementById('apptTherapist').value = 't1';
    document.getElementById('apptRecurring').value = 'none';
    document.getElementById('apptNotes').value = '';
    document.getElementById('groupName').value = '';
    document.getElementById('groupParticipants').innerHTML = '';
    document.getElementById('conflictWarning').style.display = 'none';
    _groupParticipantCount = 0;
    this.switchType('private');
  },

  _fillClientSelect(selId='') {
    const sel = document.getElementById('apptClient');
    sel.innerHTML = '<option value="">-- בחר לקוח --</option>' +
      Object.entries(clients).filter(([,c])=>c).map(([id,c])=>
        `<option value="${id}" ${id===selId?'selected':''}>${c.first||''} ${c.last||''}</option>`
      ).join('');
  },

  addParticipant(preselect='') {
    const container = document.getElementById('groupParticipants');
    const idx = _groupParticipantCount++;
    const options = Object.entries(clients).filter(([,c])=>c).map(([id,c])=>
      `<option value="${id}" ${id===preselect?'selected':''}>${c.first||''} ${c.last||''}</option>`
    ).join('');
    const row = document.createElement('div');
    row.className = 'p-row'; row.id = `prow-${idx}`;
    row.innerHTML = `<select class="p-select"><option value="">-- בחר --</option>${options}</select>
      <button class="del" onclick="document.getElementById('prow-${idx}').remove()">✕</button>`;
    container.appendChild(row);
  },

  _checkConflict(date, time, therapist, excludeId='') {
    const dayAppts = Object.entries(appts).filter(([id,a])=>
      a && id!==excludeId && a.date===date && a.time===time && (a.therapist||'t1')===therapist
    );
    return dayAppts.length > 0;
  },

  async save() {
    const id       = document.getElementById('apptId').value;
    const type     = document.getElementById('apptType').value;
    const date     = document.getElementById('apptDate').value;
    const time     = document.getElementById('apptTime').value;
    const duration = document.getElementById('apptDuration').value;
    const therapist= document.getElementById('apptTherapist').value;
    const recurring= document.getElementById('apptRecurring').value;
    const notes    = document.getElementById('apptNotes').value.trim();

    if (!date || !time) { toast('⚠️ תאריך ושעה חובה'); return; }

    // conflict check
    if (this._checkConflict(date, time, therapist, id)) {
      document.getElementById('conflictWarning').style.display = 'block';
      document.getElementById('conflictMsg').textContent =
        `${THERAPISTS[therapist]} כבר תפוסה בשעה ${time}. האם להמשיך בכל זאת?`;
    }

    let data = { type, date, time, duration, therapist, recurring, notes };

    if (type==='private') {
      const clientId = document.getElementById('apptClient').value;
      if (!clientId) { toast('⚠️ בחר לקוח'); return; }
      data.clientId = clientId;
    } else {
      const gName = document.getElementById('groupName').value.trim();
      if (!gName) { toast('⚠️ הכנס שם קבוצה'); return; }
      data.groupName = gName;
      const participants = {};
      document.querySelectorAll('.p-select').forEach(sel => {
        if (sel.value) participants[sel.value] = true;
      });
      data.participants = participants;
    }

    const saveId = id || push(ref(db,'appts')).key;
    await set(ref(db,`appts/${saveId}`), data);

    viewDate = new Date(date+'T12:00:00');
    Modal.close('modal-appt');
    App.openPanel('calendar');
    toast('✅ תור נשמר');
  },

  async delete() {
    const id = document.getElementById('apptId').value;
    if (!id || !confirm('למחוק תור זה?')) return;
    await remove(ref(db,`appts/${id}`));
    Modal.close('modal-appt');
    toast('🗑️ תור נמחק');
  }
};

/* ════════════════════════════════════════
   CLIENTS
════════════════════════════════════════ */
window.Clients = {
  openAdd() {
    document.getElementById('clientModalTitle').textContent = 'לקוח חדש';
    document.getElementById('clientId').value = '';
    ['clientFirst','clientLast','clientPhone','clientAge','clientNotes'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('deleteClientBtn').style.display = 'none';
    selColor = COLORS[0];
    this._buildColorPicker();
    Modal.open('modal-client');
  },

  openEdit(id) {
    const c = clients[id]; if (!c) return;
    document.getElementById('clientModalTitle').textContent = 'עריכת לקוח';
    document.getElementById('clientId').value   = id;
    document.getElementById('clientFirst').value = c.first||'';
    document.getElementById('clientLast').value  = c.last||'';
    document.getElementById('clientPhone').value = c.phone||'';
    document.getElementById('clientAge').value   = c.age||'';
    document.getElementById('clientNotes').value = c.notes||'';
    document.getElementById('deleteClientBtn').style.display = 'block';
    selColor = c.color || COLORS[0];
    this._buildColorPicker();
    Modal.open('modal-client');
  },

  _buildColorPicker() {
    const el = document.getElementById('colorPicker');
    el.innerHTML = COLORS.map(c =>
      `<div class="color-swatch ${c===selColor?'sel':''}" style="background:${c}" onclick="Clients._pickColor('${c}')"></div>`
    ).join('');
  },

  _pickColor(c) {
    selColor = c;
    document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('sel'));
    document.querySelectorAll(`.color-swatch`).forEach(s=>{ if(s.style.background===c||s.style.background===hexToRgb(c)) s.classList.add('sel'); });
  },

  async save() {
    const first = document.getElementById('clientFirst').value.trim();
    if (!first) { toast('⚠️ שם פרטי חובה'); return; }
    const id = document.getElementById('clientId').value || push(ref(db,'clients')).key;
    await set(ref(db,`clients/${id}`), {
      first,
      last:  document.getElementById('clientLast').value.trim(),
      phone: document.getElementById('clientPhone').value.trim(),
      age:   document.getElementById('clientAge').value.trim(),
      notes: document.getElementById('clientNotes').value.trim(),
      color: selColor
    });
    Modal.close('modal-client');
    toast('✅ לקוח נשמר');
  },

  async delete() {
    const id = document.getElementById('clientId').value;
    if (!id || !confirm('למחוק לקוח זה?')) return;
    await remove(ref(db,`clients/${id}`));
    Modal.close('modal-client');
    toast('🗑️ לקוח נמחק');
  },

  render() {
    const q   = (document.getElementById('clientSearch')?.value||'').toLowerCase();
    const el  = document.getElementById('clientsList');
    const all = Object.entries(clients).filter(([,c])=>c && `${c.first} ${c.last}`.toLowerCase().includes(q));

    if (!all.length) {
      el.innerHTML = `<div class="empty-day"><div class="icon">👤</div><p>${q?'לא נמצא':'הוסף לקוח ראשון'}</p></div>`;
      return;
    }

    // count appts per client this month
    const now = new Date();
    const monthStr = isoDate(now).slice(0,7);
    const counts = {};
    Object.values(appts).forEach(a => {
      if (!a||!a.date||!a.date.startsWith(monthStr)) return;
      if (a.type==='private' && a.clientId) counts[a.clientId] = (counts[a.clientId]||0)+1;
      if (a.type==='group' && a.participants) Object.keys(a.participants).forEach(cId=>counts[cId]=(counts[cId]||0)+1);
    });

    el.innerHTML = all.map(([id,c],i)=>`
      <div class="client-row" onclick="Clients.openEdit('${id}')" style="animation-delay:${i*0.03}s">
        <div class="c-avatar" style="background:${c.color||'#22d3ee'}">${(c.first||'?')[0]}</div>
        <div class="c-info">
          <div class="c-name">${c.first||''} ${c.last||''}</div>
          <div class="c-sub">${c.phone||'אין טלפון'}${c.age?' · גיל '+c.age:''}${counts[id]?' · '+counts[id]+' תורים החודש':''}</div>
        </div>
        <span class="c-arrow">›</span>
      </div>`).join('');
  }
};

/* ════════════════════════════════════════
   REPORTS
════════════════════════════════════════ */
window.Reports = {
  _currentTab: 'daily',

  switch(tab, btn) {
    this._currentTab = tab;
    document.querySelectorAll('.rtab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    if (tab==='daily')   this.renderDaily();
    if (tab==='client')  this.renderClient();
    if (tab==='monthly') this.renderMonthly();
  },

  refresh() { if (document.getElementById('panel-reports').classList.contains('active')) {
    if (this._currentTab==='daily')   this.renderDaily();
    if (this._currentTab==='client')  this.renderClient();
    if (this._currentTab==='monthly') this.renderMonthly();
  }},

  renderDaily() {
    const el = document.getElementById('reportContent');
    const dateStr = document.getElementById('reportDatePicker')?.value || isoDate(viewDate);

    el.innerHTML = `<div class="report-date-row">
      <label>תאריך:</label>
      <input type="date" id="reportDatePicker" value="${dateStr}" onchange="Reports.renderDaily()">
    </div><div id="rdBody"></div>`;

    const list = Calendar.getDayAppts(dateStr);
    const conf = list.filter(a=>statuses[`${a.id}_${dateStr}`]==='confirmed').length;
    const decl = list.filter(a=>statuses[`${a.id}_${dateStr}`]==='declined').length;

    document.getElementById('rdBody').innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="n">${list.length}</div><div class="l">סה״כ תורים</div></div>
        <div class="stat-card"><div class="n">${conf}</div><div class="l">אישרו הגעה</div></div>
        <div class="stat-card"><div class="n">${list.length-conf-decl}</div><div class="l">ממתינים</div></div>
        <div class="stat-card"><div class="n">${list.length?Math.round(conf/list.length*100):0}%</div><div class="l">אחוז אישור</div></div>
      </div>
      ${list.length ? list.map(a=>{
        const isGroup = a.type==='group';
        if (isGroup) {
          const pList = Object.entries(a.participants||{});
          const gConf = pList.filter(([cId])=>statuses[`${a.id}_${cId}_${dateStr}`]==='confirmed').length;
          return `<div class="report-item">
            <div class="dot" style="background:#a78bfa"></div>
            <div class="ri-info"><strong>👥 ${a.groupName||'קבוצה'}</strong><span>${a.time} · ${pList.length} משתתפים · ${gConf} אישרו</span></div>
          </div>`;
        }
        const st  = statuses[`${a.id}_${dateStr}`]||'pending';
        const col = clientColor(a.clientId);
        const wa  = buildWaUrl(a.clientId, a);
        return `<div class="report-item">
          <div class="dot" style="background:${col}"></div>
          <div class="ri-info"><strong>${clientName(a.clientId)}</strong><span>${a.time} · ${a.duration||60} דק׳</span></div>
          <div class="ri-status" style="color:${st==='confirmed'?'var(--green)':st==='declined'?'var(--red)':'var(--yellow)'}">
            ${st==='confirmed'?'✅':st==='declined'?'❌':'⏳'}
          </div>
          ${wa&&st!=='confirmed'?`<div class="ri-wa" onclick="window.open('${wa}','_blank')">💬</div>`:''}
        </div>`;
      }).join('') : '<p style="color:var(--muted);text-align:center;padding:24px">אין תורים ביום זה</p>'}`;
  },

  renderClient() {
    const el = document.getElementById('reportContent');
    const options = Object.entries(clients).filter(([,c])=>c).map(([id,c])=>
      `<option value="${id}">${c.first||''} ${c.last||''}</option>`).join('');

    el.innerHTML = `<select class="client-report-select" id="reportClientSel" onchange="Reports._showClientReport(this.value)">
      <option value="">-- בחר לקוח --</option>${options}
    </select><div id="clientReportBody"></div>`;
  },

  _showClientReport(clientId) {
    if (!clientId) return;
    const c = clients[clientId]; if (!c) return;
    const el = document.getElementById('clientReportBody');

    const now = new Date();
    const thisMonth = isoDate(now).slice(0,7);
    const lastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,7);

    let thisCount=0, lastCount=0, totalCount=0;
    const apptList = [];

    Object.entries(appts).forEach(([id,a])=>{
      if (!a) return;
      let belongs = false;
      if (a.type==='private' && a.clientId===clientId) belongs=true;
      if (a.type==='group' && a.participants?.[clientId]) belongs=true;
      if (!belongs) return;
      totalCount++;
      if (a.date?.startsWith(thisMonth)) thisCount++;
      if (a.date?.startsWith(lastMonth)) lastCount++;
      apptList.push({...a,id});
    });

    apptList.sort((a,b)=>b.date>a.date?1:-1);

    el.innerHTML = `
      <div class="stats-row" style="margin-top:12px">
        <div class="stat-card"><div class="n">${totalCount}</div><div class="l">סה״כ פגישות</div></div>
        <div class="stat-card"><div class="n">${thisCount}</div><div class="l">החודש</div></div>
        <div class="stat-card"><div class="n">${lastCount}</div><div class="l">חודש שעבר</div></div>
        <div class="stat-card"><div class="n">${c.phone||'—'}</div><div class="l">טלפון</div></div>
      </div>
      ${c.notes?`<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:11px 13px;font-size:.82rem;margin-bottom:12px">🏥 ${c.notes}</div>`:''}
      ${apptList.slice(0,20).map(a=>`
        <div class="report-item">
          <div class="dot" style="background:${a.type==='group'?'#a78bfa':clientColor(clientId)}"></div>
          <div class="ri-info">
            <strong>${a.date} · ${a.time}</strong>
            <span>${a.type==='group'?'👥 '+a.groupName:'🏊 פרטני'} · ${a.duration||60} דק׳</span>
          </div>
        </div>`).join('')}`;
  },

  renderMonthly() {
    const el  = document.getElementById('reportContent');
    const now = new Date();
    const m   = isoDate(now).slice(0,7);

    const perClient = {};
    Object.entries(appts).forEach(([,a])=>{
      if (!a || !a.date?.startsWith(m)) return;
      const add = id => { perClient[id]=(perClient[id]||0)+1; };
      if (a.type==='private' && a.clientId) add(a.clientId);
      if (a.type==='group' && a.participants) Object.keys(a.participants).forEach(add);
    });

    const sorted = Object.entries(perClient).sort((a,b)=>b[1]-a[1]);

    el.innerHTML = `<h4 style="font-size:.82rem;color:var(--muted);margin-bottom:12px">
      ${MONTHS_HE[now.getMonth()]} ${now.getFullYear()} — סיכום לקוחות
    </h4>
    ${sorted.length ? sorted.map(([id,count])=>`
      <div class="report-item">
        <div class="dot" style="background:${clientColor(id)}"></div>
        <div class="ri-info"><strong>${clientName(id)}</strong><span>${count} פגישות החודש</span></div>
        <div class="ri-status" style="color:var(--accent)">${count}</div>
      </div>`).join('') : '<p style="color:var(--muted);text-align:center;padding:24px">אין נתונים לחודש זה</p>'}`;
  }
};

/* ════════════════════════════════════════
   MODAL
════════════════════════════════════════ */
window.Modal = {
  open(id)  { document.getElementById(id).classList.add('open'); },
  close(id) { document.getElementById(id).classList.remove('open'); }
};
document.querySelectorAll('.modal-overlay').forEach(o=>
  o.addEventListener('click', e=>{ if(e.target===o) o.classList.remove('open'); })
);

/* ── UTIL ── */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ── INIT ── */
App.openPanel('calendar');
Calendar.render();
