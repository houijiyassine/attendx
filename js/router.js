// ============================================================================
// AttendX v5.0 — Single-Page Application Router + All Page Logic
// ============================================================================

'use strict';

// التحقق من الجلسة
const user = auth.require();
if (!user) {
  // auth.require() عملت redirect لـ auth.html — نوقّف التنفيذ
  throw new Error('redirecting to auth');
}

const orgId = user.org_id || user.viewing_org;
const isSA  = user.role === 'superadmin';
const todayStr = new Date().toISOString().split('T')[0];
const DEFAULT_WORK_DAYS = ['MO','TU','WE','TH','FR','SA'];
const DAY_NAMES = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

// ============================================================================
// ROUTER
// ============================================================================
const routes = {
  // اسم الـ view → دالة التحميل
  dashboard:   { title: 'لوحة التحكم', subtitle: 'نظرة عامة على الحضور', loader: loadDashboardView, requireSA: false },
  superadmin:  { title: 'لوحة تحكم سوبر أدمن', subtitle: 'نظرة عامة على جميع المؤسسات', loader: loadSuperadminView, requireSA: true },
  employees:   { title: 'الموظفون', subtitle: 'إدارة قائمة الموظفين', loader: loadEmployeesView },
  employee:    { title: 'تفاصيل الموظف', subtitle: '', loader: loadEmployeeView },
  attendance:  { title: 'الحضور والانصراف', subtitle: 'سجل دخول وخروج الموظفين', loader: loadAttendanceView },
  absentees:   { title: 'الغيابات', subtitle: 'قائمة الموظفين الغائبين', loader: loadAbsenteesView },
  leaves:      { title: 'الإجازات والأذونات', subtitle: 'إدارة طلبات الإجازات', loader: loadLeavesView },
  holidays:    { title: 'العطل الرسمية', subtitle: 'إدارة الأيام المعطّلة', loader: loadHolidaysView },
  alerts:      { title: 'التنبيهات الذكية', subtitle: 'إشعارات استباقية', loader: loadAlertsView },
  reports:     { title: 'التقارير', subtitle: 'إحصاءات وتقارير شاملة', loader: loadReportsView },
  audit:       { title: 'سجل الأنشطة', subtitle: 'كل العمليات على النظام', loader: loadAuditView, requireSA: true },
  device:      { title: 'إعدادات الجهاز', subtitle: 'إدارة جهاز البصمة', loader: loadDeviceView },
  settings:    { title: 'الإعدادات', subtitle: 'إدارة الحساب والتفضيلات', loader: loadSettingsView }
};

// Navigation token — يتفادى race conditions عند التنقّل السريع
let _navToken = 0;
function isCurrentNav(token) { return token === _navToken; }
window.isCurrentNav = isCurrentNav;

function navigate(viewName, params) {
  params = params || {};
  let route = routes[viewName];
  if (!route) {
    // fallback آمن — نضمن عدم تكرار recursion
    viewName = isSA ? 'superadmin' : 'dashboard';
    route = routes[viewName];
    if (!route) { console.error('Default route not found'); return; }
  }
  if (route.requireSA && !isSA) {
    viewName = isSA ? 'superadmin' : 'dashboard';
    route = routes[viewName];
    if (!route) return;
  }

  // حماية: views تحتاج orgId — لو ما فما، حوّل لـ superadmin
  const needsOrg = !['superadmin','audit','settings'].includes(viewName);
  if (needsOrg && !orgId) {
    if (isSA) {
      viewName = 'superadmin';
      route = routes[viewName];
    } else {
      // مدير بدون org — غير منطقي، نخرج
      document.getElementById('viewHost').innerHTML =
        '<div class="page-content"><div style="text-align:center;padding:60px;color:var(--danger)">⚠️ لا توجد مؤسسة مرتبطة بحسابك. يرجى التواصل مع المسؤول.</div></div>';
      return;
    }
  }

  // token جديد لهذا الـ navigation — يلغي أي loader سابق
  const myToken = ++_navToken;

  // إيقاف الـ intervals من view السابق
  if (typeof _buildingClockInterval !== 'undefined' && _buildingClockInterval) {
    clearInterval(_buildingClockInterval);
    _buildingClockInterval = null;
  }

  // عرض sidebar
  document.getElementById('sidebar').innerHTML = renderSidebar(viewName, user);

  // عرض header
  document.getElementById('hdrTitle').textContent = route.title;
  document.getElementById('hdrSub').textContent   = route.subtitle;
  document.getElementById('hdrActions').innerHTML = '';

  // عرض المحتوى
  document.getElementById('viewHost').innerHTML =
    '<div class="page-content"><div style="text-align:center;padding:60px;color:var(--text-muted)">⏳ جارٍ التحميل...</div></div>';

  // تحديث الـ URL hash
  const hash = '#' + viewName + (params.id ? '/' + params.id : '');
  if (location.hash !== hash) history.pushState(null, '', hash);

  // استدعاء loader — مع تمرير الـ token
  Promise.resolve(route.loader({ ...params, _navToken: myToken })).catch(e => {
    if (!isCurrentNav(myToken)) return; // المستخدم تنقّل لـ view آخر
    console.error('View load error:', viewName, e);
    const errMsg = (e && e.message) || String(e || 'unknown error');
    document.getElementById('viewHost').innerHTML =
      `<div class="page-content"><div style="text-align:center;padding:60px;color:var(--danger)">
        <div style="font-size:48px;margin-bottom:12px">❌</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px">خطأ في تحميل الصفحة</div>
        <div style="font-size:12px;color:var(--text-muted);font-family:monospace;max-width:600px;margin:0 auto;padding:12px;background:var(--surface2);border-radius:8px">${esc(errMsg)}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="location.reload()">🔄 إعادة تحميل</button>
      </div></div>`;
  });
}

// تحويل href الكلاسيكية إلى SPA navigation
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http')) return;

  // نمط 1: shell.html#viewName أو shell.html#viewName/id
  let m = href.match(/^app\.html#([a-z]+)(?:\/(.+))?$/i);
  if (m) {
    const viewName = m[1];
    if (routes[viewName]) {
      e.preventDefault();
      navigate(viewName, m[2] ? { id: decodeURIComponent(m[2]) } : {});
      return;
    }
  }

  // نمط 2: #viewName (hash مباشر)
  m = href.match(/^#([a-z]+)(?:\/(.+))?$/i);
  if (m) {
    const viewName = m[1];
    if (routes[viewName]) {
      e.preventDefault();
      navigate(viewName, m[2] ? { id: decodeURIComponent(m[2]) } : {});
      return;
    }
  }

  // نمط 3 (backward compat): viewName.html?id=X — لو لسة فما shims أو bookmarks
  m = href.match(/^([a-z]+)\.html(?:\?id=([^&]+))?$/i);
  if (m) {
    const viewName = m[1];
    if (routes[viewName]) {
      e.preventDefault();
      navigate(viewName, m[2] ? { id: decodeURIComponent(m[2]) } : {});
    }
  }
});

// تحويل href داخل SPA يتم عبر document click listener أعلاه + window hashchange (في الـ footer)

function routeFromHash() {
  const hash = (location.hash || '').replace('#','');
  if (!hash) {
    navigate(isSA ? 'superadmin' : 'dashboard');
    return;
  }
  const [viewName, id] = hash.split('/');
  navigate(viewName, id ? { id } : {});
}

// Helpers
function setHeader(title, subtitle, actions) {
  if (title)    document.getElementById('hdrTitle').textContent = title;
  if (subtitle !== undefined) document.getElementById('hdrSub').textContent = subtitle;
  if (actions)  document.getElementById('hdrActions').innerHTML = actions;
}
function setView(html) { document.getElementById('viewHost').innerHTML = html; if (window.refreshIcons) window.refreshIcons(); }
function addModal(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.getElementById('modalHost').appendChild(wrap.firstElementChild);
}
function clearModals() { document.getElementById('modalHost').innerHTML = ''; }
function timeToMin(t) { if (!t) return 0; const [h,m] = t.split(':').map(Number); return h*60 + (m||0); }
function fmtDate(d) { return d.toISOString().slice(0,10); }

// HTML escape — لمنع XSS من بيانات قاعدة البيانات
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON آمن للحقن في onclick='...' (single-quoted attribute)
// يهرّب: < > & ' لتفادي كسر HTML attribute
function jsonAttr(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// VIEW: DASHBOARD (مدير)
// ============================================================================
async function loadDashboardView() {
  setHeader('لوحة التحكم', 'نظرة عامة على الحضور والأنشطة', '');
  const saBanner = user._isSAProxy ? `
    <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:12px 18px;border-radius:12px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="color:white">
        <div style="font-weight:700">👁 أنت تعرض كسوبر أدمن — ${esc(user.org_name) || 'مؤسسة'}</div>
        <div style="font-size:12px;opacity:0.9">كل ما تشوفه هنا هو منظور هذا المدير</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="background:white;color:#7c3aed;border:none;font-weight:700" onclick="window.spa.backToSA()">↩ العودة لسوبر أدمن</button>
    </div>` : '';

  setView(`
    <div class="page-content">
      ${saBanner}

      <!-- 🏢 Building Live View -->
      <div class="card mb-20">
        <div class="card-header">
          <div class="card-title">🏢 منظور الحضور المباشر — ${esc(user.org_name)||'المؤسسة'}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <span id="buildingClock" style="font-family:monospace;font-weight:700;font-size:18px;color:var(--accent)">--:--</span>
            <button class="btn btn-ghost btn-sm" onclick="window.spa.dashRefreshBuilding()" title="تحديث">🔄</button>
          </div>
        </div>
        <div class="card-body" id="buildingBox" style="padding:0">
          <div style="text-align:center;padding:60px;color:var(--text-muted)">جارٍ تحميل المنظور...</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card green"><div class="stat-icon">👥</div><div class="stat-value" id="statPresent">—</div><div class="stat-label">حاضر اليوم</div></div>
        <div class="stat-card red"><div class="stat-icon">⏱</div><div class="stat-value" id="statAbsent">—</div><div class="stat-label">غائب اليوم</div></div>
        <div class="stat-card orange"><div class="stat-icon">⚠️</div><div class="stat-value" id="statLate">—</div><div class="stat-label">متأخر اليوم</div></div>
        <div class="stat-card blue"><div class="stat-icon">📋</div><div class="stat-value" id="statTotal">—</div><div class="stat-label">إجمالي الموظفين</div></div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🤖 تحليلات ذكية</div>
            <button class="btn btn-ghost btn-sm" onclick="window.spa.dashRefreshAI()">🔄</button>
          </div>
          <div class="card-body" id="aiBox"><div style="text-align:center;padding:20px;color:var(--text-muted)">جارٍ التحليل...</div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🏆 الموظفون النموذجيون</div></div>
          <div class="card-body" id="topEmpsBox"><div style="text-align:center;padding:20px;color:var(--text-muted)">جارٍ التحميل...</div></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">حضور اليوم</div></div>
          <div class="table-wrap" style="max-height:360px;overflow-y:auto">
            <table>
              <thead><tr><th>الموظف</th><th>دخول</th><th>خروج</th><th>الحالة</th></tr></thead>
              <tbody id="todayTable"><tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">آخر النشاطات</div></div>
          <div id="recentBox" style="max-height:360px;overflow-y:auto;padding:6px"><div style="padding:20px;color:var(--text-muted);text-align:center">جارٍ التحميل...</div></div>
        </div>
      </div>
    </div>
  `);

  if (!orgId) return;
  const [emps, today] = await Promise.all([
    api.get('employees', `?org_id=eq.${orgId}&select=id,name,dept`),
    api.get('attendance', `?org_id=eq.${orgId}&date=eq.${todayStr}&select=*,employees(name,dept)`)
  ]);
  const empArr = Array.isArray(emps) ? emps : [];
  const attArr = Array.isArray(today) ? today : [];

  const present = attArr.filter(a => a.status==='present' || a.status==='late').length;
  const late    = attArr.filter(a => a.status==='late').length;
  document.getElementById('statPresent').textContent = present;
  document.getElementById('statLate').textContent    = late;
  document.getElementById('statTotal').textContent   = empArr.length;
  document.getElementById('statAbsent').textContent  = Math.max(0, empArr.length - present);

  // today table
  const tbody = document.getElementById('todayTable');
  if (!attArr.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted)">لا يوجد سجل اليوم</td></tr>';
  } else {
    tbody.innerHTML = attArr.slice(0,30).map(a => `<tr>
      <td>${esc(a.employees?.name) || '—'}</td>
      <td style="color:var(--text-muted)">${(a.check_in||'').slice(0,5) || '—'}</td>
      <td style="color:var(--text-muted)">${(a.check_out||'').slice(0,5) || '—'}</td>
      <td>${statusBadge(a.status)}</td>
    </tr>`).join('');
  }

  // recent
  const records = await api.get('raw_records', `?org_id=eq.${orgId}&select=*,employees(name)&order=created_at.desc&limit=15`);
  const recBox = document.getElementById('recentBox');
  if (!Array.isArray(records) || !records.length) {
    recBox.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">لا توجد نشاطات</div>';
  } else {
    recBox.innerHTML = records.map(r => `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600;font-size:13px">${esc(r.employees?.name) || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted)">${r.is_entry ? '🟢 دخول' : '🔴 خروج'} · ${(r.record_time||'').slice(0,5)}</div>
        </div>
        <div style="font-size:11px;color:var(--text-dim)">${r.record_date}</div>
      </div>
    `).join('');
  }

  // AI + Top Employees
  dashRefreshAI();
  dashLoadTopEmps();
  dashLoadBuilding();
}

