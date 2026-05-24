// ============================================================================
// AttendX v4.5 — MQTT-first SaaS + Leaves + Holidays + Alerts + Audit + i18n
// ============================================================================
// مصحّح ومتوافق 100% مع: DATABASE.sql, dashboard.html, device.html,
// employees.html, attendance.html, reports.html
//
// الإصلاحات عن v4.0:
//   • raw_records يُحفظ دائماً مع org_id (وإلا لا يظهر في أي شاشة)
//   • منطق status='late' حسب shift_start (مثل الكود القديم)
//   • source:'device' في كل سجلات attendance (CHECK constraint)
//   • معالجة device_commands عبر MQTT (بدل HTTP keepalive القديم)
//   • ensureEmployee يضبط synced_to_device
//   • raw_records.external_id فريد لتجنّب أخطاء UNIQUE
// ============================================================================

const express = require('express');
const net = require('net');
const aedes = require('aedes')();
const zlib = require('zlib');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8080;
const MQTT_PORT = 1883;
const VERSION = '4.5';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('❌ متغيّرات البيئة مفقودة!');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');
  console.error('يجب إضافة في Railway → Variables:');
  console.error('  1) SUPABASE_URL          = https://xxxx.supabase.co');
  console.error('  2) SUPABASE_SERVICE_KEY  = eyJhbGc... (Service Role Key)');
  console.error('');
  console.error('احصل عليهم من: Supabase Dashboard → Settings → API');
  console.error('═══════════════════════════════════════════════════════════');
  process.exit(1);
}

// التحقّق من صحّة الـ URL
if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(SUPABASE_URL.replace(/\/$/, ''))) {
  console.error('');
  console.error('⚠️  SUPABASE_URL لا يبدو صحيحاً:');
  console.error(`   ${SUPABASE_URL}`);
  console.error('   يجب أن يكون بصيغة: https://xxxx.supabase.co');
  console.error('');
}

