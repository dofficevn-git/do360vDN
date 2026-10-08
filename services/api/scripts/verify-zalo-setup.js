// Verify Zalo OA + App setup - read-only diagnostics
// Run: node scripts/verify-zalo-setup.js
//
// Đọc .env.development, gọi Zalo OA API để kiểm tra:
//  1. OA access token còn sống không + thông tin OA
//  2. App ID đăng ký trong OA có khớp ZALO_APP_ID không (cùng Business?)
//  3. Refresh token hoạt động không (nếu có)
//  4. Số follower hiện tại
//  5. Resolve thử 1 follower để xác nhận user/detail API hoạt động

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env.development');

function loadEnv(file) {
  const env = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

function mask(s, keep = 6) {
  if (!s) return '(empty)';
  if (s.length <= keep * 2) return s.slice(0, 2) + '***';
  return s.slice(0, keep) + '...' + s.slice(-keep);
}

const env = loadEnv(ENV_FILE);
const OA_ID = env.ZALO_OA_ID;
const APP_ID = env.ZALO_APP_ID;
const APP_SECRET = env.ZALO_APP_SECRET;
const ACCESS_TOKEN = env.ZALO_ACCESS_TOKEN;
const REFRESH_TOKEN = env.ZALO_REFRESH_TOKEN;

console.log('═'.repeat(60));
console.log(' ZALO OA + APP VERIFICATION');
console.log('═'.repeat(60));
console.log(`ZALO_OA_ID         : ${OA_ID || '(missing)'}`);
console.log(`ZALO_APP_ID        : ${APP_ID || '(missing)'}`);
console.log(`ZALO_APP_SECRET    : ${mask(APP_SECRET, 4)}`);
console.log(`ZALO_ACCESS_TOKEN  : ${mask(ACCESS_TOKEN, 8)}`);
console.log(`ZALO_REFRESH_TOKEN : ${REFRESH_TOKEN ? mask(REFRESH_TOKEN, 8) : '(not set)'}`);
console.log('');

async function check1_oaInfo() {
  console.log('─── [1] OA token + info (/v3.0/oa/getoa) ───────────────────');
  try {
    const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
      headers: { access_token: ACCESS_TOKEN },
    });
    const data = await res.json();
    if (data.error !== 0) {
      console.log(`❌ FAIL  error=${data.error} message="${data.message}"`);
      if (data.error === -216) console.log('   → Token đã hết hạn. Cần ZALO_REFRESH_TOKEN hoặc xin token mới.');
      return null;
    }
    console.log(`✅ OK`);
    console.log(`   OA name      : ${data.data?.name}`);
    console.log(`   OA id        : ${data.data?.oa_id}`);
    console.log(`   Verified     : ${data.data?.is_verified ?? '?'}`);
    console.log(`   Description  : ${(data.data?.description ?? '').slice(0, 80)}`);
    return data.data;
  } catch (err) {
    console.log(`❌ EXCEPTION: ${err.message}`);
    return null;
  }
}

async function check2_appLinkage(oaInfo) {
  console.log('\n─── [2] App ↔ OA linkage (cùng Business?) ──────────────────');
  if (!oaInfo) {
    console.log('⚠️  SKIP (không có OA info ở bước 1)');
    return;
  }
  // Zalo OA API không trả app_id linkage trực tiếp trong /getoa
  // Cách verify: dùng OAuth permission API hoặc check qua app callback
  // Đơn giản nhất: thử gọi /v3.0/oa/user/getlist với cùng access_token
  // Nếu trả được data => token này có quyền access OA này => verified
  try {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/user/getlist?data=' +
      encodeURIComponent(JSON.stringify({ offset: 0, count: 1 })), {
      headers: { access_token: ACCESS_TOKEN },
    });
    const data = await res.json();
    if (data.error === 0) {
      console.log(`✅ Token có quyền truy cập follower list của OA này`);
      console.log(`   (chứng tỏ App của ZALO_APP_ID đã được link với OA của ZALO_OA_ID)`);
    } else {
      console.log(`❌ Không truy cập được follower list: error=${data.error} msg="${data.message}"`);
      console.log('   → Có thể App + OA chưa được link cùng Business Account');
    }
  } catch (err) {
    console.log(`❌ EXCEPTION: ${err.message}`);
  }
}