async function dashRefreshAI() {
  const box = document.getElementById('aiBox');
  if (!box) return;
  box.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">جارٍ التحليل...</div>';
  try {
    const r = await api.rpc('ai_analytics', { p_org_id: orgId });
    if (!r) { box.innerHTML = '<div style="color:var(--text-muted)">لا توجد بيانات</div>'; return; }
    box.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--surface3);border-radius:8px;padding:11px"><div style="font-size:11px;color:var(--text-muted)">📈 أكثر يوم حضوراً</div><div style="font-weight:600;font-size:14px;margin-top:2px">${r.peak_attendance_day || '—'}</div></div>
        <div style="background:var(--surface3);border-radius:8px;padding:11px"><div style="font-size:11px;color:var(--text-muted)">📉 أكثر يوم غياباً</div><div style="font-weight:600;font-size:14px;margin-top:2px">${r.worst_absence_day || '—'}</div></div>
        <div style="background:var(--surface3);border-radius:8px;padding:11px"><div style="font-size:11px;color:var(--text-muted)">⏰ ساعة الذروة</div><div style="font-weight:600;font-size:14px;margin-top:2px">${r.peak_checkin_hour !== null ? r.peak_checkin_hour + ':00' : '—'}</div></div>
        <div style="background:var(--surface3);border-radius:8px;padding:11px"><div style="font-size:11px;color:var(--text-muted)">⏱ متوسط التأخير</div><div style="font-weight:600;font-size:14px;margin-top:2px">${r.avg_late_minutes !== null ? r.avg_late_minutes + ' د' : '—'}</div></div>
      </div>`;
  } catch(e) { box.innerHTML = '<div style="color:var(--danger)">خطأ</div>'; }
}

async function dashLoadTopEmps() {
  const box = document.getElementById('topEmpsBox');
  if (!box) return;
  try {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 30);
    const r = await api.rpc('top_employees', {
      p_org_id: orgId, p_from: fmtDate(from), p_to: fmtDate(today), p_limit: 5
    });
    if (!Array.isArray(r) || !r.length) {
      box.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px">لا توجد بيانات</div>';
      return;
    }
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    box.innerHTML = r.map((e, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:20px">${medals[i] || ''}</div>
        <div style="flex:1">
          <a href="shell.html#employee/${e.emp_id}" style="font-weight:600;color:inherit;text-decoration:none">${esc(e.name) || '—'}</a>
          <div style="font-size:11px;color:var(--text-muted)">${e.present_days||0} حاضر · ${e.late_days||0} تأخير · ${e.absent_days||0} غياب</div>
        </div>
        <div style="text-align:left">
          <div style="font-weight:700;color:var(--accent)">${e.attendance_rate||0}%</div>
          <div style="font-size:10px;color:var(--text-muted)">${e.score||0} نقطة</div>
        </div>
      </div>
    `).join('');
  } catch(e) { box.innerHTML = '<div style="color:var(--danger)">خطأ</div>'; }
}

// ============================================================================
// 🏢 BUILDING LIVE VIEW WIDGET
// ============================================================================
let _buildingClockInterval = null;
let _buildingEmpsData = [];