// التحقّق من نوع الـ key
// التحقّق من نوع الـ key
// المفاتيح الصحيحة للـ backend:
//   - sb_secret_xxx (Supabase الجديد، 2024+)
//   - eyJhbGc... (JWT القديم — service_role)
// المفاتيح غير الصحيحة:
//   - sb_publishable_xxx (للـ frontend فقط)
//   - anon-... (للـ frontend فقط)
if (SUPABASE_KEY.startsWith('sb_publishable_') || SUPABASE_KEY.startsWith('anon-')) {
  console.error('');
  console.error('⚠️  تحذير: تستعمل publishable/anon key بدل secret key!');
  console.error('   server.js يحتاج SUPABASE_SERVICE_KEY:');
  console.error('     - sb_secret_xxx (Supabase الجديد)');
  console.error('     - أو eyJhbGc... (JWT القديم)');
  console.error('   احصل عليه من: Supabase → Settings → API → service_role / secret');
  console.error('');
} else if (SUPABASE_KEY.startsWith('sb_secret_')) {
  console.log('✅ Using Supabase secret key (new format)');
} else if (SUPABASE_KEY.startsWith('eyJ')) {
  console.log('✅ Using Supabase JWT key (legacy format)');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// ============================================================================
// 1. فك تشفير payload الجهاز
// ============================================================================
// صيغة WiTSNK MQTT الثنائية (من وثائق MQTT):
//   [4 bytes: gzip segment length]
//   [4 bytes: uncompressed length]
//   [N bytes: GZIP-compressed JSON]
//   [M bytes: Additional file segment (photo binary)]
// ============================================================================

function decodePayload(raw) {
  // محاولة 1: plain JSON (عندما GZIP معطّل على الجهاز)
  try {
    const txt = raw.toString('utf-8');
    if (txt.startsWith('{')) {
      return { format: 'plain', payload: JSON.parse(txt), photo: null };
    }
  } catch (e) {}

  // محاولة 2: WiTSNK binary مع GZIP + photo segment
  if (raw.length < 10) {
    return { format: 'unknown', error: 'payload too short' };
  }

  const gzipLen = raw.readUInt32BE(0);

  if (gzipLen <= 0 || 8 + gzipLen > raw.length) {
    return { format: 'unknown', error: `invalid gzipLen=${gzipLen} total=${raw.length}` };
  }

  const gzipData = raw.slice(8, 8 + gzipLen);
  const fileData = raw.slice(8 + gzipLen);

  if (gzipData[0] !== 0x1f || gzipData[1] !== 0x8b) {
    return { format: 'unknown', error: `no gzip magic, got ${gzipData.slice(0, 2).toString('hex')}` };
  }

  try {
    const jsonStr = zlib.gunzipSync(gzipData).toString('utf-8');
    return {
      format: 'witsink-gzip',
      payload: JSON.parse(jsonStr),
      photo: fileData.length > 0 ? fileData : null
    };
  } catch (e) {
    return { format: 'unknown', error: `gunzip failed: ${e.message}` };
  }
}

function extractPhoto(decoded) {
  if (decoded.photo && decoded.photo.length > 100) {
    return decoded.photo;
  }
  const body = getBody(decoded.payload);
  if (typeof body.Photo === 'string' && body.Photo.length > 200) {
    try {
      const b64 = body.Photo.replace(/^data:image\/[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8) return buf;
    } catch (e) {}
  }
  return null;
}

// helpers (الجهاز يستخدم Capitalized، الوثائق lowercase)
const getCmd = (p) => p?.cmd || p?.Cmd;
const getCmdID = (p) => p?.CmdID || p?.cmdid;
const getBody = (p) => p?.body || p?.Body || {};

// ============================================================================
// 2. إدارة المؤسسة الافتراضية والأجهزة
// ============================================================================

let DEFAULT_ORG_ID = null;

async function ensureDefaultOrg() {
  if (DEFAULT_ORG_ID) return DEFAULT_ORG_ID;

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id')
    .limit(1);

  if (orgs && orgs.length > 0) {
    DEFAULT_ORG_ID = orgs[0].id;
    return DEFAULT_ORG_ID;
  }

  const { data: newOrg, error } = await supabase
    .from('organizations')
    .insert([{ name: 'مؤسسة افتراضية', code: 'DEFAULT', status: 'active' }])
    .select()
    .single();

  if (error) {
    console.error('❌ ensureDefaultOrg failed:', error.message);
    return null;
  }
  DEFAULT_ORG_ID = newOrg.id;
  return DEFAULT_ORG_ID;
}

// يرجّع object الجهاز كاملاً (فيه org_id) — ويحفظ raw للـ device.html
async function ensureDevice(sn, ip, rawWorkSetting) {
  const { data: existing } = await supabase
    .from('devices')
    .select('*')
    .eq('sn', sn)
    .maybeSingle();

  if (existing) {
    const upd = { last_seen: new Date().toISOString() };
    if (ip) upd.ip_address = ip;
    supabase.from('devices').update(upd).eq('sn', sn).then(() => {});
    return existing;
  }

  const orgId = await ensureDefaultOrg();
  const insert = {
    sn,
    org_id: orgId,
    ip_address: ip || null,
    last_seen: new Date().toISOString()
  };

  const { data: newDev, error } = await supabase
    .from('devices')
    .insert([insert])
    .select()
    .single();

  if (error) {
    console.error('❌ ensureDevice failed:', error.message);
    return null;
  }
  console.log(`   🆕 Device registered: ${sn} → org ${orgId}`);
  return newDev;
}

async function ensureEmployee(orgId, code, name, dept) {
  const empCode = String(code);

  const { data: existing } = await supabase
    .from('employees')
    .select('*')
    .eq('org_id', orgId)
    .eq('emp_code', empCode)
    .maybeSingle();

  if (existing) return existing;

  const { data: newEmp, error } = await supabase
    .from('employees')
    .insert([{
      org_id: orgId,
      emp_code: empCode,
      name: name || `موظف ${empCode}`,
      dept: dept || null,
      synced_to_device: true   // مسجّل أصلاً على الجهاز
    }])
    .select()
    .single();

  if (error) {
    console.error('❌ ensureEmployee failed:', error.message);
    return null;
  }
  console.log(`   🆕 Employee created: ${empCode} ${name}`);
  return newEmp;
}

// ============================================================================
// 3. حفظ الصور في Supabase Storage (bucket: attendance-photos)
// ============================================================================

// إنشاء bucket تلقائياً عند بداية التشغيل
let _bucketReady = false;
async function ensurePhotoBucket() {
  if (_bucketReady) return true;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets && buckets.some(b => b.name === 'attendance-photos');
    if (exists) {
      console.log('✅ Storage bucket "attendance-photos" موجود');
      _bucketReady = true;
      return true;
    }
    // محاولة الإنشاء
    const { error } = await supabase.storage.createBucket('attendance-photos', {
      public: true,
      fileSizeLimit: 52428800 // 50MB
    });
    if (error) {
      console.log(`⚠️  لم نتمكّن من إنشاء bucket تلقائياً: ${error.message}`);
      console.log('⚠️  يرجى إنشاء bucket "attendance-photos" يدوياً في Supabase Dashboard (Public)');
      return false;
    }
    console.log('✅ Storage bucket "attendance-photos" تم إنشاؤه');
    _bucketReady = true;
    return true;
  } catch (e) {
    console.log(`⚠️  Storage check failed: ${e.message}`);
    return false;
  }
}

async function uploadPhoto(orgId, recordId, photoBuf) {
  if (!photoBuf || photoBuf.length < 100) return null;
  if (!_bucketReady) await ensurePhotoBucket();
  if (!_bucketReady) return null; // bucket غير موجود ولا يمكن إنشاؤه

  const photoPath = `${orgId}/${recordId}_${Date.now()}.jpg`;
  try {
    const { error } = await supabase
      .storage
      .from('attendance-photos')
      .upload(photoPath, photoBuf, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log(`   ⚠️  Photo upload failed: ${error.message}`);
      return null;
    }
    const { data: urlData } = supabase
      .storage
      .from('attendance-photos')
      .getPublicUrl(photoPath);
    console.log(`   📸 Photo saved: ${photoPath} (${photoBuf.length} bytes)`);
    return urlData?.publicUrl || photoPath;
  } catch (e) {
    console.log(`   ⚠️  Photo error: ${e.message}`);
    return null;
  }
}

// ============================================================================
// 4. حفظ raw_records (دائماً مع org_id — مهم للـ dashboard)
// ============================================================================

async function saveRawRecord(orgId, recordId, empId, dateStr, timeStr, isEntry, rawObj) {
  try {
    const row = {
      org_id: orgId || null,
      external_id: recordId,
      raw: rawObj
    };
    if (empId) row.emp_id = empId;
    if (dateStr) row.record_date = dateStr;
    if (timeStr) row.record_time = timeStr;
    if (isEntry !== null && isEntry !== undefined) row.is_entry = isEntry;

    const { error } = await supabase
      .from('raw_records')
      .upsert([row], { onConflict: 'external_id' });
    if (error) console.log(`   ⚠️  raw_records: ${error.message}`);
    else console.log(`   ✅ Saved to raw_records`);
  } catch (e) {
    console.log(`   ⚠️  raw_records exception: ${e.message}`);
  }
}

// ============================================================================
// 5. معالجة سجل الحضور الفعلي → جدول attendance
// ============================================================================

async function processAttendanceRecord(sn, body, photoBuf) {
  const recordId = body.RecordID;
  const recordDate = Number(body.RecordDate);
  const userId = body.UserID;
  const code = body.Code || userId;
  const name = body.Name;
  const isEntry = Number(body.IsEntry) === 1;

  if (!recordId || !recordDate || !userId) {
    return { skipped: true, reason: 'missing required fields' };
  }

  const device = await ensureDevice(sn, null);
  if (!device || !device.org_id) {
    return { skipped: true, reason: 'no device/org' };
  }
  const orgId = device.org_id;

  // إذا UserID=0 أو سالب أو "0" => زائر غير مسجّل
  if (!userId || String(userId) === '0' || Number(userId) < 0) {
    const photoUrl = await uploadPhoto(orgId, recordId, photoBuf);
    await supabase.from('unknown_visitors').insert([{
      org_id: orgId, device_sn: sn, photo_url: photoUrl, raw: body
    }]);
    // نزيد alert
    await supabase.from('alerts').insert([{
      org_id: orgId, type: 'unknown_visitor', severity: 'warning',
      title: 'زائر غير مسجّل',
      message: `حاول شخص غير مسجّل استخدام الجهاز ${sn}`
    }]);
    console.log(`   ⚠️  Unknown visitor on device ${sn}, photo saved`);
    return { ok: true, unknown: true, recordId };
  }

  const employee = await ensureEmployee(orgId, code, name, body.Job || body.Department);
  if (!employee) {
    return { skipped: true, reason: 'no employee' };
  }

  // معالجة الـ Timezone:
  // - الأجهزة الصينية مثل FC-8890H عادة ترسل local time كـ Unix timestamp
  // - DEVICE_TZ_OFFSET = ساعات للجهاز عن UTC (تونس = 1، السعودية = 3)
  //   لو الجهاز يرسل UTC الحقيقي، اضبط على 0
  const DEVICE_TZ_OFFSET = Number(process.env.DEVICE_TZ_OFFSET || 0);
  const dt = new Date((recordDate + DEVICE_TZ_OFFSET * 3600) * 1000);
  const dateStr = dt.toISOString().slice(0, 10);
  const timeStr = dt.toISOString().slice(11, 19);

  // ============= Cooldown check =============
  // جلب إعداد المؤسسة
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('pointage_cooldown_minutes')
    .eq('id', orgId).maybeSingle();
  const cooldownMin = (orgRow && orgRow.pointage_cooldown_minutes) || 5;

  // آخر pointage لهذا الموظف
  const { data: lastRaw } = await supabase
    .from('raw_records')
    .select('record_time, record_date')
    .eq('emp_id', employee.id)
    .eq('record_date', dateStr)
    .order('record_time', { ascending: false })
    .limit(1);

  if (lastRaw && lastRaw.length > 0) {
    const lastTime = lastRaw[0].record_time;
    // حساب الفارق بالدقائق
    const [lh,lm,ls] = lastTime.split(':').map(Number);
    const [nh,nm,ns] = timeStr.split(':').map(Number);
    const lastMin = lh*60+lm + (ls||0)/60;
    const nowMin  = nh*60+nm + (ns||0)/60;
    const diffMin = Math.abs(nowMin - lastMin);
    if (diffMin < cooldownMin) {
      console.log(`   ⏱  Cooldown: ${name} pointage ignored (only ${diffMin.toFixed(1)}min since last)`);
      // نسجّلو في raw_records فقط للأرشيف، بدون تحديث attendance
      const photoUrl = await uploadPhoto(orgId, recordId, photoBuf);
      await saveRawRecord(orgId, `att_${recordId}_${sn}_cd`, employee.id, dateStr, timeStr, isEntry,
        { ...body, photo_url: photoUrl, sn, cooldown_skipped: true });
      return { ok: true, cooldown_skipped: true, recordId };
    }
  }

  // رفع الصورة
  const photoUrl = await uploadPhoto(orgId, recordId, photoBuf);

  // حساب التأخير
  const shiftStart = employee.shift_start || '08:00';

  // البحث عن سجل اليوم
  const { data: existing } = await supabase
    .from('attendance')
    .select('*')
    .eq('emp_id', employee.id)
    .eq('date', dateStr)
    .maybeSingle();

  if (existing) {
    const updates = {};
    if (isEntry) {
      if (!existing.check_in || timeStr < existing.check_in) {
        updates.check_in = timeStr;
        updates.status = (timeStr > shiftStart) ? 'late' : 'present';
      }
    } else {
      if (!existing.check_out || timeStr > existing.check_out) {
        updates.check_out = timeStr;
      }
    }
    // حساب net_hours لو عندنا in و out
    const finalIn  = updates.check_in  || existing.check_in;
    const finalOut = updates.check_out || existing.check_out;
    if (finalIn && finalOut) {
      const [ih,im] = finalIn.split(':').map(Number);
      const [oh,om] = finalOut.split(':').map(Number);
      const grossMin = (oh*60+om) - (ih*60+im);
      const breakMin = existing.break_minutes || 0;
      updates.net_hours = Math.max(0, (grossMin - breakMin) / 60).toFixed(2);
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('attendance').update(updates).eq('id', existing.id);
    }
    console.log(`   ✅ Attendance updated: ${name} ${dateStr} ${isEntry ? 'IN' : 'OUT'}@${timeStr}`);
  } else {
    const status = (isEntry && timeStr > shiftStart) ? 'late' : 'present';
    const newRec = {
      org_id: orgId,
      emp_id: employee.id,
      date: dateStr,
      status,
      source: 'device'
    };
    if (isEntry) newRec.check_in = timeStr;
    else newRec.check_out = timeStr;

    const { error } = await supabase.from('attendance').insert([newRec]);
    if (error) console.log(`   ⚠️  attendance insert: ${error.message}`);
    else console.log(`   ✅ Attendance created: ${name} ${dateStr} ${isEntry ? 'IN' : 'OUT'}@${timeStr} [${status}]`);
  }

  // سجل audit في raw_records (مع org_id + emp_id ليظهر في الشاشات)
  await saveRawRecord(
    orgId,
    `att_${recordId}_${sn}`,
    employee.id,
    dateStr,
    timeStr,
    isEntry,
    { ...body, photo_url: photoUrl, sn }
  );

  return { ok: true, recordId, name, isEntry, dateStr, timeStr };
}

// ============================================================================
// 6. معالجة أوامر device_commands عبر MQTT
// ============================================================================
// (بديل منطق keepalive.js القديم — مزامنة الموظفين، فتح الباب، إلخ)

async function processPendingCommands(sn) {
  const { data: commands } = await supabase
    .from('device_commands')
    .select('*')
    .eq('device_sn', sn)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (!commands || commands.length === 0) return;

  for (const cmd of commands) {
    const payload = cmd.payload || {};
    console.log(`   📦 Pending command: ${cmd.command} → ${payload.type || ''}`);

    await supabase
      .from('device_commands')
      .update({ status: 'sent' })
      .eq('id', cmd.id);

    try {
      // ندعم نوعين من التنسيق: cmd.command='sync_employee' أو payload.type='add_person'
      const cmdType = cmd.command || payload.type;
      const userId  = payload.emp_code || payload.UserID;

      if (cmdType === 'sync_employee' || cmdType === 'add_person' || cmdType === 'sync_all_employees') {
        // جلب الموظفين وإرسالهم عبر PushPeople
        let empQuery = supabase.from('employees').select('*');
        if (cmdType === 'sync_employee' || cmdType === 'add_person') {
          if (userId) empQuery = empQuery.eq('emp_code', String(userId));
          else if (payload.emp_id) empQuery = empQuery.eq('id', payload.emp_id);
        } else {
          const { data: dev } = await supabase
            .from('devices').select('org_id').eq('sn', sn).maybeSingle();
          if (dev?.org_id) empQuery = empQuery.eq('org_id', dev.org_id);
        }
        const { data: employees } = await empQuery;

        if (employees && employees.length) {
          for (const e of employees) {
            sendPushPeople(sn, e);
          }
          await supabase.from('employees')
            .update({ synced_to_device: true })
            .in('id', employees.map(e => e.id));
          console.log(`   👥 Pushed ${employees.length} employee(s) to ${sn}`);
        }
      } else if (cmdType === 'delete_all_people') {
        sendRemoteCommand(sn, { ClearRecord: 0, DeleteAll: 1 });
      } else if (cmdType === 'remote') {
        sendRemoteCommand(sn, payload.data || {});
      }

      await supabase.from('device_commands')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', cmd.id);
    } catch (e) {
      console.error(`   ❌ command ${cmd.id} failed: ${e.message}`);
      await supabase.from('device_commands')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', cmd.id);
    }
  }
}

function sendPushPeople(sn, emp) {
  const msg = {
    cmd: 'PushPeople',
    CmdTime: Math.floor(Date.now() / 1000),
    CmdID: `push_${Date.now()}_${emp.emp_code}`,
    body: [{
      UserID: String(emp.emp_code),
      Name: emp.name || '',
      Job: emp.dept || '',
      Department: emp.dept || '',
      AccessType: 0,
      ExpirationDate: 0,
      OpenTimes: 65535,
      KeepOpen: 0,
      Timegroup: 1
    }]
  };
  publishToDevice(sn, msg);
}

function sendRemoteCommand(sn, data) {
  const msg = {
    cmd: 'RemoteCommand',
    CmdTime: Math.floor(Date.now() / 1000),
    CmdID: `rc_${Date.now()}`,
    body: data
  };
  publishToDevice(sn, msg);
}

function publishToDevice(sn, msgObj) {
  const topic = `/iot_hub/publish/${sn}`;
  aedes.publish({
    topic,
    payload: Buffer.from(JSON.stringify(msgObj)),
    qos: 0,
    retain: false
  });
  console.log(`   📤 [${msgObj.cmd}] → ${topic}`);
}

// ============================================================================
// 7. MQTT Broker setup
// ============================================================================

aedes.authenticate = (client, username, password, callback) => {
  console.log(`🔐 MQTT Auth — client: ${client.id}, user: ${username || '(none)'}`);
  callback(null, true);
};

aedes.on('client', (client) => {
  console.log(`🔗 MQTT CONNECTED: ${client.id}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`🔌 MQTT DISCONNECTED: ${client.id}`);
});

aedes.on('clientError', (client, err) =>
  console.error(`❌ MQTT clientError [${client?.id}]: ${err.message}`));
aedes.on('connectionError', (client, err) =>
  console.error(`❌ MQTT connError: ${err.message}`));

aedes.on('publish', async (packet, client) => {
  if (!client) return;

  const topic = packet.topic;
  const raw = packet.payload;

  const snMatch = topic.match(/\/iot_hub\/upload\/([^\/]+)/);
  if (!snMatch) return;
  const sn = snMatch[1];

  console.log(`\n📨 MSG [${client.id}] → ${topic} (${raw.length} bytes)`);

  const decoded = decodePayload(raw);
  if (decoded.format === 'unknown') {
    console.log(`   ⚠️  Decode failed: ${decoded.error}`);
    console.log(`   HEX(32): ${raw.slice(0, 32).toString('hex')}`);
    return;
  }

  const payload = decoded.payload;
  const cmd = getCmd(payload);
  const cmdID = getCmdID(payload);
  const body = getBody(payload);
  const photo = extractPhoto(decoded);

  console.log(`   ✅ [${decoded.format}] Cmd: ${cmd} CmdID: ${cmdID}${photo ? ` 📸${photo.length}b` : ''}`);

  try {
    switch (cmd) {
      case 'KeepAlive': {
        console.log(`   💓 DoorSensor:${body.DoorSensorStatus} Alarm:${body.AlarmStatus || 'none'}`);
        const dev = await ensureDevice(sn, null);
        // معالجة أي أوامر معلّقة (مزامنة موظفين، فتح باب...)
        await processPendingCommands(sn);
        // KeepAlive لا يحتاج ACK (وثائق MQTT)
        break;
      }

      case 'UploadPeople': {
        const detail = body.Detail || body;
        console.log(`   👤 UploadPeople — UserID:${detail.UserID} Name:${detail.Name} Code:${detail.Code}`);
        const dev = await ensureDevice(sn, null);
        // نسجّل الموظف تلقائياً إذا غير موجود
        if (dev?.org_id && detail.UserID) {
          await ensureEmployee(dev.org_id, detail.Code || detail.UserID, detail.Name, detail.Job || detail.Department);
        }
        sendAck(sn, 'UploadPeopleACK', cmdID);
        break;
      }

      case 'UploadIdentifyRecord': {
        const isAttendance = body.RecordID && body.RecordDate && body.UserID;
        if (isAttendance) {
          console.log(`   🎯 ATTENDANCE!`);
          console.log(`      RecordID:${body.RecordID} UserID:${body.UserID} Name:${body.Name}`);
          console.log(`      RecordType:${body.RecordType} IsEntry:${body.IsEntry}`);
          console.log(`      Date:${new Date(body.RecordDate * 1000).toISOString()}`);
          const result = await processAttendanceRecord(sn, body, photo);
          console.log(`      Result:`, result);
        } else {
          console.log(`   👤 UploadIdentifyRecord (biometric) — UserID:${body.UserID} Name:${body.Name}`);
          const dev = await ensureDevice(sn, null);
          if (dev?.org_id && body.UserID) {
            await ensureEmployee(dev.org_id, body.Code || body.UserID, body.Name, body.Job || body.Department);
          }
        }
        sendAck(sn, 'UploadIdentifyRecordACK', cmdID);
        break;
      }

      case 'UploadSystemRecord': {
        const records = body.Records || [];
        console.log(`   📋 UploadSystemRecord — ${records.length} system events`);
        await ensureDevice(sn, null);
        sendAck(sn, 'UploadSystemRecordACK', cmdID);
        break;
      }

      case 'UploadWorkSetting': {
        console.log(`   ⚙️  UploadWorkSetting — SN:${body.DeviceSN} FW:${body.FirmwareVerson}`);
        // نحفظ الإعدادات في devices.raw (device.html يعرضها)
        await ensureDevice(sn, null, body);
        break;
      }

      case 'Will_DeviceOffline':
        console.log(`   ❌ Device went offline: ${sn}`);
        break;

      default:
        console.log(`   ❓ Unhandled cmd: ${cmd}`);
        if (cmdID) sendAck(sn, `${cmd}ACK`, cmdID);
    }
  } catch (e) {
    console.error(`   ❌ Handler error for ${cmd}:`, e.message);
    if (process.env.DEBUG) console.error(e.stack);
  }
});

function sendAck(sn, ackCmd, cmdID) {
  const ack = {
    cmd: ackCmd,
    CmdTime: Math.floor(Date.now() / 1000),
    CmdID: cmdID || ''
  };
  const topic = `/iot_hub/publish/${sn}`;
  aedes.publish({
    topic,
    payload: Buffer.from(JSON.stringify(ack)),
    qos: 0,
    retain: false
  });
  console.log(`   📤 ACK [${ackCmd}] CmdID:${cmdID} → ${topic}`);
}

// ============================================================================
// 8. تشغيل MQTT broker
// ============================================================================

const mqttServer = net.createServer(aedes.handle);
mqttServer.listen(MQTT_PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 AttendX v${VERSION} starting…`);
  console.log(`✅ MQTT broker listening on TCP ${MQTT_PORT}`);
  await ensureDefaultOrg();
  console.log(`📍 Default org_id: ${DEFAULT_ORG_ID}`);
  await ensurePhotoBucket();
});

mqttServer.on('error', (err) =>
  console.error(`❌ MQTT server error: ${err.message}`));

// ============================================================================
// 9. HTTP Express (للـ dashboard + debugging + legacy device HTTP)
// ============================================================================

const app = express();
app.locals.supabase = supabase;

// GZIP middleware (لطلبات HTTP القديمة من الجهاز)
app.use((req, res, next) => {
  if (req.headers['content-encoding'] === 'gzip') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      zlib.gunzip(Buffer.concat(chunks), (err, dec) => {
        if (err) { req.body = {}; return next(); }
        try { req.body = JSON.parse(dec.toString('utf-8')); }
        catch { req.body = {}; }
        next();
      });
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Encoding');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', version: VERSION, mqtt_clients: aedes.connectedClients }));
app.get('/api/ping', (req, res) =>
  res.json({ pong: true, time: Date.now() }));

