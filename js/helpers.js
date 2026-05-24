// AttendX — Shared Utilities
// ================================
// Loads SUPABASE_URL and SUPABASE_KEY from config.js
// Make sure config.js is loaded BEFORE this file

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('PASTE') || SUPABASE_KEY.includes('PASTE')) {
  alert('⚠️ يرجى تعديل ملف js/config.js وإضافة مفاتيح Supabase أولاً');
}

const api = {
  get: (table, params='') => fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  }).then(r => r.json()),

  post: (table, body) => fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  }).then(r => r.json()),

  patch: (table, id, body) => fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  }).then(r => r.json()),

  delete: (table, id) => fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  }).then(r => ({ ok: r.ok, status: r.status })),

  rpc: (fn, body) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json())
};

// HTML escape — لمنع XSS
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
window.esc = esc;

// Auth
const auth = {
  get: () => {
    const s = localStorage.getItem('attendx_user') || sessionStorage.getItem('attendx_user');
    if (!s) return null;
    try {
      const u = JSON.parse(s);
      if (u && u.role) return u;
    } catch(e) {}
    // جلسة فاسدة — نظّفها
    localStorage.removeItem('attendx_user');
    sessionStorage.removeItem('attendx_user');
    return null;
  },
  set: (obj) => {
    // يحافظ على نفس مكان التخزين الأصلي (تذكّرني أو لا)
    const str = JSON.stringify(obj);
    if (localStorage.getItem('attendx_user') !== null) localStorage.setItem('attendx_user', str);
    else sessionStorage.setItem('attendx_user', str);
  },
  require: (requiredRole=null) => {
    const user = auth.get();
    if (!user) { window.location.href = 'auth.html'; return null; }
    if (requiredRole && user.role !== requiredRole && user.role !== 'superadmin') {
      window.location.href = 'auth.html'; return null;
    }
    return user;
  },
  logout: () => {
    if (!confirm('هل تريد تسجيل الخروج؟')) return;
    localStorage.removeItem('attendx_user');
    sessionStorage.removeItem('attendx_user');
    localStorage.removeItem('attendx_prev_user');
    window.location.href = 'auth.html';
  }
};