function dashStartBuildingClock() {
  if (_buildingClockInterval) clearInterval(_buildingClockInterval);
  const tick = () => {
    const el = document.getElementById('buildingClock');
    if (!el) { clearInterval(_buildingClockInterval); return; }
    const now = new Date();
    el.textContent = now.toLocaleTimeString('ar-TN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  _buildingClockInterval = setInterval(tick, 1000);
}

async function dashLoadBuilding() {
  const box = document.getElementById('buildingBox');
  if (!box) return;

  try {
    // 1) كل الموظفين + 2) حضور اليوم + 3) صور آخر pointage
    const [emps, atts, photos] = await Promise.all([
      api.get('employees', `?org_id=eq.${orgId}&select=id,name,emp_code,category,dept,photo_url&order=name.asc`),
      api.get('attendance', `?org_id=eq.${orgId}&date=eq.${todayStr}&select=emp_id,status,check_in,check_out`),
      api.get('raw_records', `?org_id=eq.${orgId}&record_date=eq.${todayStr}&select=emp_id,raw&order=created_at.desc&limit=200`)
    ]);

    const empList = Array.isArray(emps) ? emps : [];
    const attList = Array.isArray(atts) ? atts : [];
    const photoList = Array.isArray(photos) ? photos : [];

    // map: emp_id -> attendance
    const attMap = {};
    attList.forEach(a => attMap[a.emp_id] = a);

    // map: emp_id -> أول photo_url لقيناه (من اليوم)
    const photoMap = {};
    photoList.forEach(r => {
      if (!photoMap[r.emp_id] && r.raw && r.raw.photo_url) photoMap[r.emp_id] = r.raw.photo_url;
    });

    // تجميع الموظفين حسب الفئة
    const groups = { teacher: [], admin: [], worker: [] };
    empList.forEach(e => {
      const att = attMap[e.id];
      let state = 'absent'; // افتراضي: غائب
      if (att) {
        if (att.status === 'leave') state = 'leave';
        else if (att.check_in && !att.check_out) state = 'inside';
        else if (att.check_in && att.check_out) state = 'left';
        else if (att.status === 'present' || att.status === 'late') state = 'inside';
      }
      const photo = photoMap[e.id] || e.photo_url || null;
      const data = { id: e.id, name: e.name, code: e.emp_code, dept: e.dept, state, photo,
                     checkIn: att?.check_in, checkOut: att?.check_out };
      const cat = e.category || 'admin';
      if (groups[cat]) groups[cat].push(data);
      else groups.admin.push(data);
    });
    _buildingEmpsData = groups;

    // إحصاءات
    const all = [...groups.teacher, ...groups.admin, ...groups.worker];
    const inside = all.filter(e => e.state === 'inside').length;
    const left = all.filter(e => e.state === 'left').length;
    const absent = all.filter(e => e.state === 'absent').length;
    const onLeave = all.filter(e => e.state === 'leave').length;

    box.innerHTML = dashRenderBuilding(groups, { inside, left, absent, onLeave, total: all.length });
    dashStartBuildingClock();

  } catch(err) {
    console.error('Building widget error:', err);
    box.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">⚠️ خطأ في تحميل المنظور</div>';
  }
}

function dashRenderBuilding(groups, stats) {
  const renderEmp = (e, inside) => {
    const initial = esc((e.name || '?')[0]);
    const safePhoto = (e.photo && /^https?:\/\//.test(e.photo))
      ? e.photo.replace(/['"\\]/g,'') : null;
    const bgStyle = safePhoto ? `background-image:url('${safePhoto}');background-size:cover;background-position:center` : '';
    const ringColor = inside ? '#10b981' : (e.state === 'leave' ? '#f59e0b' : (e.state === 'left' ? '#3b82f6' : '#ef4444'));
    const stateIcon = inside ? '🟢' : (e.state === 'leave' ? '🟡' : (e.state === 'left' ? '🔵' : '🔴'));
    const tooltip = e.state === 'inside' ? `حاضر منذ ${(e.checkIn||'').slice(0,5)}` :
                    e.state === 'left'   ? `خرج في ${(e.checkOut||'').slice(0,5)}` :
                    e.state === 'leave'  ? 'في إجازة' : 'غائب';
    return `
      <div class="bld-emp" title="${esc(e.name)} — ${tooltip}" onclick="window.location.href='shell.html#employee/${esc(e.id)}'">
        <div class="bld-avatar" style="${bgStyle};border-color:${ringColor}">
          ${!safePhoto ? initial : ''}
          <div class="bld-state-dot">${stateIcon}</div>
        </div>
        <div class="bld-name">${esc(e.name||'')}</div>
      </div>`;
  };

  const renderGroup = (list, title, icon) => {
    // فلتر: فقط الموظفين داخل المبنى
    const insideOnly = list.filter(e => e.state === 'inside');
    if (!list.length) return `<div class="bld-section-empty">${icon} لا يوجد ${title}</div>`;
    if (!insideOnly.length) {
      return `
        <div class="bld-section-title">${icon} ${title} (0/${list.length})</div>
        <div class="bld-section-empty" style="padding:24px 8px">⏳ لا أحد بعد</div>`;
    }
    return `
      <div class="bld-section-title">${icon} ${title} (${insideOnly.length}/${list.length})</div>
      <div class="bld-section-grid">${insideOnly.map(e => renderEmp(e, true)).join('')}</div>`;
  };

  // الموظفين خارج المبنى (غائبين + خرجوا + إجازة)
  const outsideAll = [
    ...groups.teacher.filter(e => e.state !== 'inside'),
    ...groups.admin.filter(e => e.state !== 'inside'),
    ...groups.worker.filter(e => e.state !== 'inside')
  ];

  return `
  <div class="building-wrap">
    <!-- إحصاءات سريعة فوق المبنى -->
    <div class="bld-stats">
      <div class="bld-stat" style="color:#10b981">🟢 داخل: <strong>${stats.inside}</strong></div>
      <div class="bld-stat" style="color:#3b82f6">🔵 خرج: <strong>${stats.left}</strong></div>
      <div class="bld-stat" style="color:#ef4444">🔴 غائب: <strong>${stats.absent}</strong></div>
      <div class="bld-stat" style="color:#f59e0b">🟡 إجازة: <strong>${stats.onLeave}</strong></div>
      <div class="bld-stat" style="color:var(--text-muted)">📋 الإجمالي: <strong>${stats.total}</strong></div>
    </div>

    <!-- 🏢 المبنى -->
    <div class="building">
      <!-- السقف الأوسط الكبير -->
      <div class="bld-roof-center"></div>
      <div class="bld-flag bld-flag-left"></div>
      <div class="bld-flag bld-flag-right"></div>

      <!-- 3 أجنحة -->
      <div class="bld-wings">
        <!-- الجناح الأيمن: الإدارة -->
        <div class="bld-wing bld-wing-right">
          <div class="bld-wing-roof"></div>
          <div class="bld-wing-body">
            ${renderGroup(groups.admin, 'الإدارة', '💼')}
          </div>
        </div>

        <!-- الجناح الأوسط: الأساتذة -->
        <div class="bld-wing bld-wing-center">
          <div class="bld-wing-body bld-wing-center-body">
            <div class="bld-clock-wall">
              <div class="bld-clock-face">
                <div class="bld-clock-hand-h"></div>
                <div class="bld-clock-hand-m"></div>
                <div class="bld-clock-center"></div>
              </div>
            </div>
            <div class="bld-org-name">${esc(user.org_name || 'المؤسسة')}</div>
            ${renderGroup(groups.teacher, 'الأساتذة', '🎓')}
            <div class="bld-door">
              <div class="bld-door-roof"></div>
              <div class="bld-door-panels">
                <div class="bld-door-panel"></div>
                <div class="bld-door-panel"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- الجناح الأيسر: العملة -->
        <div class="bld-wing bld-wing-left">
          <div class="bld-wing-roof"></div>
          <div class="bld-wing-body">
            ${renderGroup(groups.worker, 'العملة', '🛠')}
          </div>
        </div>
      </div>
    </div>

    <!-- 🚶 خارج المبنى -->
    <div class="bld-outside">
      <div class="bld-outside-title">🚶 خارج المبنى</div>
      ${outsideAll.length === 0
        ? '<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:13px">🎉 الجميع في المبنى!</div>'
        : `<div class="bld-section-grid">${outsideAll.map(e => renderEmp(e, false)).join('')}</div>`
      }
    </div>

    <!-- 🌳 الأرض -->
    <div class="bld-ground"></div>
  </div>`;
}

function dashRefreshBuilding() {
  dashLoadBuilding();
}

async function loadEmployeesView() {
  setHeader('الموظفون', 'إدارة قائمة الموظفين', `
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('csvImportInput').click()">📥 استيراد CSV</button>
    <input type="file" id="csvImportInput" accept=".csv" style="display:none" onchange="window.spa.empCSVImport(event)">
    <button class="btn btn-ghost btn-sm" onclick="window.spa.empExportCSV()">📤 تصدير CSV</button>
    <button class="btn btn-accent btn-sm" onclick="window.spa.empOpenAdd()">+ إضافة موظف</button>
  `);

  setView(`
    <div class="page-content">
      <div class="card">
        <div class="card-header">
          <div class="flex gap-8 items-center" style="flex:1;flex-wrap:wrap">
            <input type="text" class="form-control" placeholder="بحث..." id="empSearch" oninput="window.spa.empFilter()" style="width:220px">
            <select class="form-control" id="empCategoryFilter" onchange="window.spa.empFilter()" style="width:150px">
              <option value="">كل الفئات</option>
              <option value="teacher">🎓 أساتذة</option>
              <option value="admin">💼 إداريين</option>
              <option value="worker">🛠 عملة</option>
            </select>
            <select class="form-control" id="empDeptFilter" onchange="window.spa.empFilter()" style="width:160px">
              <option value="">جميع الأقسام</option>
            </select>
            <span id="empCount" style="font-size:13px;color:var(--text-muted);margin-right:auto"></span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>الكود</th><th>الموظف</th><th>الفئة</th><th>القسم</th>
              <th>الهاتف</th><th>حالة اليوم</th><th>مزامن</th><th>إجراءات</th>
            </tr></thead>
            <tbody id="empTableBody"><tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);

  const [emps, att] = await Promise.all([
    api.get('employees', `?org_id=eq.${orgId}&order=name.asc`),
    api.get('attendance', `?org_id=eq.${orgId}&date=eq.${todayStr}&select=emp_id,status,check_in,check_out`)
  ]);
  _empAllEmps = Array.isArray(emps) ? emps : [];
  _empTodayAtt = {};
  (Array.isArray(att) ? att : []).forEach(a => _empTodayAtt[a.emp_id] = a);

  document.getElementById('empCount').textContent = `${_empAllEmps.length} موظف`;
  const depts = [...new Set(_empAllEmps.map(e => e.dept).filter(Boolean))];
  document.getElementById('empDeptFilter').innerHTML =
    '<option value="">جميع الأقسام</option>' + depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  empRender(_empAllEmps);
}

function empRender(arr) {
  const tbody = document.getElementById('empTableBody');
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">لا يوجد موظفون</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = arr.map(e => {
    const att = _empTodayAtt[e.id];
    const color = '#3b82f6';
    return `<tr>
      <td><code style="background:var(--surface3);padding:3px 8px;border-radius:5px;font-size:12px">${esc(e.emp_code)}</code></td>
      <td>
        <a href="shell.html#employee/${e.id}" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit">
          <div style="width:34px;height:34px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${esc((e.name||'?')[0])}</div>
          <div style="font-weight:600">${esc(e.name)}</div>
        </a>
      </td>
      <td>${categoryBadge(e.category)}</td>
      <td style="color:var(--text-muted)">${esc(e.dept) || '—'}</td>
      <td style="color:var(--text-muted);font-size:13px">${esc(e.phone) || '—'}</td>
      <td>${att ? statusBadge(att.status) : '<span class="badge badge-danger">لم يحضر</span>'}</td>
      <td>${e.synced_to_device ? '<span class="badge badge-success">مزامن ✓</span>' : '<span class="badge badge-warning">—</span>'}</td>
      <td>
        <div class="flex gap-8">
          <a class="btn btn-accent btn-sm btn-icon" href="shell.html#employee/${e.id}" title="عرض">👁</a>
          <button class="btn btn-ghost btn-sm btn-icon" onclick='window.spa.empEdit(${jsonAttr(e)})'>✎</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="window.spa.empDelete('${e.id}','${esc((e.name||'').replace(/['"\\]/g,''))}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function empFilter() {
  const q = document.getElementById('empSearch').value.toLowerCase();
  const dept = document.getElementById('empDeptFilter').value;
  const cat = document.getElementById('empCategoryFilter').value;
  empRender(_empAllEmps.filter(e =>
    (!q || (e.name||'').toLowerCase().includes(q) || (e.emp_code||'').toLowerCase().includes(q)) &&
    (!dept || e.dept === dept) &&
    (!cat  || e.category === cat)
  ));
}

function buildWorkDaysPicker(containerId, selected) {
  const c = document.getElementById(containerId);
  if (!c) return;
  const sel = new Set(selected || DEFAULT_WORK_DAYS);
  c.innerHTML = WEEK_DAYS.map(d => `<div class="work-day-chip ${sel.has(d.code) ? 'active' : ''}" data-code="${d.code}">${d.short}</div>`).join('');
  c.querySelectorAll('.work-day-chip').forEach(el => { el.onclick = () => el.classList.toggle('active'); });
}
function getPickerValue(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .work-day-chip.active')).map(el => el.getAttribute('data-code'));
}

function empOpenAdd() {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="addEmpModal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">إضافة موظف جديد</div>
          <button class="modal-close" onclick="closeModal('addEmpModal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">الاسم *</label><input type="text" class="form-control" id="addName"></div>
            <div class="form-group"><label class="form-label">الكود *</label><input type="text" class="form-control" id="addCode"></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">القسم</label><input type="text" class="form-control" id="addDept"></div>
            <div class="form-group"><label class="form-label">الهاتف</label><input type="text" class="form-control" id="addPhone"></div>
          </div>
          <div class="form-group">
            <label class="form-label">الفئة</label>
            <select class="form-control" id="addCategory">
              <option value="">اختر...</option>
              <option value="teacher">🎓 أساتذة</option>
              <option value="admin">💼 إداريين</option>
              <option value="worker">🛠 عملة</option>
            </select>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">بداية الدوام</label><input type="time" class="form-control" id="addShiftStart" value="08:00"></div>
            <div class="form-group"><label class="form-label">نهاية الدوام</label><input type="time" class="form-control" id="addShiftEnd" value="16:00"></div>
          </div>
          <div class="form-group">
            <label class="form-label">أيام العمل</label>
            <div id="addWorkDays" class="work-days-picker"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('addEmpModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.empAdd()">حفظ</button>
        </div>
      </div>
    </div>
  `);
  buildWorkDaysPicker('addWorkDays', DEFAULT_WORK_DAYS);
}

async function empAdd() {
  const name = document.getElementById('addName').value.trim();
  const code = document.getElementById('addCode').value.trim();
  if (!name || !code) { toast.error('الاسم والكود مطلوبان'); return; }
  const existing = await api.get('employees', `?org_id=eq.${orgId}&emp_code=eq.${code}`);
  if (Array.isArray(existing) && existing.length) { toast.error('كود الموظف موجود مسبقاً'); return; }

  const wd = getPickerValue('addWorkDays');
  const res = await api.post('employees', {
    org_id: orgId, name, emp_code: code,
    dept: document.getElementById('addDept').value.trim(),
    phone: document.getElementById('addPhone').value.trim(),
    category: document.getElementById('addCategory').value || null,
    shift_start: document.getElementById('addShiftStart').value,
    shift_end: document.getElementById('addShiftEnd').value,
    work_days: wd.length ? wd : DEFAULT_WORK_DAYS
  });
  if (Array.isArray(res) && res[0]) {
    toast.success('تم الإضافة');
    closeModal('addEmpModal');
    loadEmployeesView();
  } else toast.error('خطأ');
}

function empEdit(e) {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="editEmpModal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">تعديل موظف</div>
          <button class="modal-close" onclick="closeModal('editEmpModal')">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="editEmpId">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">الاسم</label><input type="text" class="form-control" id="editName"></div>
            <div class="form-group"><label class="form-label">الكود</label><input type="text" class="form-control" id="editCode"></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">القسم</label><input type="text" class="form-control" id="editDept"></div>
            <div class="form-group"><label class="form-label">الهاتف</label><input type="text" class="form-control" id="editPhone"></div>
          </div>
          <div class="form-group">
            <label class="form-label">الفئة</label>
            <select class="form-control" id="editCategory">
              <option value="">—</option>
              <option value="teacher">🎓 أساتذة</option>
              <option value="admin">💼 إداريين</option>
              <option value="worker">🛠 عملة</option>
            </select>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">بداية الدوام</label><input type="time" class="form-control" id="editShift"></div>
            <div class="form-group"><label class="form-label">نهاية الدوام</label><input type="time" class="form-control" id="editShiftEnd"></div>
          </div>
          <div class="form-group">
            <label class="form-label">أيام العمل</label>
            <div id="editWorkDays" class="work-days-picker"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('editEmpModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.empSave()">حفظ</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById('editEmpId').value     = e.id;
  document.getElementById('editName').value      = e.name || '';
  document.getElementById('editCode').value      = e.emp_code || '';
  document.getElementById('editDept').value      = e.dept || '';
  document.getElementById('editPhone').value     = e.phone || '';
  document.getElementById('editCategory').value  = e.category || '';
  document.getElementById('editShift').value     = (e.shift_start || '08:00').slice(0,5);
  document.getElementById('editShiftEnd').value  = (e.shift_end || '16:00').slice(0,5);
  buildWorkDaysPicker('editWorkDays', e.work_days || DEFAULT_WORK_DAYS);
}

async function empSave() {
  const id = document.getElementById('editEmpId').value;
  const res = await api.patch('employees', id, {
    name:        document.getElementById('editName').value,
    emp_code:    document.getElementById('editCode').value,
    dept:        document.getElementById('editDept').value,
    phone:       document.getElementById('editPhone').value,
    category:    document.getElementById('editCategory').value || null,
    shift_start: document.getElementById('editShift').value,
    shift_end:   document.getElementById('editShiftEnd').value,
    work_days:   getPickerValue('editWorkDays'),
    synced_to_device: false
  });
  if (Array.isArray(res)) { toast.success('تم التحديث'); closeModal('editEmpModal'); loadEmployeesView(); }
  else toast.error('خطأ');
}

async function empDelete(id, name) {
  if (!confirm(`حذف ${name}؟`)) return;
  await api.delete('employees', id);
  toast.success('تم الحذف');
  loadEmployeesView();
}

function empExportCSV() {
  const csvEscape = (v) => {
    const s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const rows = [['الكود','الاسم','الفئة','القسم','الهاتف','مزامن']];
  _empAllEmps.forEach(e => rows.push([
    e.emp_code, e.name, categoryLabel(e.category), e.dept||'', e.phone||'', e.synced_to_device?'نعم':'لا'
  ]));
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `employees_${todayStr}.csv`;
  a.click();
}

async function empCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = '';
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return toast.error('الملف فارغ');

  // CSV parser يحترم الـ quotes
  function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const idx = (k) => header.findIndex(h => h.includes(k));
  const codeI = idx('code') >= 0 ? idx('code') : idx('كود');
  const nameI = idx('name') >= 0 ? idx('name') : idx('اسم');
  const deptI = idx('dept') >= 0 ? idx('dept') : idx('قسم');
  const phoneI = idx('phone') >= 0 ? idx('phone') : idx('هاتف');
  const catI = idx('categ') >= 0 ? idx('categ') : idx('فئ');
  if (codeI < 0 || nameI < 0) return toast.error('الملف يحتاج: code, name');

  const CAT_MAP = {'teacher':'teacher','أساتذة':'teacher','اساتذة':'teacher','admin':'admin','إداريين':'admin','اداريين':'admin','worker':'worker','عملة':'worker','عمال':'worker'};
  const employees = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[codeI] || !cols[nameI]) continue;
    employees.push({
      emp_code: cols[codeI], name: cols[nameI],
      dept: deptI >= 0 ? (cols[deptI] || null) : null,
      phone: phoneI >= 0 ? (cols[phoneI] || null) : null,
      category: catI >= 0 && cols[catI] ? (CAT_MAP[cols[catI].toLowerCase()] || null) : null
    });
  }
  if (!employees.length) return toast.error('لم نعثر على بيانات');
  if (!confirm(`استيراد ${employees.length} موظف؟`)) return;
  try {
    const r = await api.rpc('import_employees_bulk', { p_org_id: orgId, p_employees: employees });
    if (r && r.success) { toast.success(`✅ ${r.inserted} موظف، تخطّينا ${r.skipped}`); loadEmployeesView(); }
    else toast.error('خطأ');
  } catch(err) { toast.error('خطأ'); }
}

// ============================================================================
// VIEW: EMPLOYEE DETAILS
// ============================================================================
let _emp = null, _empAtts = [], _empPeriod = 'week';

async function loadEmployeeView(params) {
  const empId = params?.id;
  if (!empId) return navigate('employees');

  setHeader('تفاصيل الموظف', 'جارٍ التحميل...', `
    <a href="shell.html#employees" class="btn btn-ghost btn-sm">← العودة</a>
    <button class="btn btn-ghost btn-sm" onclick="window.spa.empDetailPDF()">📄 PDF</button>
    <button class="btn btn-ghost btn-sm" onclick="window.spa.empDetailWord()">📝 Word</button>
    <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨</button>
  `);

  const [emps, atts] = await Promise.all([
    api.get('employees', `?id=eq.${empId}&limit=1`),
    api.get('attendance', `?emp_id=eq.${empId}&order=date.desc&limit=200`)
  ]);
  _emp = Array.isArray(emps) && emps[0];
  _empAtts = Array.isArray(atts) ? atts : [];

  if (!_emp) {
    setView('<div class="page-content"><div style="text-align:center;padding:60px;color:var(--danger)">الموظف غير موجود</div></div>');
    return;
  }
  setHeader(_emp.name || '—', `${categoryLabel(_emp.category)} ${_emp.dept ? '— ' + _emp.dept : ''} — ${_emp.emp_code}`);
  empDetailRender();
}

function empDetailRender() {
  const initial = esc((_emp.name || '?')[0]);
  // أمان: نقبل فقط URLs http/https
  const safePhotoUrl = (_emp.photo_url && /^https?:\/\//.test(_emp.photo_url))
    ? _emp.photo_url.replace(/['"\\]/g,'')
    : null;
  const photoStyle = safePhotoUrl ? `background-image:url('${safePhotoUrl}');background-size:cover` : '';

  setView(`
    <div class="page-content">
      <div class="card mb-20">
        <div class="card-body">
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
            <div class="photo-circle" style="${photoStyle}">${!_emp.photo_url ? initial : ''}</div>
            <div style="flex:1;min-width:200px">
              <div style="font-size:22px;font-weight:700;margin-bottom:6px">${esc(_emp.name) || '—'}</div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                ${categoryBadge(_emp.category)}
                <span class="badge badge-info">كود: ${esc(_emp.emp_code)}</span>
                ${_emp.synced_to_device ? '<span class="badge badge-success">مزامن ✓</span>' : '<span class="badge badge-warning">غير مزامن</span>'}
              </div>
              <div class="info-grid">
                <div class="info-cell"><div class="info-cell-label">القسم</div><div class="info-cell-val">${esc(_emp.dept) || '—'}</div></div>
                <div class="info-cell"><div class="info-cell-label">الهاتف</div><div class="info-cell-val">${esc(_emp.phone) || '—'}</div></div>
                <div class="info-cell"><div class="info-cell-label">بداية الدوام</div><div class="info-cell-val">${(_emp.shift_start||'08:00').slice(0,5)}</div></div>
                <div class="info-cell"><div class="info-cell-label">نهاية الدوام</div><div class="info-cell-val">${(_emp.shift_end||'16:00').slice(0,5)}</div></div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px" class="no-print">
              <button class="btn btn-primary btn-sm" onclick="window.spa.empDetailEdit()">✎ تعديل</button>
              <button class="btn btn-ghost btn-sm" onclick="window.spa.empDetailSync()">🔄 مزامنة</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:10px">
          <div class="card-title">السجل الزمني</div>
          <div class="period-tabs no-print">
            <button class="period-tab ${_empPeriod==='day'?'active':''}"   onclick="window.spa.empSetPeriod('day')">اليوم</button>
            <button class="period-tab ${_empPeriod==='week'?'active':''}"  onclick="window.spa.empSetPeriod('week')">أسبوع</button>
            <button class="period-tab ${_empPeriod==='month'?'active':''}" onclick="window.spa.empSetPeriod('month')">شهر</button>
          </div>
        </div>
        <div class="card-body">
          <div class="legend">
            <div class="legend-chip"><div class="legend-dot" style="background:#2563eb;opacity:0.55"></div> الوقت الرسمي</div>
            <div class="legend-chip"><div class="legend-dot" style="background:#10b981"></div> الحضور الفعلي</div>
          </div>
          <div id="timelineBox"></div>
        </div>
      </div>
    </div>
  `);
  empDetailRenderTimeline();
}

function empSetPeriod(p) { _empPeriod = p; empDetailRender(); }

function empDetailRenderTimeline() {
  const today = new Date();
  let from = today, to = today;
  if (_empPeriod === 'week')  { from = new Date(today); from.setDate(today.getDate() - 6); }
  if (_empPeriod === 'month') { from = new Date(today.getFullYear(), today.getMonth(), 1); }

  const days = [];
  const cur = new Date(from);
  while (cur <= to) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const attMap = {};
  _empAtts.forEach(a => attMap[a.date] = a);

  const box = document.getElementById('timelineBox');
  box.innerHTML = days.reverse().map(d => {
    const ds = fmtDate(d);
    const att = attMap[ds];
    const isWork = isWorkDay(_emp.work_days, ds);
    const dow = WEEK_DAYS[d.getDay()];
    return empRenderDayRow(ds, `${dow.short}<br><span style="font-size:11px;color:var(--text-muted)">${ds}</span>`, att, isWork);
  }).join('');
}

function empRenderDayRow(date, dayLabel, att, isWork) {
  const shiftStart = (_emp.shift_start || '08:00').slice(0,5);
  const shiftEnd   = (_emp.shift_end   || '16:00').slice(0,5);
  const startMin = timeToMin(shiftStart);
  const endMin   = Math.max(timeToMin(shiftEnd), startMin + 1);
  const officialLeft  = (startMin / 1440) * 100;
  const officialWidth = ((endMin - startMin) / 1440) * 100;

  let actualBar = '', summary = '';
  if (att && (att.check_in || att.check_out)) {
    let inMin  = att.check_in  ? timeToMin(att.check_in)  : null;
    let outMin = att.check_out ? timeToMin(att.check_out) : null;
    if (inMin !== null && outMin !== null && outMin < inMin) [inMin,outMin] = [outMin,inMin];

    if (inMin !== null && outMin !== null) {
      const left  = (inMin / 1440) * 100;
      const width = Math.max(((outMin - inMin) / 1440) * 100, 0.4);
      actualBar = `<div class="timeline-bar-actual" style="right:${left}%;width:${width}%"></div>
        <div class="timeline-label" style="right:${left}%;top:42px">${att.check_in.slice(0,5)}</div>
        <div class="timeline-label" style="right:${(outMin/1440)*100}%;top:42px">${att.check_out.slice(0,5)}</div>`;
    } else if (inMin !== null) {
      const left = (inMin / 1440) * 100;
      actualBar = `<div class="timeline-bar-actual" style="right:${left}%;width:1.5%"></div>
        <div class="timeline-label" style="right:${left}%;top:42px">${att.check_in.slice(0,5)}</div>`;
    }

    const realIn  = att.check_in  ? timeToMin(att.check_in)  : null;
    const realOut = att.check_out ? timeToMin(att.check_out) : null;
    const lateIn   = realIn  !== null ? realIn  - startMin : null;
    const earlyOut = realOut !== null ? endMin - realOut   : null;
    let s = `<strong>دخول:</strong> ${att.check_in ? att.check_in.slice(0,5) : '—'}<br><strong>خروج:</strong> ${att.check_out ? att.check_out.slice(0,5) : '—'}<br>`;
    if (lateIn !== null) s += lateIn > 0 ? `<span class="late-text">⏰ متأخر ${lateIn} د</span><br>` : `<span class="early-text">✓ في الموعد</span><br>`;
    if (earlyOut !== null) s += earlyOut > 0 ? `<span class="late-text">🚪 خروج مبكر ${earlyOut} د</span>` : `<span class="early-text">✓ خروج كامل</span>`;
    summary = s;
  } else if (isWork) summary = '<span style="color:var(--danger);font-weight:600">❌ غائب</span>';
  else summary = '<span style="color:var(--text-dim)">يوم راحة</span>';

  let ticks = '';
  for (let h = 0; h <= 24; h += 4) {
    const left = (h * 60 / 1440) * 100;
    ticks += `<div class="timeline-tick ${h%8===0?'major':''}" style="right:${left}%">${String(h).padStart(2,'0')}</div>`;
  }
  const officialBar = isWork ? `<div class="timeline-bar-official" style="right:${officialLeft}%;width:${officialWidth}%"></div>` : (att ? '' : '<div class="timeline-empty">يوم راحة</div>');
  const editBtn = isSA && att ? `<button class="btn btn-ghost btn-sm no-print" onclick='window.spa.empEditAtt(${jsonAttr(att)})' style="padding:4px 8px;font-size:11px">✎</button>` : '';

  return `<div class="day-row ${!isWork && !att ? 'absent-day' : ''}">
    <div><div class="day-label">${dayLabel}</div></div>
    <div class="timeline-day">${officialBar}${actualBar}${ticks}</div>
    <div class="day-summary">${summary} ${editBtn}</div>
  </div>`;
}

function empDetailEdit() {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="editEmpDetModal">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">تعديل بيانات الموظف</div>
          <button class="modal-close" onclick="closeModal('editEmpDetModal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">الاسم</label><input type="text" class="form-control" id="edName"></div>
            <div class="form-group"><label class="form-label">الكود</label><input type="text" class="form-control" id="edCode"></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">القسم</label><input type="text" class="form-control" id="edDept"></div>
            <div class="form-group"><label class="form-label">الهاتف</label><input type="text" class="form-control" id="edPhone"></div>
          </div>
          <div class="form-group">
            <label class="form-label">الفئة</label>
            <select class="form-control" id="edCategory">
              <option value="">—</option>
              <option value="teacher">🎓 أساتذة</option>
              <option value="admin">💼 إداريين</option>
              <option value="worker">🛠 عملة</option>
            </select>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">بداية الدوام</label><input type="time" class="form-control" id="edShift"></div>
            <div class="form-group"><label class="form-label">نهاية الدوام</label><input type="time" class="form-control" id="edShiftEnd"></div>
          </div>
          <div class="form-group">
            <label class="form-label">أيام العمل</label>
            <div id="edWorkDays" class="work-days-picker"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('editEmpDetModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.empDetailSave()">حفظ</button>
        </div>
      </div>
    </div>
  `);
  document.getElementById('edName').value    = _emp.name || '';
  document.getElementById('edCode').value    = _emp.emp_code || '';
  document.getElementById('edDept').value    = _emp.dept || '';
  document.getElementById('edPhone').value   = _emp.phone || '';
  document.getElementById('edCategory').value= _emp.category || '';
  document.getElementById('edShift').value   = (_emp.shift_start || '08:00').slice(0,5);
  document.getElementById('edShiftEnd').value= (_emp.shift_end || '16:00').slice(0,5);
  buildWorkDaysPicker('edWorkDays', _emp.work_days || DEFAULT_WORK_DAYS);
}

async function empDetailSave() {
  const res = await api.patch('employees', _emp.id, {
    name: document.getElementById('edName').value,
    emp_code: document.getElementById('edCode').value,
    dept: document.getElementById('edDept').value,
    phone: document.getElementById('edPhone').value,
    category: document.getElementById('edCategory').value || null,
    shift_start: document.getElementById('edShift').value,
    shift_end: document.getElementById('edShiftEnd').value,
    work_days: getPickerValue('edWorkDays'),
    synced_to_device: false
  });
  if (Array.isArray(res)) { toast.success('تم الحفظ'); closeModal('editEmpDetModal'); loadEmployeeView({id: _emp.id}); }
  else toast.error('خطأ');
}

async function empDetailSync() {
  try {
    const res = await api.rpc('sync_employee_to_device', { p_emp_id: _emp.id });
    if (res && res.success) toast.success('جارٍ المزامنة...');
    else toast.error(res?.message || 'فشل');
  } catch(e) { toast.error('خطأ'); }
}

function empEditAtt(att) {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="editAttModal">
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <div class="modal-title">تعديل سجل الحضور</div>
          <button class="modal-close" onclick="closeModal('editAttModal')">✕</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="attId" value="${att.id}">
          <div class="form-group"><label class="form-label">التاريخ</label><input type="date" class="form-control" value="${att.date}" disabled></div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">دخول</label><input type="time" class="form-control" id="attIn" value="${(att.check_in||'').slice(0,5)}"></div>
            <div class="form-group"><label class="form-label">خروج</label><input type="time" class="form-control" id="attOut" value="${(att.check_out||'').slice(0,5)}"></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">بداية استراحة</label><input type="time" class="form-control" id="attBrkS" value="${(att.break_start||'').slice(0,5)}"></div>
            <div class="form-group"><label class="form-label">نهاية استراحة</label><input type="time" class="form-control" id="attBrkE" value="${(att.break_end||'').slice(0,5)}"></div>
          </div>
          <div class="form-group">
            <label class="form-label">الحالة</label>
            <select class="form-control" id="attStat">
              <option value="present" ${att.status==='present'?'selected':''}>حاضر</option>
              <option value="late" ${att.status==='late'?'selected':''}>متأخر</option>
              <option value="absent" ${att.status==='absent'?'selected':''}>غائب</option>
              <option value="leave" ${att.status==='leave'?'selected':''}>إجازة</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('editAttModal')">إلغاء</button>
          <button class="btn btn-danger" onclick="window.spa.empAttDel()">حذف</button>
          <button class="btn btn-primary" onclick="window.spa.empAttSave()">حفظ</button>
        </div>
      </div>
    </div>
  `);
}

async function empAttSave() {
  const id = document.getElementById('attId').value;
  const cin = document.getElementById('attIn').value || null;
  const cout = document.getElementById('attOut').value || null;
  const bs = document.getElementById('attBrkS').value || null;
  const be = document.getElementById('attBrkE').value || null;
  let bm = 0;
  if (bs && be) { const [bh,bmm]=bs.split(':').map(Number); const [eh,emm]=be.split(':').map(Number); bm = Math.max(0,(eh*60+emm)-(bh*60+bmm)); }
  let nh = null;
  if (cin && cout) { const [ih,im]=cin.split(':').map(Number); const [oh,om]=cout.split(':').map(Number); nh = Math.max(0, ((oh*60+om)-(ih*60+im)-bm)/60).toFixed(2); }
  const r = await api.patch('attendance', id, {
    check_in: cin, check_out: cout, break_start: bs, break_end: be, break_minutes: bm, net_hours: nh,
    status: document.getElementById('attStat').value, source: 'manual'
  });
  if (Array.isArray(r)) { toast.success('تم'); closeModal('editAttModal'); loadEmployeeView({id: _emp.id}); }
  else toast.error('خطأ');
}

async function empAttDel() {
  if (!confirm('حذف السجل؟')) return;
  await api.delete('attendance', document.getElementById('attId').value);
  toast.success('حُذف');
  closeModal('editAttModal');
  loadEmployeeView({id: _emp.id});
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

async function empDetailPDF() {
  toast.info('جارٍ التحضير...');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const el = document.getElementById('viewHost');
    const canvas = await html2canvas(el, { backgroundColor:'#0a0f1e', scale: 2 });
    const img = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = pdf.internal.pageSize.getWidth();
    pdf.addImage(img, 'PNG', 0, 0, w, (canvas.height * w) / canvas.width);
    pdf.save(`${(_emp.name||'employee').replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g,'_')}_${fmtDate(new Date())}.pdf`);
    toast.success('تم');
  } catch(e) { toast.error('فشل'); }
}

function empDetailWord() {
  const today = new Date();
  const from = _empPeriod === 'week' ? new Date(new Date().setDate(today.getDate()-6))
             : _empPeriod === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1)
             : today;
  const rows = _empAtts.filter(a => a.date >= fmtDate(from) && a.date <= fmtDate(today))
    .sort((a,b) => a.date.localeCompare(b.date));
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"></head><body style="font-family:Arial">
    <h2 style="text-align:center">سجل ${esc(_emp.name)}</h2>
    <p>القسم: ${esc(_emp.dept) || '—'} | الكود: ${esc(_emp.emp_code)}</p>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#eee"><th>التاريخ</th><th>دخول</th><th>خروج</th><th>الحالة</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.date}</td><td>${(r.check_in||'').slice(0,5)||'—'}</td><td>${(r.check_out||'').slice(0,5)||'—'}</td><td>${r.status}</td></tr>`).join('')}</tbody>
    </table></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(_emp.name||'employee').replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g,'_')}_${fmtDate(new Date())}.doc`;
  a.click();
  toast.success('تم');
}

// ============================================================================
// إكسبورت للـ window (للـ onclick handlers)
// ============================================================================
window.spa = {
  navigate, dashRefreshAI, dashRefreshBuilding, setHeader, setView, addModal, clearModals,
  empFilter, empOpenAdd, empAdd, empEdit, empSave, empDelete, empExportCSV, empCSVImport,
  empSetPeriod, empDetailEdit, empDetailSave, empDetailSync,
  empEditAtt, empAttSave, empAttDel, empDetailPDF, empDetailWord
};

// ============================================================================
// كل دوال SPA المتبقّية (Absentees, Leaves, Holidays, Alerts, Audit, Attendance,
//  Reports, Device, Settings, Superadmin) معرّفة أدناه
// ============================================================================


// ============================================================================================
// VIEW: ABSENTEES
// ============================================================================
let _absPeriod = 'day', _absRows = [];

async function loadAbsenteesView() {
  setHeader('الغيابات', 'قائمة الموظفين الغائبين', `
    <button class="btn btn-ghost btn-sm" onclick="window.spa.absExportCSV()">📥 تصدير CSV</button>
  `);
  setView(`
    <div class="page-content">
      <div class="card mb-20">
        <div class="card-body" style="padding:16px 22px">
          <div class="flex gap-12 items-center" style="flex-wrap:wrap">
            <div class="tabs" style="margin:0">
              <button class="tab-btn active" onclick="window.spa.absSetPeriod('day',this)">اليوم</button>
              <button class="tab-btn" onclick="window.spa.absSetPeriod('week',this)">أسبوع</button>
              <button class="tab-btn" onclick="window.spa.absSetPeriod('month',this)">شهر</button>
              <button class="tab-btn" onclick="window.spa.absSetPeriod('custom',this)">مخصص</button>
            </div>
            <div id="absCustomDates" style="display:none;gap:10px" class="flex">
              <input type="date" class="form-control" id="absFrom" style="width:150px">
              <input type="date" class="form-control" id="absTo" style="width:150px">
            </div>
            <select class="form-control" id="absCat" onchange="window.spa.absLoad()" style="width:160px">
              <option value="">كل الفئات</option>
              <option value="teacher">🎓 أساتذة</option>
              <option value="admin">💼 إداريين</option>
              <option value="worker">🛠 عملة</option>
            </select>
            <button class="btn btn-primary" onclick="window.spa.absLoad()">عرض</button>
          </div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card red"><div class="stat-icon">📋</div><div class="stat-value" id="absKpiTotal">—</div><div class="stat-label">إجمالي الغيابات</div></div>
        <div class="stat-card orange"><div class="stat-icon">👤</div><div class="stat-value" id="absKpiUnique">—</div><div class="stat-label">عدد الموظفين</div></div>
        <div class="stat-card blue"><div class="stat-icon">📅</div><div class="stat-value" id="absKpiDays">—</div><div class="stat-label">عدد الأيام</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">الغيابات</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>التاريخ</th><th>اليوم</th><th>الموظف</th><th>الفئة</th><th>القسم</th><th>الهاتف</th></tr></thead>
            <tbody id="absTable"><tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  absLoad();
}