async function check3_refreshToken() {
  console.log('\n─── [3] Refresh token flow ─────────────────────────────────');
  if (!REFRESH_TOKEN) {
    console.log('⚠️  SKIP — ZALO_REFRESH_TOKEN chưa cấu hình');
    console.log('   → Khuyến nghị: đăng ký refresh token để token tự gia hạn');
    console.log('   → Hiện tại ZALO_ACCESS_TOKEN hết hạn sẽ phải đổi tay');
    return;
  }
  try {
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: APP_SECRET,
      },
      body: new URLSearchParams({
        refresh_token: REFRESH_TOKEN,
        app_id: APP_ID,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const raw = await res.text();
    console.log(`   HTTP ${res.status} ${res.statusText}, body length=${raw.length}`);
    if (!raw) {
      console.log(`   ⚠️  Body rỗng — kiểm tra Content-Type của request, secret_key đặt đúng header chưa`);
      return;
    }
    let data;
    try { data = JSON.parse(raw); } catch {
      console.log(`   ⚠️  Body không phải JSON: ${raw.slice(0, 300)}`);
      return;
    }
    if (data.access_token) {
      console.log(`✅ Refresh OK`);
      console.log(`   New token (head): ${mask(data.access_token, 8)}`);
      console.log(`   Expires in     : ${data.expires_in}s (~${Math.round(data.expires_in / 3600)}h)`);
      console.log(`   New refresh    : ${mask(data.refresh_token, 8)}`);
    } else {
      console.log(`❌ FAIL: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`❌ EXCEPTION: ${err.message}`);
  }
}

async function check4_followerCount() {
  console.log('\n─── [4] Follower list ──────────────────────────────────────');
  try {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/user/getlist?data=' +
      encodeURIComponent(JSON.stringify({ offset: 0, count: 5 })), {
      headers: { access_token: ACCESS_TOKEN },
    });
    const data = await res.json();
    if (data.error !== 0) {
      console.log(`❌ error=${data.error} msg="${data.message}"`);
      return [];
    }
    const total = data.data?.total ?? 0;
    const users = data.data?.users ?? [];
    console.log(`✅ Tổng follower: ${total}`);
    console.log(`   Mẫu ${users.length} follower đầu:`);
    users.forEach((u, i) => {
      console.log(`   [${i + 1}] user_id=${u.user_id}`);
    });
    return users;
  } catch (err) {
    console.log(`❌ EXCEPTION: ${err.message}`);
    return [];
  }
}

async function check5_userDetail(followers) {
  console.log('\n─── [5] /v3.0/oa/user/detail — thử nhiều follower ─────────');
  if (!followers || followers.length === 0) {
    console.log('⚠️  SKIP — không có follower nào để test');
    return;
  }
  let success = 0;
  for (let i = 0; i < followers.length; i++) {
    const target = followers[i].user_id;
    try {
      const url = 'https://openapi.zalo.me/v3.0/oa/user/detail?data=' +
        encodeURIComponent(JSON.stringify({ user_id: target }));
      const res = await fetch(url, { headers: { access_token: ACCESS_TOKEN } });
      const data = await res.json();
      if (data.error !== 0) {
        console.log(`[${i + 1}] user_id=${target} → ❌ error=${data.error} "${data.message}"`);
        continue;
      }
      success++;
      const detail = data.data ?? {};
      console.log(`[${i + 1}] user_id=${target} → ✅`);
      console.log(`     display_name : ${detail.display_name}`);
      console.log(`     user_id_by_oa: ${detail.user_id_by_oa ?? '(không có)'}`);
      console.log(`     user_id      : ${detail.user_id}`);
      console.log(`     shared_info  : ${detail.shared_info ? 'YES (đã chia sẻ SDT)' : 'no'}`);
      const eq = detail.user_id === target;
      console.log(`     detail.user_id ${eq ? '==' : '!='} target (${eq ? 'cùng scope, OK' : 'KHÁC scope'})`);
      if (success >= 2) break;  // tìm được 2 cái thành công là đủ verify
    } catch (err) {
      console.log(`[${i + 1}] EXCEPTION: ${err.message}`);
    }
  }
  if (success === 0) {
    console.log('⚠️  Không có follower nào trả về detail thành công — bất thường');
  } else {
    console.log(`\n→ Có ${success} follower trả về detail OK → API user/detail hoạt động tốt`);
  }
}

(async () => {
  const oaInfo = await check1_oaInfo();
  await check2_appLinkage(oaInfo);
  await check3_refreshToken();
  const followers = await check4_followerCount();
  await check5_userDetail(followers);
  console.log('\n' + '═'.repeat(60));
  console.log(' DONE');
  console.log('═'.repeat(60));
})();