// Toast notifications
const toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(msg, type='success', duration=3500) {
    this.init();
    const icons = { success:'✓', error:'✕', info:'ℹ', warning:'⚠' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span style="font-size:16px">${icons[type]||'•'}</span> ${esc(msg)}`;
    this.container.appendChild(el);
    setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(-20px)'; el.style.transition='all 0.3s'; setTimeout(()=>el.remove(),300); }, duration);
  },
  success: (m) => toast.show(m,'success'),
  error:   (m) => toast.show(m,'error'),
  info:    (m) => toast.show(m,'info'),
  warning: (m) => toast.show(m,'warning')
};

// Modal helpers
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// Format date/time
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ar-SA', { year:'numeric', month:'short', day:'numeric' });
}
function formatTime(t) {
  if (!t) return '—';
  return t.slice(0,5);
}
function formatDateTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('ar-SA', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// Status text
function statusBadge(status) {
  const map = {
    present:  '<span class="badge badge-success"><span class="badge-dot"></span>حاضر</span>',
    absent:   '<span class="badge badge-danger"><span class="badge-dot"></span>غائب</span>',
    late:     '<span class="badge badge-warning"><span class="badge-dot"></span>متأخر</span>',
    leave:    '<span class="badge badge-info"><span class="badge-dot"></span>إجازة</span>',
  };
  return map[status] || `<span class="badge badge-info">${status}</span>`;
}

// فئات الموظفين
const CATEGORIES = {
  teacher: { label: 'أساتذة',   icon: '🎓', color: '#60a5fa' },
  admin:   { label: 'إداريين',  icon: '💼', color: '#a78bfa' },
  worker:  { label: 'عملة',     icon: '🛠',  color: '#34d399' }
};
function categoryLabel(c) { return (CATEGORIES[c] && CATEGORIES[c].label) || '—'; }
function categoryBadge(c) {
  const cat = CATEGORIES[c];
  if (!cat) return '<span class="badge badge-info">—</span>';
  return `<span class="badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.label}</span>`;
}

// أيام الأسبوع
const WEEK_DAYS = [
  { code:'SU', short:'الأحد',     dow:0 },
  { code:'MO', short:'الإثنين',   dow:1 },
  { code:'TU', short:'الثلاثاء',  dow:2 },
  { code:'WE', short:'الأربعاء',  dow:3 },
  { code:'TH', short:'الخميس',    dow:4 },
  { code:'FR', short:'الجمعة',    dow:5 },
  { code:'SA', short:'السبت',     dow:6 }
];
function isWorkDay(workDays, dateStr) {
  if (!Array.isArray(workDays) || !workDays.length) return true; // إن لم يحدد، كل الأيام
  const dow = new Date(dateStr).getDay();
  const codes = WEEK_DAYS.filter(d => workDays.includes(d.code)).map(d => d.dow);
  return codes.includes(dow);
}

// حساب التأخير بالدقائق بين وقتين HH:MM:SS
function minutesDiff(t1, t2) {
  if (!t1 || !t2) return 0;
  const [h1,m1,s1=0] = t1.split(':').map(Number);
  const [h2,m2,s2=0] = t2.split(':').map(Number);
  return Math.round(((h2*3600+m2*60+(s2||0)) - (h1*3600+m1*60+(s1||0))) / 60);
}

// Render sidebar nav
function renderSidebar(activeItem, user) {
  const isSA = user.role === 'superadmin';
  const t = window.t || (s => s); // i18n helper safe-fallback
  const navItems = [
    { id:'dashboard',  icon: iconDashboard, label: t('لوحة التحكم'),       href: isSA ? 'shell.html#superadmin' : 'shell.html#dashboard' },
    ...(isSA ? [{ id:'orgs', icon: iconBuilding, label: t('المؤسسات'),     href:'shell.html#superadmin' }] : []),
    { id:'employees',  icon: iconPeople,    label: t('الموظفون'),          href:'shell.html#employees' },
    { id:'attendance', icon: iconClock,     label: t('الحضور والانصراف'), href:'shell.html#attendance' },
    { id:'absentees',  icon: iconClock,     label: t('الغيابات'),          href:'shell.html#absentees' },
    { id:'leaves',     icon: iconCalendar,  label: t('الإجازات'),          href:'shell.html#leaves' },
    { id:'holidays',   icon: iconCalendar,  label: t('العطل الرسمية'),     href:'shell.html#holidays' },
    { id:'alerts',     icon: iconBell,      label: t('التنبيهات'),         href:'shell.html#alerts' },
    { id:'reports',    icon: iconChart,     label: t('التقارير'),          href:'shell.html#reports' },
    ...(isSA ? [{ id:'audit', icon: iconClock, label: t('سجل الأنشطة'),   href:'shell.html#audit' }] : []),
    { id:'device',     icon: iconDevice,    label: t('إعدادات الجهاز'),   href:'shell.html#device' },
    { id:'settings',   icon: iconSettings,  label: t('الإعدادات'),         href:'shell.html#settings' },
  ];

  return `
  <div class="sidebar-logo">
    <div class="sidebar-logo-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg></div>
    <div class="sidebar-logo-text">
      <div class="sidebar-logo-name">Attend<span>X</span></div>
      <div class="sidebar-logo-version">v4.5 ${isSA ? '— ' + t('سوبر أدمن') : '— ' + esc(user.org_name||'')}</div>
    </div>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-title">${t('القائمة الرئيسية')}</div>
    ${navItems.map(item => {
      // employee (مفرد) = employees في الـ sidebar
      const matchActive = activeItem === item.id || (activeItem === 'employee' && item.id === 'employees');
      return `
      <a href="${item.href}" class="nav-item ${matchActive?'active':''}">
        ${item.icon} ${item.label}
      </a>
    `;}).join('')}
  </div>
  <div class="sidebar-footer">
    <div class="user-card" onclick="auth.logout()">
      <div class="user-avatar">${esc((user.name||'؟')[0])}</div>
      <div class="user-info">
        <div class="user-name">${esc(user.name)||t('مستخدم')}</div>
        <div class="user-role">${isSA ? t('سوبر أدمن') : t('مدير مؤسسة')}</div>
      </div>
      <button class="logout-btn" title="${t('تسجيل الخروج')}">
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
  </div>`;
}

// SVG Icons
const iconDashboard = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>`;
const iconPeople    = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
const iconClock     = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>`;
const iconChart     = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`;
const iconDevice    = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-5-4c.83 0 1.5-.67 1.5-1.5S12.83 12 12 12s-1.5.67-1.5 1.5S11.17 15 12 15z"/></svg>`;
const iconSettings  = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
const iconBuilding  = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 3L2 12h3v8h14v-8h3L12 3zm0 2.7L19 12v1h-1v6H6v-6H5v-1l7-6.3zM10 13h4v4h-4z"/></svg>`;
const iconPlus      = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
const iconEdit      = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const iconDelete    = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const iconSearch    = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
const iconDownload  = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
const iconCalendar  = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`;
const iconBell      = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;
const iconSun       = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>`;
const iconMoon      = `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`;

// Auto-fill all <span data-icon="..."> elements with their SVG content
function renderAllIcons() {
  const iconMap = {
    iconDashboard, iconPeople, iconClock, iconChart, iconDevice,
    iconSettings, iconBuilding, iconPlus, iconEdit, iconDelete,
    iconSearch, iconDownload, iconCalendar, iconBell, iconSun, iconMoon
  };
  document.querySelectorAll('span[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    if (iconMap[name]) el.innerHTML = iconMap[name];
  });
}