function absSetPeriod(p, btn) {
  _absPeriod = p;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('absCustomDates').style.display = p === 'custom' ? 'flex' : 'none';
  if (p !== 'custom') absLoad();
}

function absGetRange() {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0,10);
  if (_absPeriod === 'day') return [fmt(today), fmt(today)];
  if (_absPeriod === 'week') { const s = new Date(today); s.setDate(today.getDate()-6); return [fmt(s), fmt(today)]; }
  if (_absPeriod === 'month'){ const s = new Date(today.getFullYear(), today.getMonth(), 1); return [fmt(s), fmt(today)]; }
  return [document.getElementById('absFrom').value, document.getElementById('absTo').value];
}

async function absLoad() {
  const [from, to] = absGetRange();
  if (!from || !to) { toast.error('حدد التاريخ'); return; }
  const cat = document.getElementById('absCat').value;
  let q = `?org_id=eq.${orgId}&order=name.asc`;
  if (cat) q += `&category=eq.${cat}`;
  const emps = await api.get('employees', q);
  const empList = Array.isArray(emps) ? emps : [];
  const att = await api.get('attendance', `?org_id=eq.${orgId}&date=gte.${from}&date=lte.${to}&select=emp_id,date,status`);
  const attList = Array.isArray(att) ? att : [];

  const presentMap = {}, explicitAbsent = {};
  attList.forEach(a => {
    if (['present','late','leave'].includes(a.status)) presentMap[`${a.emp_id}|${a.date}`] = true;
    if (a.status === 'absent') explicitAbsent[`${a.emp_id}|${a.date}`] = true;
  });

  const days = [];
  const cur = new Date(from); const end = new Date(to);
  while (cur <= end) { days.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }

  const rows = [];
  empList.forEach(e => {
    days.forEach(d => {
      if (!isWorkDay(e.work_days, d)) return;
      const key = `${e.id}|${d}`;
      if (!presentMap[key] || explicitAbsent[key]) rows.push({ emp: e, date: d });
    });
  });
  _absRows = rows;
  absRender(rows, days.length);
}