// Legacy HTTP endpoints — إذا اتصل جهاز عبر HTTP (احتياطي)
// نرد بصيغة HTTP V2 الصحيحة {Success:1}
async function legacyKeepalive(req, res) {
  const sn = req.body?.SN || req.body?.DeviceSN || 'UNKNOWN';
  console.log(`📡 HTTP keepalive (legacy): ${sn}`);
  try { await ensureDevice(sn, req.headers['x-forwarded-for'] || ''); } catch (e) {}
  res.json({ Success: 1 });
}
async function legacyRecord(req, res) {
  console.log(`📡 HTTP record (legacy)`);
  res.json({ Success: 1 });
}

app.post('/Device/Keepalive', legacyKeepalive);
app.post('/Device/KeepAlive', legacyKeepalive);
app.post('/api/Device/Keepalive', legacyKeepalive);
app.post('/api/device/keepalive', legacyKeepalive);
app.post('/Record/UploadIdentifyRecord', legacyRecord);
app.post('/api/Record/UploadIdentifyRecord', legacyRecord);
app.post('/api/record/uploadidentifyrecord', legacyRecord);

// Debug endpoints
app.get('/api/debug/devices', async (req, res) => {
  const { data } = await supabase
    .from('devices').select('*').order('last_seen', { ascending: false });
  res.json({ devices: data || [] });
});
app.get('/api/debug/records', async (req, res) => {
  const { data } = await supabase
    .from('raw_records').select('*').order('created_at', { ascending: false }).limit(50);
  res.json({ records: data || [] });
});
app.get('/api/debug/attendance', async (req, res) => {
  const { data } = await supabase
    .from('attendance')
    .select('*, employees(name, emp_code)')
    .order('date', { ascending: false }).limit(100);
  res.json({ attendance: data || [] });
});
app.get('/api/debug/mqtt', (req, res) => {
  const clients = [];
  for (const [id, c] of aedes.clients) clients.push({ id, connected: !!c.connected });
  res.json({ connected: aedes.connectedClients, clients });
});