// Run immediately and on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderAllIcons);
} else {
  renderAllIcons();
}

// Re-render after any dynamic content insertion (used by inline scripts)
window.refreshIcons = renderAllIcons;

// ============================================================================
// i18n — Internationalization (Arabic / French / English)
// ============================================================================
const I18N = {
  ar: { 'AppName':'AttendX' }, // الافتراضي عربي، النصوص نفسها keys
  fr: {
    'لوحة التحكم':'Tableau de bord','المؤسسات':'Organisations','الموظفون':'Employés',
    'الحضور والانصراف':'Présence','الغيابات':'Absences','الإجازات':'Congés',
    'العطل الرسمية':'Jours fériés','التنبيهات':'Alertes','التقارير':'Rapports',
    'سجل الأنشطة':'Journal d\'activité','إعدادات الجهاز':'Paramètres appareil',
    'الإعدادات':'Paramètres','القائمة الرئيسية':'Menu principal',
    'تسجيل الخروج':'Déconnexion','سوبر أدمن':'Super admin','مدير مؤسسة':'Manager',
    'مستخدم':'Utilisateur','حاضر':'Présent','غائب':'Absent','متأخر':'En retard',
    'إجازة':'Congé','حاضر اليوم':'Présents aujourd\'hui','غائب اليوم':'Absents aujourd\'hui',
    'متأخر اليوم':'Retards aujourd\'hui','إجمالي الموظفين':'Total employés',
    'بحث':'Rechercher','إضافة':'Ajouter','تعديل':'Modifier','حذف':'Supprimer',
    'حفظ':'Enregistrer','إلغاء':'Annuler','تأكيد':'Confirmer'
  },
  en: {
    'لوحة التحكم':'Dashboard','المؤسسات':'Organizations','الموظفون':'Employees',
    'الحضور والانصراف':'Attendance','الغيابات':'Absences','الإجازات':'Leaves',
    'العطل الرسمية':'Holidays','التنبيهات':'Alerts','التقارير':'Reports',
    'سجل الأنشطة':'Audit Log','إعدادات الجهاز':'Device Settings','الإعدادات':'Settings',
    'القائمة الرئيسية':'Main Menu','تسجيل الخروج':'Logout','سوبر أدمن':'Super Admin',
    'مدير مؤسسة':'Manager','مستخدم':'User','حاضر':'Present','غائب':'Absent',
    'متأخر':'Late','إجازة':'Leave','حاضر اليوم':'Present Today','غائب اليوم':'Absent Today',
    'متأخر اليوم':'Late Today','إجمالي الموظفين':'Total Employees',
    'بحث':'Search','إضافة':'Add','تعديل':'Edit','حذف':'Delete',
    'حفظ':'Save','إلغاء':'Cancel','تأكيد':'Confirm'
  }
};
function getLang() {
  const u = (auth.get && auth.get()) || {};
  return u.language || localStorage.getItem('attendx_lang') || 'ar';
}
function setLang(lang) {
  localStorage.setItem('attendx_lang', lang);
  // غيّر اتجاه الصفحة
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  location.reload();
}
function t(text) {
  const lang = getLang();
  if (lang === 'ar' || !I18N[lang]) return text;
  return I18N[lang][text] || text;
}
window.t = t;
window.getLang = getLang;
window.setLang = setLang;

// تطبيق الـ direction عند التحميل
(function initI18n(){
  const lang = getLang();
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
})();

// ============================================================================
// Theme — Dark / Light / Auto
// ============================================================================
function getTheme() {
  const u = (auth.get && auth.get()) || {};
  return u.theme || localStorage.getItem('attendx_theme') || 'dark';
}
function applyTheme(theme) {
  // 'auto' → حسب الوقت (06:00 → 18:00 فاتح، وإلا مظلم)
  let actual = theme;
  if (theme === 'auto') {
    const h = new Date().getHours();
    actual = (h >= 6 && h < 18) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', actual);
}
function setTheme(theme) {
  localStorage.setItem('attendx_theme', theme);
  applyTheme(theme);
}
window.getTheme = getTheme;
window.setTheme = setTheme;
window.applyTheme = applyTheme;

// تطبيق الـ theme عند التحميل
(function initTheme(){ applyTheme(getTheme()); })();

// ============================================================================
// Notifications counter — في الـ header
// ============================================================================
async function fetchUnreadAlerts() {
  const u = auth.get();
  if (!u) return 0;
  const orgId = u.org_id || u.viewing_org;
  if (!orgId) return 0;
  try {
    const res = await api.get('alerts', `?org_id=eq.${orgId}&is_read=eq.false&select=id`);
    return Array.isArray(res) ? res.length : 0;
  } catch(e) { return 0; }
}
window.fetchUnreadAlerts = fetchUnreadAlerts;