function absRender(rows, daysCount) {
  document.getElementById('absKpiTotal').textContent = rows.length;
  document.getElementById('absKpiUnique').textContent = new Set(rows.map(r => r.emp.id)).size;
  document.getElementById('absKpiDays').textContent = daysCount;
  const tbody = document.getElementById('absTable');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-title">لا توجد غيابات</div></div></td></tr>'; return; }
  rows.sort((a,b) => b.date.localeCompare(a.date) || (a.emp.name||'').localeCompare(b.emp.name||''));
  tbody.innerHTML = rows.map(r => {
    const dow = new Date(r.date).getDay();
    return `<tr>
      <td style="font-weight:600">${r.date}</td>
      <td style="color:var(--text-muted)">${DAY_NAMES[dow]}</td>
      <td><a href="shell.html#employee/${r.emp.id}" style="font-weight:600;color:inherit;text-decoration:none">${esc(r.emp.name) || '—'}</a><div style="font-size:11px;color:var(--text-muted)">${esc(r.emp.emp_code)}</div></td>
      <td>${categoryBadge(r.emp.category)}</td>
      <td style="color:var(--text-muted)">${esc(r.emp.dept) || '—'}</td>
      <td style="color:var(--text-muted);font-size:13px">${esc(r.emp.phone) || '—'}</td>
    </tr>`;
  }).join('');
}