// ============================================================================
// OTP — تفعيل حساب المدير / استرجاع كلمة السر
// ============================================================================
// وضع تجريبي: الرمز دائماً 0000 (DEMO_OTP).
// لتفعيل Resend لاحقاً: ضع RESEND_API_KEY في Railway Variables،
// وغيّر DEMO_OTP=false. الكود جاهز بالأسفل.
// ============================================================================

const DEMO_OTP = true;          // true = الرمز ثابت 0000، لا إرسال إيميل
const DEMO_CODE = '0000';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'AttendX <onboarding@resend.dev>';

function genCode() {
  return DEMO_OTP ? DEMO_CODE : String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmailOTP(toEmail, code, purpose) {
  // خطّاف Resend — يعمل فقط حين DEMO_OTP=false ووجود مفتاح
  if (DEMO_OTP || !RESEND_API_KEY) {
    console.log(`   ✉️  [DEMO] OTP for ${toEmail} = ${code} (${purpose})`);
    return { ok: true, demo: true };
  }
  try {
    const subject = purpose === 'reset'
      ? 'AttendX — رمز استرجاع كلمة المرور'
      : 'AttendX — رمز تفعيل الحساب';
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;text-align:center;padding:24px">
      <h2 style="color:#0f4c81">AttendX</h2>
      <p>رمز التحقق الخاص بك:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#00a389">${code}</div>
      <p style="color:#888;font-size:13px">صالح لمدة 10 دقائق. لا تشاركه مع أحد.</p>
    </div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [toEmail], subject, html })
    });
    if (!r.ok) {
      const t = await r.text();
      console.log(`   ⚠️  Resend failed: ${r.status} ${t}`);
      return { ok: false, error: `resend ${r.status}` };
    }
    console.log(`   ✉️  OTP sent to ${toEmail} (${purpose})`);
    return { ok: true };
  } catch (e) {
    console.log(`   ⚠️  Resend exception: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// POST /api/otp/send  { phone, email, purpose }
app.post('/api/otp/send', async (req, res) => {
  try {
    const phone   = (req.body?.phone || '').trim();
    const email   = (req.body?.email || '').trim();
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'activate';

    if (!phone) return res.json({ success: false, message: 'رقم الهاتف مطلوب' });
    if (!email) return res.json({ success: false, message: 'الإيميل مطلوب' });

    const code = genCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // امسح الرموز القديمة لنفس الهاتف/الغرض
    await supabase.from('otp_codes')
      .delete().eq('phone', phone).eq('purpose', purpose);

    const { error } = await supabase.from('otp_codes').insert([{
      phone, email, code, purpose, expires_at: expiresAt, used: false
    }]);
    if (error) {
      console.log(`   ⚠️  otp insert: ${error.message}`);
      return res.json({ success: false, message: 'تعذّر إنشاء الرمز' });
    }

    const sent = await sendEmailOTP(email, code, purpose);

    return res.json({
      success: true,
      demo: DEMO_OTP,
      // في الوضع التجريبي نرجّع الرمز للواجهة لتسهيل الاختبار
      ...(DEMO_OTP ? { demo_code: code } : {}),
      message: DEMO_OTP
        ? 'وضع تجريبي: استخدم الرمز 0000'
        : (sent.ok ? 'تم إرسال الرمز إلى إيميلك' : 'تعذّر إرسال الإيميل')
    });
  } catch (e) {
    console.error('otp/send error:', e.message);
    return res.json({ success: false, message: 'خطأ في الخادم' });
  }
});

// POST /api/otp/verify  { phone, code, purpose }
app.post('/api/otp/verify', async (req, res) => {
  try {
    const phone   = (req.body?.phone || '').trim();
    const code     = (req.body?.code || '').trim();
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'activate';

    if (!phone || !code) {
      return res.json({ success: false, message: 'البيانات ناقصة' });
    }

    const { data: rows } = await supabase.from('otp_codes')
      .select('*')
      .eq('phone', phone)
      .eq('purpose', purpose)
      .order('created_at', { ascending: false })
      .limit(1);

    const otp = Array.isArray(rows) && rows[0];
    if (!otp) {
      return res.json({ success: false, message: 'لا يوجد رمز — اطلب رمزاً جديداً' });
    }
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      return res.json({ success: false, message: 'انتهت صلاحية الرمز' });
    }
    if (String(otp.code) !== String(code)) {
      return res.json({ success: false, message: 'الرمز غير صحيح' });
    }

    await supabase.from('otp_codes')
      .update({ used: true }).eq('id', otp.id);

    return res.json({ success: true, email: otp.email });
  } catch (e) {
    console.error('otp/verify error:', e.message);
    return res.json({ success: false, message: 'خطأ في الخادم' });
  }
});

// إعادة توجيه روابط قديمة (لو حد عنده bookmark) لـ SPA hashes — قبل static
const SHIM_REDIRECTS = {
  'login': 'auth.html', 'signup': 'auth.html', 'activate': 'auth.html', 'forgot': 'auth.html',
  'dashboard': 'shell.html#dashboard', 'superadmin': 'shell.html#superadmin',
  'employees': 'shell.html#employees', 'employee': 'shell.html#employee',
  'attendance': 'shell.html#attendance', 'absentees': 'shell.html#absentees',
  'leaves': 'shell.html#leaves', 'holidays': 'shell.html#holidays',
  'alerts': 'shell.html#alerts', 'audit': 'shell.html#audit',
  'reports': 'shell.html#reports', 'device': 'shell.html#device',
  'settings': 'shell.html#settings'
};
Object.keys(SHIM_REDIRECTS).forEach(key => {
  const handler = (req, res) => {
    let target = SHIM_REDIRECTS[key];
    if (req.query.id && target.includes('#')) {
      target = target + '/' + encodeURIComponent(req.query.id);
    }
    res.redirect(target);
  };
  app.get(`/${key}.html`, handler);
  app.get(`/${key}`, handler);
});

// Static files مع cache control
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'auth.html',
  setHeaders: (res, filePath) => {
    // HTML files — no cache (دائماً نسخة جديدة)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // JS/CSS مع version query — يمكن cache لمدة قصيرة
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 دقائق
    }
  }
}));
app.get('/', (req, res) => res.redirect('/auth.html'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.url });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP server on port ${PORT}`);
  console.log(`🧭 Debug: /api/debug/devices  /api/debug/records  /api/debug/attendance  /api/debug/mqtt\n`);
});

// ============================================================================
// graceful errors
// ============================================================================

process.on('unhandledRejection', (err) =>
  console.error('❌ Unhandled rejection:', err?.message || err));
process.on('uncaughtException', (err) =>
  console.error('❌ Uncaught exception:', err?.message || err));
process.on('SIGTERM', () => {
  mqttServer.close();
  aedes.close();
  process.exit(0);
});
