// ============================================================
// AttendX — Configuration File
// ⚠️ هذا الملف الوحيد الذي تحتاج تعديله!
// ============================================================

const CONFIG = {
  // 🔵 رابط مشروع Supabase الخاص بك
  SUPABASE_URL: 'https://xxalxcaggwlyrzxldcvc.supabase.co',

  // 🟢 المفتاح العام (Publishable Key)
  // ابدأ بـ: sb_publishable_...
  SUPABASE_KEY: 'sb_publishable_90qynBeBSpsisM-illuI8Q_NB51-osL',

  // اسم جدول المستخدمين (لا تغيّره)
  USERS_TABLE: 'attendx_users',
};

// لا تغيّر شيئاً تحت هذا السطر
// ============================================================
window.SUPABASE_URL = CONFIG.SUPABASE_URL;
window.SUPABASE_KEY = CONFIG.SUPABASE_KEY;
window.USERS_TABLE  = CONFIG.USERS_TABLE;