function absExportCSV() {
  if (!_absRows.length) { toast.warning('لا توجد بيانات'); return; }
  const csvEscape = (v) => {
    const s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const csv = [['التاريخ','اليوم','الموظف','الكود','الفئة','القسم','الهاتف']];
  _absRows.forEach(r => {
    const dow = new Date(r.date).getDay();
    csv.push([r.date, DAY_NAMES[dow], r.emp.name||'', r.emp.emp_code||'', categoryLabel(r.emp.category), r.emp.dept||'', r.emp.phone||'']);
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv.map(r => r.map(csvEscape).join(',')).join('\n'));
  a.download = `absentees_${todayStr}.csv`;
  a.click();
}

// ============================================================================
// VIEW: LEAVES
// ============================================================================
let _leavesAll = [], _leavesEmps = [];

async function loadLeavesView() {
  document.getElementById('hdrActions').innerHTML = `<button class="btn btn-primary btn-sm" onclick="window.spa.lvOpenAdd()">+ إجازة جديدة</button>`;
  setView(`
    <div class="page-content">
      <div class="stats-grid">
        <div class="stat-card orange"><div class="stat-icon">⏳</div><div class="stat-value" id="lvKpiP">—</div><div class="stat-label">في الانتظار</div></div>
        <div class="stat-card green"><div class="stat-icon">✓</div><div class="stat-value" id="lvKpiA">—</div><div class="stat-label">مقبولة</div></div>
        <div class="stat-card red"><div class="stat-icon">✕</div><div class="stat-value" id="lvKpiR">—</div><div class="stat-label">مرفوضة</div></div>
        <div class="stat-card blue"><div class="stat-icon">📅</div><div class="stat-value" id="lvKpiNow">—</div><div class="stat-label">في إجازة الآن</div></div>
      </div>
      <div class="card mb-20"><div class="card-body" style="padding:16px 22px">
        <div class="flex gap-12" style="flex-wrap:wrap">
          <select class="form-control" id="lvFiltStatus" onchange="window.spa.lvRender()" style="width:180px">
            <option value="">كل الحالات</option><option value="pending">في الانتظار</option><option value="approved">مقبولة</option><option value="rejected">مرفوضة</option>
          </select>
          <select class="form-control" id="lvFiltType" onchange="window.spa.lvRender()" style="width:160px">
            <option value="">كل الأنواع</option><option value="annual">سنوية</option><option value="sick">مرضية</option><option value="personal">شخصية</option><option value="unpaid">بدون راتب</option><option value="other">أخرى</option>
          </select>
          <input type="text" class="form-control" id="lvFiltSearch" placeholder="بحث..." oninput="window.spa.lvRender()" style="width:240px">
        </div>
      </div></div>
      <div class="card">
        <div class="card-header"><div class="card-title">طلبات الإجازات</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>السبب</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody id="lvTable"><tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  const [emps, lvs] = await Promise.all([
    api.get('employees', `?org_id=eq.${orgId}&order=name.asc&select=id,name,emp_code`),
    api.get('leaves', `?org_id=eq.${orgId}&order=created_at.desc&select=*,employees(name,emp_code)`)
  ]);
  _leavesEmps = Array.isArray(emps) ? emps : [];
  _leavesAll = Array.isArray(lvs) ? lvs : [];
  const today = todayStr;
  document.getElementById('lvKpiP').textContent = _leavesAll.filter(l => l.status==='pending').length;
  document.getElementById('lvKpiA').textContent = _leavesAll.filter(l => l.status==='approved').length;
  document.getElementById('lvKpiR').textContent = _leavesAll.filter(l => l.status==='rejected').length;
  document.getElementById('lvKpiNow').textContent = _leavesAll.filter(l => l.status==='approved' && l.date_from <= today && l.date_to >= today).length;
  lvRender();
}

function lvRender() {
  const sf = document.getElementById('lvFiltStatus').value;
  const tf = document.getElementById('lvFiltType').value;
  const q = document.getElementById('lvFiltSearch').value.toLowerCase().trim();
  const TYPE_LBL = {annual:'سنوية',sick:'مرضية',personal:'شخصية',unpaid:'بدون راتب',other:'أخرى'};
  const STATUS = {pending:'<span class="badge badge-warning">⏳</span>',approved:'<span class="badge badge-success">✓</span>',rejected:'<span class="badge badge-danger">✕</span>'};
  const filtered = _leavesAll.filter(l => {
    const en = l.employees?.name || '';
    return (!sf || l.status === sf) && (!tf || l.type === tf) && (!q || en.toLowerCase().includes(q));
  });
  const tbody = document.getElementById('lvTable');
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">لا توجد طلبات</div></div></td></tr>'; return; }
  tbody.innerHTML = filtered.map(l => {
    const days = Math.floor((new Date(l.date_to) - new Date(l.date_from)) / 86400000) + 1;
    return `<tr>
      <td><a href="shell.html#employee/${l.emp_id}" style="color:inherit;font-weight:600;text-decoration:none">${esc(l.employees?.name) || '—'}</a></td>
      <td><span class="badge badge-info">${TYPE_LBL[l.type] || l.type}</span></td>
      <td>${l.date_from}</td><td>${l.date_to}</td>
      <td style="font-weight:600">${days} يوم</td>
      <td style="color:var(--text-muted);font-size:13px">${esc(l.reason) || '—'}</td>
      <td>${STATUS[l.status] || l.status}</td>
      <td><div class="flex gap-8">
        ${l.status === 'pending' ? `<button class="btn btn-success btn-sm btn-icon" onclick="window.spa.lvSetStatus('${l.id}','approved')">✓</button><button class="btn btn-danger btn-sm btn-icon" onclick="window.spa.lvSetStatus('${l.id}','rejected')">✕</button>` : ''}
        <button class="btn btn-ghost btn-sm btn-icon" onclick="window.spa.lvDelete('${l.id}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

function lvOpenAdd() {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="lvModal">
      <div class="modal">
        <div class="modal-header"><div class="modal-title">إضافة إجازة</div><button class="modal-close" onclick="closeModal('lvModal')">✕</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">الموظف *</label>
            <select class="form-control" id="lvEmp">
              <option value="">اختر...</option>
              ${_leavesEmps.map(e => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.emp_code)})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">النوع</label>
            <select class="form-control" id="lvType">
              <option value="annual">سنوية</option><option value="sick">مرضية</option>
              <option value="personal">شخصية</option><option value="unpaid">بدون راتب</option><option value="other">أخرى</option>
            </select>
          </div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">من</label><input type="date" class="form-control" id="lvFrom"></div>
            <div class="form-group"><label class="form-label">إلى</label><input type="date" class="form-control" id="lvTo"></div>
          </div>
          <div class="form-group"><label class="form-label">السبب</label><textarea class="form-control" id="lvReason" rows="3"></textarea></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('lvModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.lvSave()">حفظ</button>
        </div>
      </div>
    </div>
  `);
}

async function lvSave() {
  const emp = document.getElementById('lvEmp').value;
  const from = document.getElementById('lvFrom').value;
  const to = document.getElementById('lvTo').value;
  if (!emp || !from || !to) return toast.error('املأ الحقول');
  if (to < from) return toast.error('التاريخ غير صحيح');
  const r = await api.post('leaves', {
    org_id: orgId, emp_id: emp, type: document.getElementById('lvType').value,
    date_from: from, date_to: to, reason: document.getElementById('lvReason').value.trim() || null, status: 'pending'
  });
  if (Array.isArray(r) && r[0]) { toast.success('تم'); closeModal('lvModal'); loadLeavesView(); }
  else toast.error('خطأ');
}

async function lvSetStatus(id, status) {
  const r = await api.patch('leaves', id, { status, approved_by: user.id, approved_at: new Date().toISOString() });
  if (Array.isArray(r)) {
    if (status === 'approved') {
      const lv = _leavesAll.find(x => x.id === id);
      if (lv) await lvMarkDays(lv);
    }
    toast.success(status === 'approved' ? 'تم القبول' : 'تم الرفض');
    loadLeavesView();
  } else toast.error('خطأ');
}

async function lvMarkDays(lv) {
  const p = lv.date_from.split('-').map(Number);
  let y=p[0], m=p[1], d=p[2];
  const ep = lv.date_to.split('-').map(Number);
  let safety = 366;
  while (safety-- > 0) {
    const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const ex = await api.get('attendance', `?emp_id=eq.${lv.emp_id}&date=eq.${ds}&select=id`);
    if (Array.isArray(ex) && ex[0]) await api.patch('attendance', ex[0].id, { status: 'leave', source: 'manual' });
    else await api.post('attendance', { org_id: lv.org_id, emp_id: lv.emp_id, date: ds, status: 'leave', source: 'manual' });
    if (y===ep[0] && m===ep[1] && d===ep[2]) break;
    const nx = new Date(Date.UTC(y, m-1, d, 12)); nx.setUTCDate(nx.getUTCDate()+1);
    y=nx.getUTCFullYear(); m=nx.getUTCMonth()+1; d=nx.getUTCDate();
  }
}

async function lvDelete(id) {
  if (!confirm('حذف؟')) return;
  await api.delete('leaves', id);
  toast.success('حُذف');
  loadLeavesView();
}

// ============================================================================
// VIEW: HOLIDAYS
// ============================================================================
async function loadHolidaysView() {
  document.getElementById('hdrActions').innerHTML = `<button class="btn btn-primary btn-sm" onclick="window.spa.holOpenAdd()">+ إضافة عطلة</button>`;
  setView(`
    <div class="page-content">
      <div class="card">
        <div class="card-header"><div class="card-title">قائمة العطل</div><span id="holCount" style="font-size:13px;color:var(--text-muted)"></span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>التاريخ</th><th>اليوم</th><th>الاسم</th><th>النوع</th><th>مدفوعة</th><th>إجراءات</th></tr></thead>
            <tbody id="holTable"><tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  const list = await api.get('holidays', `?org_id=eq.${orgId}&order=date.desc`);
  const arr = Array.isArray(list) ? list : [];
  document.getElementById('holCount').textContent = `${arr.length} عطلة`;
  const TYPE = {public:{l:'رسمية',c:'#3b82f6'},religious:{l:'دينية',c:'#a855f7'},national:{l:'وطنية',c:'#10b981'},custom:{l:'مخصّصة',c:'#f59e0b'}};
  const tbody = document.getElementById('holTable');
  if (!arr.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🗓</div><div class="empty-title">لا توجد عطل</div></div></td></tr>'; return; }
  tbody.innerHTML = arr.map(h => {
    const t = TYPE[h.type] || TYPE.custom;
    const dow = new Date(h.date).getDay();
    return `<tr>
      <td style="font-weight:600">${h.date}</td>
      <td style="color:var(--text-muted)">${DAY_NAMES[dow]}</td>
      <td>${esc(h.name)}</td>
      <td><span class="badge" style="background:${t.c}22;color:${t.c}">${t.l}</span></td>
      <td>${h.is_paid ? '<span class="badge badge-success">نعم</span>' : '<span class="badge badge-warning">لا</span>'}</td>
      <td><div class="flex gap-8">
        <button class="btn btn-ghost btn-sm btn-icon" onclick='window.spa.holEdit(${jsonAttr(h)})'>✎</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="window.spa.holDelete('${h.id}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

function holOpenAdd() { holOpenModal({}); }
function holEdit(h) { holOpenModal(h); }
function holOpenModal(h) {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="holModal">
      <div class="modal">
        <div class="modal-header"><div class="modal-title">${h.id ? 'تعديل' : 'إضافة'} عطلة</div><button class="modal-close" onclick="closeModal('holModal')">✕</button></div>
        <div class="modal-body">
          <input type="hidden" id="holId" value="${esc(h.id)||''}">
          <div class="form-group"><label class="form-label">التاريخ</label><input type="date" class="form-control" id="holDate" value="${esc(h.date)||''}"></div>
          <div class="form-group"><label class="form-label">الاسم</label><input type="text" class="form-control" id="holName" value="${esc(h.name)||''}"></div>
          <div class="grid-2">
            <div class="form-group"><label class="form-label">النوع</label>
              <select class="form-control" id="holType">
                <option value="public" ${h.type==='public'?'selected':''}>رسمية</option>
                <option value="religious" ${h.type==='religious'?'selected':''}>دينية</option>
                <option value="national" ${h.type==='national'?'selected':''}>وطنية</option>
                <option value="custom" ${h.type==='custom'?'selected':''}>مخصّصة</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">مدفوعة</label>
              <select class="form-control" id="holPaid">
                <option value="true" ${h.is_paid!==false?'selected':''}>نعم</option>
                <option value="false" ${h.is_paid===false?'selected':''}>لا</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('holModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.holSave()">حفظ</button>
        </div>
      </div>
    </div>
  `);
}

async function holSave() {
  const id = document.getElementById('holId').value;
  const data = {
    date: document.getElementById('holDate').value,
    name: document.getElementById('holName').value.trim(),
    type: document.getElementById('holType').value,
    is_paid: document.getElementById('holPaid').value === 'true'
  };
  if (!data.date || !data.name) return toast.error('املأ الحقول');
  let r;
  if (id) r = await api.patch('holidays', id, data);
  else r = await api.post('holidays', { ...data, org_id: orgId });
  if (Array.isArray(r) && r[0]) { toast.success('تم'); closeModal('holModal'); loadHolidaysView(); }
  else toast.error('خطأ');
}

async function holDelete(id) {
  if (!confirm('حذف؟')) return;
  await api.delete('holidays', id);
  toast.success('حُذف');
  loadHolidaysView();
}

// ============================================================================
// VIEW: ALERTS
// ============================================================================
let _alertsAll = [];

async function loadAlertsView() {
  document.getElementById('hdrActions').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="window.spa.alRunCheck()">🔄 تحديث</button>
    <button class="btn btn-ghost btn-sm" onclick="window.spa.alMarkAllRead()">✓ الكل مقروء</button>
  `;
  setView(`
    <div class="page-content">
      <div class="stats-grid">
        <div class="stat-card red"><div class="stat-icon">🚨</div><div class="stat-value" id="alK1">—</div><div class="stat-label">حرجة</div></div>
        <div class="stat-card orange"><div class="stat-icon">⚠️</div><div class="stat-value" id="alK2">—</div><div class="stat-label">تحذيرات</div></div>
        <div class="stat-card blue"><div class="stat-icon">ℹ️</div><div class="stat-value" id="alK3">—</div><div class="stat-label">معلوماتية</div></div>
        <div class="stat-card green"><div class="stat-icon">📭</div><div class="stat-value" id="alK4">—</div><div class="stat-label">غير مقروءة</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">التنبيهات</div>
          <select class="form-control" id="alSev" onchange="window.spa.alRender()" style="width:180px">
            <option value="">كل المستويات</option><option value="danger">حرجة</option><option value="warning">تحذيرات</option><option value="info">معلوماتية</option>
          </select>
        </div>
        <div id="alList"></div>
      </div>
    </div>
  `);
  const list = await api.get('alerts', `?org_id=eq.${orgId}&order=created_at.desc&limit=200`);
  _alertsAll = Array.isArray(list) ? list : [];
  document.getElementById('alK1').textContent = _alertsAll.filter(a => a.severity==='danger').length;
  document.getElementById('alK2').textContent = _alertsAll.filter(a => a.severity==='warning').length;
  document.getElementById('alK3').textContent = _alertsAll.filter(a => a.severity==='info').length;
  document.getElementById('alK4').textContent = _alertsAll.filter(a => !a.is_read).length;
  alRender();
}

function alRender() {
  const sf = document.getElementById('alSev').value;
  const filt = sf ? _alertsAll.filter(a => a.severity === sf) : _alertsAll;
  const box = document.getElementById('alList');
  if (!filt.length) { box.innerHTML = '<div class="empty-state"><div class="empty-icon">🔕</div><div class="empty-title">لا توجد تنبيهات</div></div>'; return; }
  const ICONS = {info:'ℹ️',warning:'⚠️',danger:'🚨'};
  box.innerHTML = filt.map(a => `
    <div class="alert-row ${!a.is_read ? 'unread' : ''}" onclick="window.spa.alMarkRead('${a.id}')">
      ${!a.is_read ? '<div class="unread-dot"></div>' : '<div style="width:8px;flex-shrink:0"></div>'}
      <div class="alert-icon ${a.severity}">${ICONS[a.severity] || 'ℹ️'}</div>
      <div class="alert-content">
        <div class="alert-title">${esc(a.title)}</div>
        <div class="alert-msg">${esc(a.message) || ''}</div>
        <div class="alert-time">${new Date(a.created_at).toLocaleString('ar-TN')}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window.spa.alDelete('${a.id}')">🗑</button>
    </div>
  `).join('');
}

async function alMarkRead(id) {
  const a = _alertsAll.find(x => x.id === id);
  if (!a || a.is_read) return;
  await api.patch('alerts', id, { is_read: true });
  loadAlertsView();
}

async function alMarkAllRead() {
  const u = _alertsAll.filter(a => !a.is_read);
  for (const a of u) await api.patch('alerts', a.id, { is_read: true });
  toast.success(`تم ${u.length} تنبيه`);
  loadAlertsView();
}

async function alDelete(id) {
  await api.delete('alerts', id);
  toast.success('حُذف');
  loadAlertsView();
}

async function alRunCheck() {
  toast.info('جارٍ الفحص...');
  try {
    const r = await api.rpc('check_attendance_alerts', { p_org_id: orgId });
    if (r && r.success) { toast.success(`${r.new_alerts} جديد`); loadAlertsView(); }
    else toast.error('خطأ');
  } catch(e) { toast.error('خطأ'); }
}

// ============================================================================
// VIEW: AUDIT (SA only)
// ============================================================================
let _auditAll = [];

async function loadAuditView() {
  document.getElementById('hdrActions').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="window.spa.auExport()">📥 CSV</button>`;
  setView(`
    <div class="page-content">
      <div class="card mb-20"><div class="card-body" style="padding:16px 22px">
        <div class="flex gap-12" style="flex-wrap:wrap">
          <input type="text" class="form-control" id="auQ" placeholder="بحث..." oninput="window.spa.auRender()" style="width:280px">
          <select class="form-control" id="auAct" onchange="window.spa.auRender()" style="width:180px"><option value="">كل الإجراءات</option></select>
          <input type="date" class="form-control" id="auFrom" onchange="window.spa.auLoad()" style="width:160px">
          <input type="date" class="form-control" id="auTo" onchange="window.spa.auLoad()" style="width:160px">
        </div>
      </div></div>
      <div class="card">
        <div class="card-header"><div class="card-title">السجلات</div><span id="auCount" style="font-size:13px;color:var(--text-muted)"></span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>الكيان</th><th>التفاصيل</th></tr></thead>
            <tbody id="auTable"><tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  auLoad();
}

async function auLoad() {
  const from = document.getElementById('auFrom').value;
  const to = document.getElementById('auTo').value;
  let q = '?order=created_at.desc&limit=500';
  if (from) q += `&created_at=gte.${from}`;
  if (to) q += `&created_at=lte.${to}T23:59:59`;
  const list = await api.get('audit_log', q);
  _auditAll = Array.isArray(list) ? list : [];
  const acts = [...new Set(_auditAll.map(l => l.action).filter(Boolean))];
  document.getElementById('auAct').innerHTML = '<option value="">كل الإجراءات</option>' + acts.map(a => `<option>${a}</option>`).join('');
  auRender();
}

function auRender() {
  const q = document.getElementById('auQ').value.toLowerCase().trim();
  const af = document.getElementById('auAct').value;
  const f = _auditAll.filter(l => (!af || l.action === af) && (!q || (l.action||'').toLowerCase().includes(q) || (l.user_name||'').toLowerCase().includes(q)));
  document.getElementById('auCount').textContent = `${f.length} سجل`;
  const tbody = document.getElementById('auTable');
  if (!f.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">لا توجد سجلات</div></div></td></tr>'; return; }
  tbody.innerHTML = f.map(l => `<tr>
    <td style="white-space:nowrap;font-family:monospace;font-size:12px">${new Date(l.created_at).toLocaleString('ar-TN')}</td>
    <td>${esc(l.user_name) || '—'}</td>
    <td><span class="badge badge-info">${esc(l.action)}</span></td>
    <td style="color:var(--text-muted);font-size:13px">${esc(l.entity) || '—'}</td>
    <td style="font-size:12px;font-family:monospace;color:var(--text-muted)">${l.details ? esc(JSON.stringify(l.details).slice(0,80)) : '—'}</td>
  </tr>`).join('');
}

function auExport() {
  const rows = [['الوقت','المستخدم','الإجراء','الكيان','التفاصيل']];
  _auditAll.forEach(l => rows.push([
    new Date(l.created_at).toLocaleString('ar-TN'), l.user_name||'', l.action||'', l.entity||'',
    l.details ? JSON.stringify(l.details) : ''
  ]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `audit_${todayStr}.csv`;
  a.click();
}

// ============================================================================
// VIEW: ATTENDANCE (basic)
// ============================================================================
async function loadAttendanceView() {
  document.getElementById('hdrActions').innerHTML = '';
  setView(`
    <div class="page-content">
      <div class="card">
        <div class="card-header">
          <div class="flex gap-12 items-center" style="flex-wrap:wrap">
            <input type="date" class="form-control" id="attDateFilter" value="${todayStr}" onchange="window.spa.attLoad()" style="width:160px">
            <input type="text" class="form-control" id="attSearch" placeholder="بحث..." oninput="window.spa.attRender()" style="width:240px">
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>التاريخ</th><th>الموظف</th><th>القسم</th><th>دخول</th><th>خروج</th><th>الحالة</th></tr></thead>
            <tbody id="attTable"><tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  attLoad();
}

let _attAll = [];
async function attLoad() {
  const date = document.getElementById('attDateFilter').value || todayStr;
  const list = await api.get('attendance', `?org_id=eq.${orgId}&date=eq.${date}&select=*,employees(name,emp_code,dept)&order=check_in.asc`);
  _attAll = Array.isArray(list) ? list : [];
  attRender();
}

function attRender() {
  const q = document.getElementById('attSearch').value.toLowerCase().trim();
  const f = _attAll.filter(a => !q || (a.employees?.name||'').toLowerCase().includes(q) || (a.employees?.emp_code||'').toLowerCase().includes(q));
  const tbody = document.getElementById('attTable');
  if (!f.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">لا توجد سجلات</div></div></td></tr>'; return; }
  tbody.innerHTML = f.map(a => `<tr>
    <td>${a.date}</td>
    <td><a href="shell.html#employee/${a.emp_id}" style="color:inherit;font-weight:600;text-decoration:none">${esc(a.employees?.name) || '—'}</a></td>
    <td style="color:var(--text-muted)">${esc(a.employees?.dept) || '—'}</td>
    <td style="color:var(--text-muted)">${(a.check_in||'').slice(0,5)||'—'}</td>
    <td style="color:var(--text-muted)">${(a.check_out||'').slice(0,5)||'—'}</td>
    <td>${statusBadge(a.status)}</td>
  </tr>`).join('');
}

// ============================================================================
// VIEW: REPORTS (basic)
// ============================================================================
async function loadReportsView() {
  document.getElementById('hdrActions').innerHTML = '';
  setView(`
    <div class="page-content">
      <div class="card mb-20"><div class="card-body" style="padding:16px 22px">
        <div class="flex gap-12 items-center" style="flex-wrap:wrap">
          <input type="date" class="form-control" id="repFrom" style="width:160px">
          <input type="date" class="form-control" id="repTo" style="width:160px">
          <button class="btn btn-primary" onclick="window.spa.repLoad()">عرض</button>
        </div>
      </div></div>
      <div id="repBox"><div style="text-align:center;padding:40px;color:var(--text-muted)">حدد الفترة واضغط عرض</div></div>
    </div>
  `);
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  document.getElementById('repFrom').value = monthStart.toISOString().slice(0,10);
  document.getElementById('repTo').value = today.toISOString().slice(0,10);
  repLoad();
}

async function repLoad() {
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  if (!from || !to) return toast.error('حدد التواريخ');
  const r = await api.rpc('top_employees', { p_org_id: orgId, p_from: from, p_to: to, p_limit: 100 });
  const arr = Array.isArray(r) ? r : [];
  const box = document.getElementById('repBox');
  if (!arr.length) { box.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">لا توجد بيانات</div>'; return; }
  const totals = arr.reduce((a,e) => ({p:a.p+(e.present_days||0),l:a.l+(e.late_days||0),ab:a.ab+(e.absent_days||0)}), {p:0,l:0,ab:0});
  box.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card green"><div class="stat-icon">✓</div><div class="stat-value">${totals.p}</div><div class="stat-label">حضور</div></div>
      <div class="stat-card orange"><div class="stat-icon">⚠️</div><div class="stat-value">${totals.l}</div><div class="stat-label">تأخير</div></div>
      <div class="stat-card red"><div class="stat-icon">✕</div><div class="stat-value">${totals.ab}</div><div class="stat-label">غياب</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">تقرير تفصيلي</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>الموظف</th><th>الفئة</th><th>القسم</th><th>حضور</th><th>تأخير</th><th>غياب</th><th>نسبة</th><th>درجة</th></tr></thead>
        <tbody>${arr.map(e => `<tr>
          <td><a href="shell.html#employee/${e.emp_id}" style="color:inherit;font-weight:600;text-decoration:none">${esc(e.name) || '—'}</a></td>
          <td>${categoryBadge(e.category)}</td>
          <td style="color:var(--text-muted)">${esc(e.dept) || '—'}</td>
          <td>${e.present_days||0}</td><td>${e.late_days||0}</td><td>${e.absent_days||0}</td>
          <td style="font-weight:600;color:var(--accent)">${e.attendance_rate||0}%</td>
          <td>${e.score||0}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  `;
}

// ============================================================================
// VIEW: DEVICE
// ============================================================================
async function loadDeviceView() {
  document.getElementById('hdrActions').innerHTML = '';
  const devs = await api.get('devices', `?org_id=eq.${orgId}&order=last_seen.desc`);
  const arr = Array.isArray(devs) ? devs : [];
  setView(`
    <div class="page-content">
      <div class="card">
        <div class="card-header"><div class="card-title">الأجهزة (${arr.length})</div></div>
        <div class="card-body">
          ${arr.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-muted)">لا توجد أجهزة مسجّلة بعد</div>' :
            arr.map(d => {
              const online = d.last_seen && (Date.now() - new Date(d.last_seen).getTime() < 5*60*1000);
              return `<div style="padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:600;font-family:monospace">${d.sn}</div>
                    <div style="font-size:12px;color:var(--text-muted)">آخر اتصال: ${d.last_seen ? new Date(d.last_seen).toLocaleString('ar-TN') : '—'}</div>
                  </div>
                  <span class="badge ${online?'badge-success':'badge-danger'}">${online?'🟢 متصل':'🔴 غير متصل'}</span>
                </div>
              </div>`;
            }).join('')
          }
        </div>
      </div>
    </div>
  `);
}

// ============================================================================
// VIEW: SETTINGS
// ============================================================================
async function loadSettingsView() {
  document.getElementById('hdrActions').innerHTML = '';
  setView(`
    <div class="page-content">
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">👤 الحساب</div></div>
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div style="background:var(--surface3);border-radius:8px;padding:12px"><div style="font-size:11px;color:var(--text-muted)">الاسم</div><div style="font-weight:600">${esc(user.name) || '—'}</div></div>
              <div style="background:var(--surface3);border-radius:8px;padding:12px"><div style="font-size:11px;color:var(--text-muted)">الدور</div><div style="font-weight:600">${isSA?'سوبر أدمن':'مدير'}</div></div>
              ${user.org_name?`<div style="background:var(--surface3);border-radius:8px;padding:12px;grid-column:1/-1"><div style="font-size:11px;color:var(--text-muted)">المؤسسة</div><div style="font-weight:600">${esc(user.org_name)}</div></div>`:''}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🔒 تغيير كلمة المرور</div></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">الحالية</label><input type="password" class="form-control" id="setCur"></div>
            <div class="form-group"><label class="form-label">الجديدة</label><input type="password" class="form-control" id="setNew"></div>
            <div class="form-group"><label class="form-label">تأكيد</label><input type="password" class="form-control" id="setNew2"></div>
            <button class="btn btn-primary" onclick="window.spa.setPass()">حفظ</button>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:20px">
        <div class="card-header"><div class="card-title">🎨 التفضيلات</div></div>
        <div class="card-body">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">اللغة</label>
              <select class="form-control" id="setLang" onchange="window.spa.setLangFn(this.value)">
                <option value="ar">العربية</option><option value="fr">Français</option><option value="en">English</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">المظهر</label>
              <select class="form-control" id="setTheme" onchange="window.spa.setThemeFn(this.value)">
                <option value="dark">🌙 داكن</option><option value="light">☀️ فاتح</option><option value="auto">🔄 تلقائي</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
  document.getElementById('setLang').value = getLang();
  document.getElementById('setTheme').value = getTheme();
}

async function setPass() {
  const cur = document.getElementById('setCur').value;
  const np = document.getElementById('setNew').value;
  const np2 = document.getElementById('setNew2').value;
  if (!cur || !np || !np2) return toast.error('املأ الحقول');
  if (np.length < 6) return toast.error('6 أحرف على الأقل');
  if (np !== np2) return toast.error('غير متطابقة');
  const v = await api.rpc('login_user', { p_username: user.username || user.email, p_password: cur, p_role: null });
  if (!v || !v.success) return toast.error('كلمة المرور الحالية غير صحيحة');
  const r = await api.rpc('update_manager_credentials', { p_user_id: user.id, p_password: np });
  if (r && r.success) {
    toast.success('تم');
    ['setCur','setNew','setNew2'].forEach(i => document.getElementById(i).value = '');
  } else toast.error('فشل');
}

async function setLangFn(lang) {
  try { await api.patch('attendx_users', user.id, { language: lang }); } catch(e) {}
  // حدّث الجلسة المحلية أيضاً
  const cur = auth.get();
  if (cur) { cur.language = lang; auth.set(cur); }
  setLang(lang);  // يحفظ في localStorage + reload
}
async function setThemeFn(theme) {
  try { await api.patch('attendx_users', user.id, { theme }); } catch(e) {}
  const cur = auth.get();
  if (cur) { cur.theme = theme; auth.set(cur); }
  setTheme(theme);
  toast.success('تم');
}

// ============================================================================
// VIEW: SUPERADMIN
// ============================================================================
let _saOrgs = [];

async function loadSuperadminView() {
  document.getElementById('hdrActions').innerHTML = `<button class="btn btn-accent btn-sm" onclick="window.spa.saAddOrg()">+ إضافة مؤسسة</button>`;
  setView(`
    <div class="page-content">
      <div class="stats-grid">
        <div class="stat-card blue"><div class="stat-icon">🏢</div><div class="stat-value" id="saOrgs">—</div><div class="stat-label">المؤسسات</div></div>
        <div class="stat-card green"><div class="stat-icon">👥</div><div class="stat-value" id="saEmps">—</div><div class="stat-label">إجمالي الموظفين</div></div>
        <div class="stat-card orange"><div class="stat-icon">📱</div><div class="stat-value" id="saDevs">—</div><div class="stat-label">الأجهزة</div></div>
        <div class="stat-card red"><div class="stat-icon">📋</div><div class="stat-value" id="saAtt">—</div><div class="stat-label">حضور اليوم</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">المؤسسات</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>المؤسسة</th><th>المدير</th><th>هاتف المدير</th><th>الموظفون</th><th>الجهاز</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody id="saTable"><tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">جارٍ التحميل...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  `);
  const stats = await api.rpc('superadmin_stats').catch(() => null);
  if (stats) {
    document.getElementById('saOrgs').textContent = stats.total_orgs;
    document.getElementById('saEmps').textContent = stats.total_emps;
    document.getElementById('saDevs').textContent = stats.total_devices;
    document.getElementById('saAtt').textContent  = stats.attendances_today;
  }
  const orgs = await api.get('organizations', '?select=*,attendx_users(id,name,username,activated,role),employees(id),devices(id,last_seen)&order=created_at.desc');
  _saOrgs = Array.isArray(orgs) ? orgs : [];
  saRender();
}

function saRender() {
  const tbody = document.getElementById('saTable');
  if (!_saOrgs.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-title">لا توجد مؤسسات</div></div></td></tr>'; return; }
  tbody.innerHTML = _saOrgs.map(o => {
    const mgr = (o.attendx_users || []).find(u => u.role === 'manager');
    const empN = (o.employees || []).length;
    const dev = (o.devices || [])[0];
    const online = dev && dev.last_seen && (Date.now() - new Date(dev.last_seen).getTime() < 5*60*1000);
    return `<tr>
      <td><div style="font-weight:600">${esc(o.name)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(o.code) || '—'}</div></td>
      <td>${esc(mgr ? mgr.name : '—')}</td>
      <td style="font-family:monospace">${esc(mgr ? mgr.username : '—')} ${mgr && mgr.activated ? '<span class="badge badge-success">✓</span>' : mgr ? '<span class="badge badge-warning">⏳</span>' : ''}</td>
      <td><span class="badge badge-info">${empN}</span></td>
      <td>${dev ? (online?'<span class="badge badge-success">🟢</span>':'<span class="badge badge-danger">🔴</span>') : '—'}</td>
      <td><span class="badge ${o.status==='active'?'badge-success':'badge-warning'}">${esc(o.status)||'—'}</span></td>
      <td><div class="flex gap-8">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="window.spa.saLoginAs('${o.id}','${esc((o.name||'').replace(/['"\\]/g,''))}')" title="دخول كمدير">👁</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick='window.spa.saEditOrg(${jsonAttr(o)})'>✎</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="window.spa.saDelOrg('${o.id}','${esc((o.name||'').replace(/['"\\]/g,''))}')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

function saAddOrg() {
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="saAddModal">
      <div class="modal">
        <div class="modal-header"><div class="modal-title">إضافة مؤسسة</div><button class="modal-close" onclick="closeModal('saAddModal')">✕</button></div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">اسم المؤسسة *</label><input type="text" class="form-control" id="saoName"></div>
          <div class="form-group"><label class="form-label">الكود</label><input type="text" class="form-control" id="saoCode"></div>
          <div class="form-group"><label class="form-label">العنوان</label><input type="text" class="form-control" id="saoAddr"></div>
          <hr style="margin:16px 0;border-color:var(--border)">
          <div class="form-group"><label class="form-label">اسم المدير *</label><input type="text" class="form-control" id="saoMgr"></div>
          <div class="form-group"><label class="form-label">رقم هاتف المدير *</label><input type="text" class="form-control" id="saoPhone"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('saAddModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.saCreateOrg()">حفظ</button>
        </div>
      </div>
    </div>
  `);
}

async function saCreateOrg() {
  const name = document.getElementById('saoName').value.trim();
  const mgr = document.getElementById('saoMgr').value.trim();
  const phone = document.getElementById('saoPhone').value.trim();
  if (!name || !mgr || !phone) return toast.error('املأ الحقول');
  try {
    const r = await api.rpc('create_organization', {
      p_org_name: name, p_org_code: document.getElementById('saoCode').value.trim() || null,
      p_org_address: document.getElementById('saoAddr').value.trim() || null,
      p_manager_name: mgr, p_manager_phone: phone
    });
    if (r && r.success) { toast.success('تم إنشاء المؤسسة'); closeModal('saAddModal'); loadSuperadminView(); }
    else toast.error(r?.message || 'خطأ');
  } catch(e) { toast.error('خطأ'); }
}

function saEditOrg(o) {
  const mgr = (o.attendx_users || []).find(u => u.role === 'manager');
  clearModals();
  addModal(`
    <div class="modal-overlay active" id="saEditModal">
      <div class="modal">
        <div class="modal-header"><div class="modal-title">تعديل ${esc(o.name)}</div><button class="modal-close" onclick="closeModal('saEditModal')">✕</button></div>
        <div class="modal-body">
          <input type="hidden" id="saoId" value="${esc(o.id)}">
          <input type="hidden" id="saoMgrId" value="${esc(mgr ? mgr.id : '')}">
          <div class="form-group"><label class="form-label">الاسم</label><input type="text" class="form-control" id="saeName" value="${esc(o.name)}"></div>
          <div class="form-group"><label class="form-label">العنوان</label><input type="text" class="form-control" id="saeAddr" value="${esc(o.address)}"></div>
          <div class="form-group"><label class="form-label">الحالة</label>
            <select class="form-control" id="saeStatus">
              <option value="active" ${o.status==='active'?'selected':''}>فعّال</option>
              <option value="suspended" ${o.status==='suspended'?'selected':''}>موقف</option>
            </select>
          </div>
          <hr style="margin:16px 0;border-color:var(--border)">
          <div class="form-group"><label class="form-label">رقم هاتف المدير الجديد</label><input type="text" class="form-control" id="saeNewPhone" placeholder="(فارغ = بدون تغيير)"></div>
          <div class="form-group"><label class="form-label">كلمة مرور جديدة للمدير</label><input type="password" class="form-control" id="saeNewPass" placeholder="(فارغ = بدون تغيير)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal('saEditModal')">إلغاء</button>
          <button class="btn btn-primary" onclick="window.spa.saSaveOrg()">حفظ</button>
        </div>
      </div>
    </div>
  `);
}

async function saSaveOrg() {
  const id = document.getElementById('saoId').value;
  const mgrId = document.getElementById('saoMgrId').value;
  await api.patch('organizations', id, {
    name: document.getElementById('saeName').value,
    address: document.getElementById('saeAddr').value,
    status: document.getElementById('saeStatus').value
  });
  const np = document.getElementById('saeNewPhone').value.trim();
  const npass = document.getElementById('saeNewPass').value;
  if ((np || npass) && mgrId) {
    const r = await api.rpc('update_manager_credentials', {
      p_user_id: mgrId, p_username: np || null, p_password: npass || null
    });
    if (!r || !r.success) { toast.error(r?.message || 'فشل تحديث المدير'); return; }
  }
  toast.success('تم');
  closeModal('saEditModal');
  loadSuperadminView();
}

async function saDelOrg(id, name) {
  if (!confirm(`حذف ${name}؟ سيُحذف كل ما يتعلق بها.`)) return;
  await api.delete('organizations', id);
  toast.success('حُذف');
  loadSuperadminView();
}

function saLoginAs(targetOrgId, targetOrgName) {
  const cur = auth.get();
  localStorage.setItem('attendx_prev_user', JSON.stringify(cur));
  auth.set({ ...cur, viewing_org: targetOrgId, org_name: targetOrgName, _isSAProxy: true });
  window.location.href = 'shell.html#dashboard';
  setTimeout(() => location.reload(), 100);
}

function backToSA() {
  const prev = localStorage.getItem('attendx_prev_user');
  if (prev) {
    try { auth.set(JSON.parse(prev)); }
    catch(e) { localStorage.setItem('attendx_user', prev); }
    localStorage.removeItem('attendx_prev_user');
  }
  window.location.href = 'shell.html#superadmin';
  setTimeout(() => location.reload(), 100);
}

// ============================================================================
// إكسبورت كل الدوال للـ window.spa
// ============================================================================
Object.assign(window.spa, {
  // Absentees
  absSetPeriod, absLoad, absExportCSV,
  // Leaves
  lvOpenAdd, lvSave, lvSetStatus, lvDelete, lvRender,
  // Holidays
  holOpenAdd, holEdit, holSave, holDelete,
  // Alerts
  alRender, alMarkRead, alMarkAllRead, alDelete, alRunCheck,
  // Audit
  auLoad, auRender, auExport,
  // Attendance
  attLoad, attRender,
  // Reports
  repLoad,
  // Settings
  setPass, setLangFn, setThemeFn,
  // Superadmin
  saAddOrg, saCreateOrg, saEditOrg, saSaveOrg, saDelOrg, saLoginAs, backToSA
});


// ============================================================================
// SPA INIT — Start the router AFTER all functions are defined
// ============================================================================
routeFromHash();
window.addEventListener('hashchange', () => routeFromHash());
window.addEventListener('popstate', () => routeFromHash()); // back/forward buttons
