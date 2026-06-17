export default {
  async fetch(request, env, ctx) {
    // Handle favicon 2
    if (request.method === 'GET' && new URL(request.url).pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    
    if ((path === '/' || path === '') && request.method === 'GET') {
      return handleAdminPage(env);
    }
    
    if (path === '/api/login' && request.method === 'POST') {
      return handleAdminLogin(request, env);
    }
    
    if (path === '/api/leads' && request.method === 'GET') {
      return handleAdminGetLeads(request, env);
    }
    
    if (path === '/api/client-leads' && request.method === 'GET') {
      return handleGetClientLeads(request, env);
    }
    
    if (path === '/api/leads/batch-update' && request.method === 'POST') {
      return handleAdminBatchUpdate(request, env);
    }
    
    if (path === '/api/export' && request.method === 'GET') {
      return handleAdminExport(request, env);
    }

    if (path === '/api/reinstatement-leads' && request.method === 'GET') {
      return handleGetReinstatementLeads(request, env);
    }

    // Hotline handlers
    if (path === '/api/get-hotline-tel' && request.method === 'GET') {
      return handleGetHotlineTel(request, env);
    }
    if (path === '/api/update-hotline-tel' && request.method === 'POST') {
      return handleUpdateHotlineTel(request, env);
    }
    if (path === '/api/get-hotline-form' && request.method === 'GET') {
      return handleGetHotlineForm(request, env);
    }
    if (path === '/api/update-hotline-form' && request.method === 'POST') {
      return handleUpdateHotlineForm(request, env);
    }
    if (path === '/api/get-hotline-msg' && request.method === 'GET') {
      return handleGetHotlineMsg(request, env);
    }
    if (path === '/api/update-hotline-msg' && request.method === 'POST') {
      return handleUpdateHotlineMsg(request, env);
    }

    // Agent management
    if (path === '/api/get-agents' && request.method === 'GET') {
      return handleGetAgents(request, env);
    }
if (path === '/api/conversion-trend' && request.method === 'GET') {
  return handleConversionTrend(env, request);
}

if (path === '/api/combined-conversion-stats' && request.method === 'GET') {
  return handleCombinedConversionStats(env, request);
}

if (path === '/api/export-reinstatement-to-sheets' && request.method === 'POST') {
  return handleExportReinstatementToSheets(request, env);
}
    if (path === '/api/debug-all-vars' && request.method === 'GET') {
  return handleDebugAllVars(request, env);
}
    return new Response('Not found', { status: 404 });
  }
};

async function handleExportReinstatementToSheets(request, env) {
  try {
    const { leads } = await request.json();
    
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "没有选择客户" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Get credentials from environment variables
    const serviceAccountJson = await env.AGENT_PHONE_MAP.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    const spreadsheetId = await env.AGENT_PHONE_MAP.get("GOOGLE_SPREADSHEET_ID");
    
    if (!serviceAccountJson || !spreadsheetId) {
      return new Response(JSON.stringify({ success: false, error: "Google Sheets 未配置" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Get access token using service account
    const accessToken = await getGoogleAccessToken(serviceAccountJson);
    
    // Prepare records for Google Sheets
    const now = new Date();
    // Format: 2026-06-04 10:00:00+08:00
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds} +0800`;
    
    const conversionNameMap = {
      'tel': 'phoneclick',
      'form': 'form',
      'msg': 'msg',
      'whatsapp': 'msg',
      'wechat': 'msg',
      'messenger': 'msg'
    };
    
    // Build rows for Google Sheets
    const rows = [];
    for (const lead of leads) {
      const conversionName = conversionNameMap[lead.click_type] || 'unknown';
      let adjustmentType = 'RESTATE';
      let adjustedValue = lead.value;
      
      if (lead.value === 0 || lead.value === '0') {
        adjustmentType = 'RETRACT';
        adjustedValue = '';
      }
      
      rows.push([
        lead.client_id,                    // Order ID
        conversionName,                    // Conversion Name
        formattedTime,                     // Adjustment Time
        adjustmentType,                    // Adjustment Type
        adjustedValue,                     // Adjusted Value
        'HKD',                             // Adjustment Currency
        lead.gclid || ''                   // GCLID
      ]);
    }
    
    // Append to Google Sheets
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:G:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: rows
        })
      }
    );
    
    const result = await response.json();
    
    if (response.ok) {
      // Update database to mark as exported (optional)
      const successfulIds = leads.map(l => l.client_id);
      const placeholders = successfulIds.map(() => "?").join(",");
      const nowIso = new Date().toISOString();
      
      await env.lead_db.prepare(`
         UPDATE leads 
         SET reinstatement_submitted_at = ?
         WHERE client_id IN (${placeholders})
       `).bind(nowIso, ...successfulIds).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: `成功导出 ${rows.length} 条记录到 Google Sheets`,
        rows_added: rows.length
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      console.error("Google Sheets API error:", result);
      return new Response(JSON.stringify({
        success: false,
        error: result.error?.message || "导出失败"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
  } catch (error) {
    console.error("Export to sheets error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function getGoogleAccessToken(serviceAccountJson) {
  try {
    const credentials = JSON.parse(serviceAccountJson);
    
    // Create JWT header and payload
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    
    // Base64url encode
    const encodedHeader = btoa(JSON.stringify(header))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    const encodedPayload = btoa(JSON.stringify(payload))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    const message = `${encodedHeader}.${encodedPayload}`;
    
    // For Cloudflare Workers environment
    // You'll need to implement RSA signing
    // This is a simplified version - you may need to use Web Crypto API
    const encoder = new TextEncoder();
    const messageBuffer = encoder.encode(message);
    
    // Parse PEM private key
    const privateKey = credentials.private_key;
    
    // Remove PEM headers and decode base64
    const pemHeader = "-----BEGIN PRIVATE KEY-----\n";
    const pemFooter = "\n-----END PRIVATE KEY-----";
    let pemContent = privateKey;
    if (privateKey.includes(pemHeader)) {
      pemContent = privateKey.replace(pemHeader, '').replace(pemFooter, '');
    }
    pemContent = pemContent.replace(/\n/g, '');
    
    const binaryDer = atob(pemContent);
    const keyBuffer = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
      keyBuffer[i] = binaryDer.charCodeAt(i);
    }
    
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      cryptoKey,
      messageBuffer
    );
    
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    const jwt = `${message}.${encodedSignature}`;
    
    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || tokenData.error);
    }
    
    return tokenData.access_token;
    
  } catch (error) {
    console.error("Token generation error:", error);
    throw error;
  }
}

async function handleCombinedConversionStats(env, request) {
  try {
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get('date_from') || '';
    const dateTo = url.searchParams.get('date_to') || '';
    
    // Build date filter condition
    let dateCondition = '';
    let params = [];
    
    if (dateFrom && dateTo) {
      dateCondition = ' AND date(created_at) >= date(?) AND date(created_at) <= date(?)';
      params.push(dateFrom, dateTo);
    } else if (dateFrom) {
      dateCondition = ' AND date(created_at) >= date(?)';
      params.push(dateFrom);
    } else if (dateTo) {
      dateCondition = ' AND date(created_at) <= date(?)';
      params.push(dateTo);
    }
    
    // Paid stats query (with gclid)
    const paidSql = `
      WITH paid AS (
        SELECT value AS ConvValue
        FROM (
          SELECT 
              value,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY verified_at DESC) as rn
          FROM leads
          WHERE (gclid IS NOT NULL AND gclid != '') ${dateCondition}
        )
        WHERE rn = 1
      )
      SELECT 
        CASE 
          WHEN ConvValue IS NULL THEN '-'
          WHEN ConvValue = '0' THEN '0'
          ELSE '>0'
        END AS Conversion_Category,
        COUNT(*) AS Record_Count
      FROM paid
      GROUP BY Conversion_Category
    `;
    
    // Non-paid stats query (no gclid)
    const nonpaidSql = `
      WITH nonpaid AS (
        SELECT value AS ConvValue
        FROM (
          SELECT 
              value,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY verified_at DESC) as rn
          FROM leads
          WHERE (gclid IS NULL OR gclid = '') ${dateCondition}
        )
        WHERE rn = 1
      )
      SELECT 
        CASE 
          WHEN ConvValue IS NULL THEN '-'
          WHEN ConvValue = '0' THEN '0'
          ELSE '>0'
        END AS Conversion_Category,
        COUNT(*) AS Record_Count
      FROM nonpaid
      GROUP BY Conversion_Category
    `;
    
    // Execute queries
    const paidStmt = await env.lead_db.prepare(paidSql);
    const paidResult = await paidStmt.bind(...params).all();
    
    const nonpaidStmt = await env.lead_db.prepare(nonpaidSql);
    const nonpaidResult = await nonpaidStmt.bind(...params).all();
    
    // Create maps for easy lookup
    const paidMap = {};
    const nonpaidMap = {};
    let paidTotal = 0;
    let nonpaidTotal = 0;
    
    for (const row of paidResult.results) {
      paidMap[row.Conversion_Category] = row.Record_Count;
      paidTotal += row.Record_Count;
    }
    
    for (const row of nonpaidResult.results) {
      nonpaidMap[row.Conversion_Category] = row.Record_Count;
      nonpaidTotal += row.Record_Count;
    }
    
    // Define categories in order
    const categories = ['-', '0', '>0'];
    const categoryLabels = {
      '-': '未验证',
      '0': '无关查询',
      '>0': '有效查询'
    };
    
    const stats = [];
    for (const cat of categories) {
      stats.push({
        category: cat,
        label: categoryLabels[cat],
        paid_count: paidMap[cat] || 0,
        paid_percent: paidTotal > 0 ? ((paidMap[cat] || 0) * 100 / paidTotal).toFixed(1) + '%' : '0%',
        nonpaid_count: nonpaidMap[cat] || 0,
        nonpaid_percent: nonpaidTotal > 0 ? ((nonpaidMap[cat] || 0) * 100 / nonpaidTotal).toFixed(1) + '%' : '0%'
      });
    }
    
    return new Response(JSON.stringify({
      success: true,
      stats: stats,
      paid_total: paidTotal,
      nonpaid_total: nonpaidTotal
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Combined conversion stats error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleDebugAllVars(request, env) {
  try {
    // Read all credentials from KV
    const clientId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_ID");
    const clientSecret = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_SECRET");
    const refreshToken = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_REFRESH_TOKEN");
    const developerToken = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const customerId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CUSTOMER_ID");
    const telId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_tel");
    const formId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_form");
    const msgId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_msg");
    
    // Test access token generation
    let tokenResult = { success: false, error: null, token_preview: null };
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });
      const tokenData = await tokenResponse.json();
      if (tokenResponse.ok && tokenData.access_token) {
        tokenResult = {
          success: true,
          token_preview: tokenData.access_token.substring(0, 30) + "...",
          expires_in: tokenData.expires_in
        };
      } else {
        tokenResult = {
          success: false,
          error: tokenData.error,
          error_description: tokenData.error_description
        };
      }
    } catch (e) {
      tokenResult = { success: false, error: e.message };
    }
    
    // Return all variable statuses
    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      variables: {
        GOOGLE_ADS_CLIENT_ID: {
          exists: !!clientId,
          preview: clientId ? clientId.substring(0, 40) + "..." : null
        },
        GOOGLE_ADS_CLIENT_SECRET: {
          exists: !!clientSecret,
          preview: clientSecret ? clientSecret.substring(0, 10) + "..." : null
        },
        GOOGLE_ADS_REFRESH_TOKEN: {
          exists: !!refreshToken,
          preview: refreshToken ? refreshToken.substring(0, 30) + "..." : null,
          length: refreshToken ? refreshToken.length : 0
        },
        GOOGLE_ADS_DEVELOPER_TOKEN: {
          exists: !!developerToken,
          preview: developerToken ? developerToken.substring(0, 15) + "..." : null
        },
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: {
          exists: !!loginCustomerId,
          value: loginCustomerId || null
        },
        GOOGLE_ADS_CUSTOMER_ID: {
          exists: !!customerId,
          value: customerId || null
        },
        GOOGLE_ADS_CONVERSION_ACTION_ID_tel: {
          exists: !!telId,
          value: telId || null
        },
        GOOGLE_ADS_CONVERSION_ACTION_ID_form: {
          exists: !!formId,
          value: formId || null
        },
        GOOGLE_ADS_CONVERSION_ACTION_ID_msg: {
          exists: !!msgId,
          value: msgId || null
        }
      },
      token_test: tokenResult
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}


// ============================================
// Hotline Handler Functions
// ============================================

async function handleGetHotlineTel(request, env) {
  try {
    const value = await env.AGENT_PHONE_MAP.get("general_enquiry");
    return new Response(JSON.stringify({ success: true, value: value || "" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleUpdateHotlineTel(request, env) {
  try {
    const { value } = await request.json();
    if (!value) {
      return new Response(JSON.stringify({ success: false, error: "缺少數值" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    await env.AGENT_PHONE_MAP.put("general_enquiry", value);
    return new Response(JSON.stringify({ success: true, message: "已更新" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleGetHotlineForm(request, env) {
  try {
    const value = await env.AGENT_PHONE_MAP.get("general_enquiry_form");
    return new Response(JSON.stringify({ success: true, value: value || "" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleUpdateHotlineForm(request, env) {
  try {
    const { value } = await request.json();
    if (!value) {
      return new Response(JSON.stringify({ success: false, error: "缺少數值" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    await env.AGENT_PHONE_MAP.put("general_enquiry_form", value);
    return new Response(JSON.stringify({ success: true, message: "已更新" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleGetHotlineMsg(request, env) {
  try {
    const value = await env.AGENT_PHONE_MAP.get("general_enquiry_msg");
    return new Response(JSON.stringify({ success: true, value: value || "" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleUpdateHotlineMsg(request, env) {
  try {
    const { value } = await request.json();
    if (!value) {
      return new Response(JSON.stringify({ success: false, error: "缺少數值" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    await env.AGENT_PHONE_MAP.put("general_enquiry_msg", value);
    return new Response(JSON.stringify({ success: true, message: "已更新" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// ============================================
// Agent Management Functions
// ============================================

async function handleGetAgents(request, env) {
  try {
    const stmt = await env.lead_db.prepare(`
      SELECT id, agent_name, phone_number, dingtalk_id, is_active
      FROM agents
      WHERE is_active = 1
      ORDER BY agent_name
    `);
    const result = await stmt.all();
    
    return new Response(JSON.stringify({
      success: true,
      agents: result.results
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// ============================================
// Admin Login
// ============================================

async function handleAdminLogin(request, env) {
  try {
    const { phone, password } = await request.json();
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let adminPhones = [];
    try {
      const adminsJson = await env.AGENT_PHONE_MAP.get('admins');
      if (adminsJson) adminPhones = JSON.parse(adminsJson);
    } catch (e) {}
    
    if (!adminPhones.includes(phone)) {
      return new Response(JSON.stringify({ success: false, error: '手机号不在管理员列表中' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const token = btoa(phone + ':' + Date.now());
    return new Response(JSON.stringify({ success: true, token: token, phone: phone }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// Get Client Leads
// ============================================

async function handleGetClientLeads(request, env) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id');
    
    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: '缺少 client_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const stmt = await env.lead_db.prepare(`
      SELECT id, client_id, status, verified_by, verified_at, created_at, value
      FROM leads 
      WHERE client_id = ?
      ORDER BY created_at ASC
    `);
    
    const result = await stmt.bind(clientId).all();
    
    return new Response(JSON.stringify({
      success: true,
      client_id: clientId,
      leads: result.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Get client leads error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// Admin Get Leads
// ============================================

async function handleAdminGetLeads(request, env) {
  try {
    const url = new URL(request.url);
    
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = (page - 1) * limit;
    
    const status = url.searchParams.get('status') || '';
    const agent = url.searchParams.get('agent') || '';
    const trafficType = url.searchParams.get('traffic_type') || '';
    const dateFrom = url.searchParams.get('date_from') || '';
    const dateTo = url.searchParams.get('date_to') || '';
    const search = url.searchParams.get('search') || '';
    
    const sortBy = url.searchParams.get('sort_by') || 'id';
    const sortOrder = url.searchParams.get('sort_order') || 'DESC';
    
    const whereConditions = [];
    const params = [];
    
    if (status) {
      whereConditions.push('status = ?');
      params.push(status);
    }
    if (agent) {
      whereConditions.push('agent_name = ?');
      params.push(agent);
    }
    if (trafficType) {
      whereConditions.push('traffic_type = ?');
      params.push(trafficType);
    }
    if (dateFrom) {
      whereConditions.push('date(created_at) >= date(?)');
      params.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push('date(created_at) <= date(?)');
      params.push(dateTo);
    }
    if (search) {
      whereConditions.push('(client_id LIKE ? OR agent_name LIKE ? OR district LIKE ?)');
      params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    const countStmt = await env.lead_db.prepare(`SELECT COUNT(*) as total FROM leads ${whereClause}`);
    const countResult = await countStmt.bind(...params).first();
    const total = countResult.total;
    
    const dataStmt = await env.lead_db.prepare(`
      SELECT id, client_id, user_ip, agent_name, agent_phone, click_type,
        rent, property_price, size, district, property_type,
        landing_page, page_location, page_referrer,
        utm_source, utm_medium, utm_campaign, gclid,
        traffic_type, traffic_source, campaign_name,
        value, status, verified_by, created_at, time_to_conversion, verified_at, budget_range, transaction_type
      FROM leads
    LEFT JOIN campaign c ON utm_id = c.campaign_id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `);
    
    const dataResult = await dataStmt.bind(...params, limit, offset).all();
    
    const agentsStmt = await env.lead_db.prepare(`
      SELECT DISTINCT agent_name FROM leads WHERE agent_name IS NOT NULL AND agent_name != ''
    `).all();
    
    const trafficStmt = await env.lead_db.prepare(`
      SELECT DISTINCT traffic_type FROM leads WHERE traffic_type IS NOT NULL AND traffic_type != ''
    `).all();
    
    const clientCountStmt = await env.lead_db.prepare(`
      SELECT client_id, COUNT(*) as count FROM leads 
      WHERE client_id IS NOT NULL AND client_id != '' 
      GROUP BY client_id
    `).all();
    const clientCounts = {};
    for (const row of clientCountStmt.results) {
      clientCounts[row.client_id] = row.count;
    }
    
    const verifiedClientsStmt = await env.lead_db.prepare(`
      SELECT DISTINCT client_id FROM leads WHERE status = 'verified' AND client_id IS NOT NULL AND client_id != ''
    `).all();
    const verifiedClientIds = verifiedClientsStmt.results.map(r => r.client_id);
    
    return new Response(JSON.stringify({
      success: true,
      data: dataResult.results,
      clientCounts: clientCounts,
      verifiedClientIds: verifiedClientIds,
      pagination: {
        page: page,
        limit: limit,
        total: total,
        totalPages: Math.ceil(total / limit)
      },
      filters: {
        agents: agentsStmt.results.map(r => r.agent_name),
        trafficTypes: trafficStmt.results.map(r => r.traffic_type)
      }
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Get leads error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

// ============================================
// Admin Batch Update
// ============================================
async function handleAdminBatchUpdate(request, env) {
  try {
    const { leads, budgets, values, transactionTypes, verifiedBy } = await request.json();
    
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return new Response(JSON.stringify({ success: false, error: '没有选择线索' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    const now = new Date().toISOString();
    const results = [];
    
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      try {
        const budgetValue = (budgets && budgets[i]) ? budgets[i] : '';
        const transactionType = (transactionTypes && transactionTypes[i]) ? transactionTypes[i] : null;
        const verifiedByValue = (verifiedBy && verifiedBy[i] !== undefined && verifiedBy[i] !== '') ? verifiedBy[i] : null;
        let value = (values && values[i]) !== undefined ? values[i] : null;
        
        let newStatus;
        if (value === null || value === undefined || value === '') { 
          newStatus = 'pending'; 
          value = null; 
        } else if (value === 0) { 
          newStatus = 'rejected'; 
        } else { 
          newStatus = 'verified'; 
        }
        
        let updateStmt, params;
        
        if (newStatus === 'verified') {
          updateStmt = await env.lead_db.prepare(`
            UPDATE leads 
            SET status = ?, 
                verified_at = ?, 
                verified_by = COALESCE(?, verified_by), 
                budget_range = ?, 
                value = ?, 
                transaction_type = COALESCE(?, transaction_type) 
            WHERE id = ?
          `);
          params = [newStatus, now, verifiedByValue, budgetValue, value, transactionType, lead.id];
          
        } else if (newStatus === 'rejected') {
          updateStmt = await env.lead_db.prepare(`
            UPDATE leads 
            SET status = ?, 
                verified_at = ?, 
                verified_by = COALESCE(?, verified_by), 
                budget_range = ?, 
                value = ?, 
                transaction_type = COALESCE(?, transaction_type) 
            WHERE id = ?
          `);
          params = [newStatus, now, verifiedByValue, budgetValue, 0, transactionType, lead.id];
          
        } else { // pending
          updateStmt = await env.lead_db.prepare(`
            UPDATE leads 
            SET status = ?, 
                verified_at = NULL, 
                verified_by = NULL, 
                budget_range = NULL, 
                value = NULL, 
                transaction_type = COALESCE(?, transaction_type) 
            WHERE id = ?
          `);
          params = [newStatus, transactionType, lead.id];
        }
        
        const result = await updateStmt.bind(...params).run();
        results.push({ 
          id: lead.id, 
          success: result.meta.rows_written > 0, 
          status: newStatus 
        });
        
      } catch (err) {
        results.push({ 
          id: lead.id, 
          success: false, 
          error: err.message 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    return new Response(JSON.stringify({ 
      success: true, 
      results: results, 
      summary: { 
        total: leads.length, 
        success: successCount, 
        failed: failCount 
      } 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Batch update error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

// ============================================
// Admin Export
// ============================================

async function handleAdminExport(request, env) {
  try {
    const url = new URL(request.url);
    const all = url.searchParams.get('all') === 'true';
    
    let whereConditions = [];
    let params = [];
    
    // Only apply filters if not exporting all
    if (!all) {
      const status = url.searchParams.get('status') || '';
      const agent = url.searchParams.get('agent') || '';
      const dateFrom = url.searchParams.get('date_from') || '';
      const dateTo = url.searchParams.get('date_to') || '';
      
      if (status) { whereConditions.push('status = ?'); params.push(status); }
      if (agent) { whereConditions.push('agent_name = ?'); params.push(agent); }
      if (dateFrom) { whereConditions.push('date(created_at) >= date(?)'); params.push(dateFrom); }
      if (dateTo) { whereConditions.push('date(created_at) <= date(?)'); params.push(dateTo); }
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    const stmt = await env.lead_db.prepare(`
      SELECT id, client_id, user_id, agent_name, click_type, rent, district, property_type, 
             utm_source, utm_medium, utm_campaign, gclid, traffic_type, campaign_name,
             value, status, verified_by, created_at, time_to_conversion, verified_at, budget_range, transaction_type 
      FROM leads 
      LEFT JOIN campaign c ON utm_id = c.campaign_id
      ${whereClause}
      ORDER BY id DESC
    `);
    
    const result = await stmt.bind(...params).all();
    const leads = result.results;
    
    const headers = ['ID', '客户号', '代理', '点击类型', '租金', '区域', '物业类型', 
                     'UTM来源', 'UTM媒介', 'Campaign', 'GCLID', '流量类型',
                     '预算', '价值', '状态', '处理人', '创建时间', '处理时间', '交易类型'];
    const csvRows = [headers.join(',')];
    
    for (const lead of leads) {
      const row = [
        lead.id,
        '"' + (lead.client_id || '') + '"',
        '"' + (lead.user_ip || '') + '"',        
        '"' + (lead.agent_name || '') + '"',
        '"' + (lead.click_type || '') + '"',
        '"' + (lead.rent || '') + '"',
        '"' + (lead.district || '') + '"',
        '"' + (lead.property_type || '') + '"',
        '"' + (lead.utm_source || '') + '"',
        '"' + (lead.utm_medium || '') + '"',
        '"' + (lead.campaign_name || '') + '"',
        '"' + (lead.gclid || '') + '"',
        '"' + (lead.traffic_type || '') + '"',
        '"' + (lead.budget_range || '') + '"',
        (lead.value === null || lead.value === undefined) ? '-' : lead.value,
        lead.status || '',
        '"' + (lead.verified_by || '') + '"',
        lead.created_at || '',
        lead.time_to_conversion || '',
        lead.verified_at || '',
        '"' + (lead.transaction_type || '') + '"'
      ];
      csvRows.push(row.join(','));
    }
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    
    // Add UTF-8 BOM (\uFEFF) to fix Chinese characters
    const csvContent = '\uFEFF' + csvRows.join('\n');
    
    return new Response(csvContent, { 
      status: 200, 
      headers: { 
        'Content-Type': 'text/csv; charset=utf-8', 
        'Content-Disposition': 'attachment; filename="leads_export_' + timestamp + '.csv"' 
      } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

// ============================================
// Reinstatement Section
// ============================================
async function getGoogleAdsAccessToken(env) {
  const clientId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_SECRET");
  const refreshToken = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_REFRESH_TOKEN");
  
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google Ads credentials in KV");
  }
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${data.error}`);
  }
  return data.access_token;
}

async function createSingleConversionAdjustment(accessToken, customerId, conversionActionId, clientId, newValue, conversionDateTime, developerToken, loginCustomerId) {
  let formattedDateTime = conversionDateTime;
  if (formattedDateTime && !formattedDateTime.includes('+')) {
    const date = new Date(formattedDateTime);
    formattedDateTime = date.toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
  }
  
  const requestBody = {
    conversion_adjustments: [{
      conversion_action: `customers/${customerId}/conversionActions/${conversionActionId}`,
      adjustment_type: "RESTATEMENT",
      order_id: clientId,
      conversion_date_time: formattedDateTime,
      restatement_value: {
        adjusted_value: newValue
      }
    }],
    partial_failure: true
  };
  
  const response = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/conversionAdjustments:upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': developerToken,
      'login-customer-id': loginCustomerId
    },
    body: JSON.stringify(requestBody)
  });
  
  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error?.message || "API请求失败");
  }
  
  return result;
}

async function handleGetReinstatementLeads(request, env) {
  try {
    const url = new URL(request.url);
    const qualifiedOnly = url.searchParams.get("qualified_only") === "true";
    
    let sql = `
      WITH RankedLeads AS (
          SELECT 
              client_id,
              gclid,
              click_type,
              created_at,
              value,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY created_at ASC) as rn_asc,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY value DESC) as rn_val
          FROM leads
          WHERE gclid IS NOT NULL 
            AND gclid <> ''
            AND client_id IS NOT NULL 
            AND client_id <> 'unknown' 
            AND value IS NOT NULL
            AND (reinstatement_submitted_at IS NULL OR datetime(reinstatement_submitted_at) < datetime('now', '-90 days'))
            AND datetime(created_at) BETWEEN datetime('now', '-90 days') AND datetime('now', '-1 days')
      )
      SELECT 
          L.client_id,
          MAX(CASE WHEN L.rn_asc = 1 THEN L.click_type END) as click_type,
          MAX(CASE WHEN L.rn_asc = 1 THEN L.created_at END) as latest_created_at,
          CAST(julianday('now') - julianday(MAX(CASE WHEN L.rn_asc = 1 THEN L.created_at END)) AS INTEGER) as days_since_creation,
          MAX(CASE WHEN L.rn_val = 1 THEN L.value END) as ConvValue
      FROM RankedLeads L
      GROUP BY L.client_id;
    `;
    
    const stmt = await env.lead_db.prepare(sql);
    const result = await stmt.all();
    
    const leads = [];
    
    for (const lead of result.results) {
      let daysSinceCreation = lead.days_since_creation || 0;
      
      leads.push({
        id: lead.client_id,
        client_id: lead.client_id,
        value: lead.ConvValue,
        verified_at: lead.latest_verified_at,
        created_at: lead.latest_created_at,
        click_type: lead.click_type || 'unknown',
        days_since_creation: daysSinceCreation,
        is_qualified: true,
        reinstatement_submitted: 0
      });
    }
    
    const stats = {
      total: leads.length,
      qualified: leads.length,
      pending_2days: 0,
      already_submitted: 0,
      sibling_submitted: 0
    };
    
    return new Response(JSON.stringify({
      success: true,
      leads: leads,
      stats: stats
    }), {
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Get reinstatement leads error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleConversionTrend(env, request) {
  try {
    const url = new URL(request.url);
    let dateFrom = url.searchParams.get('date_from') || ''; // Expects 'YYYY-MM-DD'
    let dateTo = url.searchParams.get('date_to') || '';     // Expects 'YYYY-MM-DD'
    const groupBy = url.searchParams.get('group_by') || 'day';
    
    let dateCondition = '';
    let params = [];
    
    // Pass raw 'YYYY-MM-DD' to SQL. SQLite will handle the local +8 hours conversion safely.
    if (dateFrom && dateTo) {
      dateCondition = "WHERE hk_created_at >= ? AND hk_created_at <= ? * 1 || ' 23:59:59'"; 
      // A cleaner SQLite approach is matching string boundaries:
      dateCondition = "WHERE date(hk_created_at) >= ? AND date(hk_created_at) <= ?";
      params.push(dateFrom, dateTo);
    } else if (dateFrom) {
      dateCondition = "WHERE date(hk_created_at) >= ?";
      params.push(dateFrom);
    } else if (dateTo) {
      dateCondition = "WHERE date(hk_created_at) <= ?";
      params.push(dateTo);
    }
    
    let dateFormat;
    switch (groupBy) {
      case 'week':
        dateFormat = `strftime('%Y-W%W', hk_created_at)`;
        break;
      case 'month':
        dateFormat = `strftime('%Y-%m', hk_created_at)`;
        break;
      default: // day
        dateFormat = `date(hk_created_at)`;
    }
    
    // 1. Convert UTC to HK time zone first for uniform evaluation
    // 2. Perform deduplication via ROW_NUMBER
    // 3. Filter by date and group by period smoothly
    const sql = `
      WITH converted_leads AS (
        SELECT 
          *,
          datetime(created_at, '+8 hours') as hk_created_at,
          ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY verified_at DESC) as rn
        FROM leads
        WHERE value > 0
      ),
      filtered_conversions AS (
        SELECT * 
        FROM converted_leads
        ${dateCondition}
      )
      SELECT 
        ${dateFormat} as period,
        SUM(CASE WHEN (gclid IS NOT NULL AND gclid != '') THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN (gclid IS NULL OR gclid = '') THEN 1 ELSE 0 END) as organic_count
      FROM filtered_conversions
      WHERE rn = 1
      GROUP BY period
      ORDER BY period ASC
    `;
    
    const stmt = await env.lead_db.prepare(sql);
    const result = await stmt.bind(...params).all();
    
    const periods = [];
    const paidCounts = [];
    const organicCounts = [];
    
    for (const row of result.results) {
      let displayPeriod = row.period;
      
      if (groupBy === 'week') {
        const match = row.period.match(/(\d{4})-W(\d+)/);
        if (match) {
          displayPeriod = `${match[1]} Week ${match[2]}`;
        }
      }
      
      periods.push(displayPeriod);
      paidCounts.push(row.paid_count || 0);
      organicCounts.push(row.organic_count || 0);
    }
    
    return new Response(JSON.stringify({
      success: true,
      periods: periods,
      paid: paidCounts,
      organic: organicCounts,
      groupBy: groupBy
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Conversion trend error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleConversionTrend_old(env, request) {
  try {
    const url = new URL(request.url);
    let dateFrom = url.searchParams.get('date_from') || '';
    let dateTo = url.searchParams.get('date_to') || '';
    const groupBy = url.searchParams.get('group_by') || 'day';
    
    // Convert HK date range to UTC for filtering (subtract 8 hours)
    function hkDateToUTC(dateStr, isEndOfDay = false) {
      if (!dateStr) return null;
      const [year, month, day] = dateStr.split('-').map(Number);
      
      let utcDate;
      if (isEndOfDay) {
        // HK 23:59:59 -> UTC 15:59:59
        utcDate = new Date(Date.UTC(year, month-1, day, 15, 59, 59));
      } else {
        // HK 00:00:00 -> UTC 16:00:00 (previous day)
        utcDate = new Date(Date.UTC(year, month-1, day - 1, 16, 0, 0));
      }
      
      return utcDate.toISOString().slice(0, 19).replace('T', ' ');
    }
    
    let dateCondition = '';
    let params = [];
    
    if (dateFrom && dateTo) {
      dateCondition = ' AND created_at >= ? AND created_at <= ?';
      params.push(
        hkDateToUTC(dateFrom, false),
        hkDateToUTC(dateTo, true)
      );
    } else if (dateFrom) {
      dateCondition = ' AND created_at >= ?';
      params.push(hkDateToUTC(dateFrom, false));
    } else if (dateTo) {
      dateCondition = ' AND created_at <= ?';
      params.push(hkDateToUTC(dateTo, true));
    }
    
    // Group by HK time - ADD 8 HOURS to convert UTC to HK time
    let dateFormat, orderBy;
    switch (groupBy) {
      case 'week':
        dateFormat = `strftime('%Y', datetime(created_at, '+8 hours')) || '-W' || strftime('%W', datetime(created_at, '+8 hours'))`;
        orderBy = `min(datetime(created_at, '+8 hours'))`;
        break;
      case 'month':
        dateFormat = `strftime('%Y-%m', datetime(created_at, '+8 hours'))`;
        orderBy = `min(datetime(created_at, '+8 hours'))`;
        break;
      default: // day
        dateFormat = `date(datetime(created_at, '+8 hours'))`;
        orderBy = `date(datetime(created_at, '+8 hours'))`;
    }
    
    const sql = `
      WITH valid_conversions AS (
        SELECT 
          created_at,
          gclid,
          client_id,
          verified_at,
          ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY verified_at DESC) as rn
        FROM leads
        WHERE value > 0
          ${dateCondition}
      )
      SELECT 
        ${dateFormat} as period,
        SUM(CASE WHEN (gclid IS NOT NULL AND gclid != '') THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN (gclid IS NULL OR gclid = '') THEN 1 ELSE 0 END) as organic_count
      FROM valid_conversions
      WHERE rn = 1
      GROUP BY period
      ORDER BY ${orderBy} ASC
    `;
    
    const stmt = await env.lead_db.prepare(sql);
    const result = await stmt.bind(...params).all();
    
    const periods = [];
    const paidCounts = [];
    const organicCounts = [];
    
    for (const row of result.results) {
      let displayPeriod = row.period;
      
      if (groupBy === 'week') {
        const match = row.period.match(/(\d{4})-W(\d+)/);
        if (match) {
          displayPeriod = `${match[1]} Week ${match[2]}`;
        }
      } else if (groupBy === 'month') {
        const match = row.period.match(/(\d{4})-(\d{2})/);
        if (match) {
          displayPeriod = `${match[1]}-${match[2]}`;
        }
      }
      
      periods.push(displayPeriod);
      paidCounts.push(row.paid_count);
      organicCounts.push(row.organic_count);
    }
    
    return new Response(JSON.stringify({
      success: true,
      periods: periods,
      paid: paidCounts,
      organic: organicCounts,
      groupBy: groupBy
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Conversion trend error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// HTML Page
// ============================================

async function handleAdminPage(env) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LeasingHub 管理后台</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
    .login-box { max-width: 400px; margin: 100px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .login-box input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
    .login-box button { width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .error { color: red; margin-top: 10px; display: none; }
    .admin-box { padding: 20px; }
    
    /* Stats Grid */
    .stats-grid { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { background: white; padding: 20px; border-radius: 12px; min-width: 150px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .stat-card .number { font-size: 32px; font-weight: bold; }
    
    /* Table */
    .table-wrapper { overflow-x: auto; }
    .wrap-text { word-wrap: break-word; white-space: normal; word-break: break-word; max-width: 250px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; min-width: 1300px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; white-space: nowrap; }
    th { background: #f8f9fa; position: sticky; top: 0; }
    
    /* Buttons */
    .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; margin-right: 10px; }
    .btn-primary { background: #667eea; color: white; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-success { background: #28a745; color: white; }
    .btn-warning { background: #ffc107; color: #333; }
    .btn-small { padding: 6px 12px; font-size: 12px; }
    
    /* Filters */
    .filters { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; background: white; padding: 15px; border-radius: 8px; }
    .filter-group { display: flex; flex-direction: column; }
    .filter-group label { font-size: 12px; margin-bottom: 4px; }
    .filter-group select, .filter-group input { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    
    /* Form Elements */
    .status-input { padding: 6px 12px; border-radius: 20px; border: none; font-size: 12px; font-weight: bold; text-align: center; width: 80px; cursor: default; background-color: #e9ecef; }
    .budget-select { padding: 6px; border-radius: 4px; border: 1px solid #ddd; min-width: 120px; }
    .tx-type-select { padding: 6px; border-radius: 4px; border: 1px solid #ddd; width: 70px; min-width: 70px; }
    .value-display { background: #e9ecef; text-align: center; width: 100px; padding: 6px; border-radius: 4px; border: 1px solid #ddd; }
    .pending-change { background: #fff3cd !important; }
    .budget-zero-option { color: #dc3545; font-weight: bold; }
    .client-link { color: #667eea; text-decoration: underline; cursor: pointer; }
    .client-link:hover { color: #5a67d8; }
    .frozen-row { background-color: #d3d3d3; opacity: 0.9; }
    .frozen-row td { background-color: #d3d3d3; }
    select:disabled, input:disabled, button:disabled { cursor: not-allowed; opacity: 0.6; }
    
    /* Modal */
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal-content { position: relative; background: white; margin: 50px auto; padding: 20px; width: 80%; max-width: 900px; border-radius: 12px; max-height: 80%; overflow: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #eee; }
    .modal-close { font-size: 28px; cursor: pointer; color: #999; line-height: 1; }
    .modal-close:hover { color: #333; }
    .client-leads-table { width: 100%; border-collapse: collapse; }
    .client-leads-table th, .client-leads-table td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    .client-leads-table th { background: #f8f9fa; }
    .status-badge-small { padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: bold; display: inline-block; }
    .status-pending-small { background: #ffc107; color: #856404; }
    .status-verified-small { background: #28a745; color: white; }
    .status-rejected-small { background: #dc3545; color: white; }
    
    /* Layout */
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
    .button-bar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #e0e0e0; }
   .stats-and-hotline-row {
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.stats-grid {
    flex: 1;
    min-width: 300px;
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
}

.hotline-card {
    background: white;
    padding: 15px 20px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    width: 400px;
    flex-shrink: 0;
}    .hotline-select { padding: 6px; border: 1px solid #ddd; border-radius: 4px; width: 220px; }
    .hotline-item { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .hotline-item label { font-size: 13px; font-weight: 500; width: 80px; }
    .hotline-item button { margin-left: 10px; white-space: nowrap; }
    .hotline-msg { font-size: 12px; margin-left: 10px; }
    
    /* Verified By Select */
    .verified-by-select { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; min-width: 100px; font-size: 12px; }
    
.combined-stats-container {
    width: 320px;
    flex-shrink: 0;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    overflow: hidden;
}

.combined-stats-card {
    padding: 12px;
}

.combined-stats-header-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 2px solid #e0e0e0;
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
}

.combined-stats-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;
    font-size: 12px;
}

.combined-stats-header-label,
.combined-stats-row-label {
    width: 70px;
    flex-shrink: 0;
}

.combined-stats-header-paid,
.combined-stats-row-paid {
    width: 110px;
    text-align: center;
    flex-shrink: 0;
}

.combined-stats-header-nonpaid,
.combined-stats-row-nonpaid {
    width: 110px;
    text-align: center;
    flex-shrink: 0;
}

.combined-stats-header-paid {
    color: #1976d2;
}

.combined-stats-header-nonpaid {
    color: #2e7d32;
}

.combined-stats-row-paid {
    color: #1976d2;
    font-weight: 600;
}

.combined-stats-row-nonpaid {
    color: #2e7d32;
    font-weight: 600;
}

.combined-stats-total {
    margin-top: 12px;
    padding: 8px 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
}
    /* Chart Container */
.chart-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  flex-wrap: wrap;
  gap: 10px;
}
.chart-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}
.chart-group-selector {
  display: flex;
  gap: 8px;
}
.btn-group-btn {
  padding: 6px 14px;
  border: 1px solid #ddd;
  background: #f8f9fa;
  border-radius: 20px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.btn-group-btn.active {
  background: #667eea;
  color: white;
  border-color: #667eea;
}
.btn-group-btn:hover {
  background: #e9ecef;
}
.no-data-msg {
  text-align: center;
  padding: 60px;
  color: #999;
}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>
<div id="app"></div>
<script>
var token = localStorage.getItem('admin_token');
var currentPage = 1;
var currentFilters = { status: '', agent: '', traffic_type: '', date_from: '', date_to: '', search: '' };
var selectedLeads = new Set();
var clientCounts = {};
var verifiedClientIds = [];
var reinstatementLeads = [];
var reinstatementStats = {};
var selectedReinIds = new Set();
var agentsList = [];
var conversionChart = null;
var currentGroupBy = 'day';

var rentBudgetOptions = [
  { value: '0', label: '0 (拒绝/垃圾)', isZero: true },
  { value: 'below_20k', label: 'Below 2萬', isZero: false },
  { value: '20k_50k', label: '2萬 - 5萬', isZero: false },
  { value: '50k_80k', label: '5萬 - 8萬', isZero: false },
  { value: '80k_120k', label: '8萬 - 12萬', isZero: false },
  { value: '120k_160k', label: '12萬 - 16萬', isZero: false },
  { value: 'above_160k', label: 'Above 16萬', isZero: false }
];

var buyBudgetOptions = [
  { value: '0', label: '0 (拒绝/垃圾)', isZero: true },
  { value: 'below_8m', label: 'Below 800萬', isZero: false },
  { value: '8m_15m', label: '800萬 - 1500萬', isZero: false },
  { value: '15m_20m', label: '1500萬 - 2000萬', isZero: false },
  { value: '20m_50m', label: '2000萬 - 5000萬', isZero: false },
  { value: 'above_50m', label: 'Above 5000萬', isZero: false }
];

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function loadConversionTrend() {
  var dateFrom = document.getElementById('filterDateFrom') ? document.getElementById('filterDateFrom').value : '';
  var dateTo = document.getElementById('filterDateTo') ? document.getElementById('filterDateTo').value : '';
  
  var url = '/api/conversion-trend?group_by=' + currentGroupBy;
  if (dateFrom) url += '&date_from=' + dateFrom;
  if (dateTo) url += '&date_to=' + dateTo;
  
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var canvas = document.getElementById('conversionChart');
      if (!canvas) return;
      
      var parent = canvas.parentElement;
      var existingMsg = parent.querySelector('.no-data-msg');
      if (existingMsg) existingMsg.remove();
      canvas.style.display = 'block';
      
      if (data.success && data.periods.length > 0) {
        var ctx = canvas.getContext('2d');
        
        if (conversionChart) {
          conversionChart.destroy();
        }
        
        conversionChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.periods,
            datasets: [
              {
                label: '付费转化',
                data: data.paid,
                borderColor: '#1976d2',
                backgroundColor: 'rgba(25, 118, 210, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
              },
              {
                label: '自然转化',
                data: data.organic,
                borderColor: '#2e7d32',
                backgroundColor: 'rgba(46, 125, 50, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                position: 'top',
              },
              tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                  label: function(context) {
                    return context.dataset.label + ': ' + context.parsed.y + ' 个';
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: '转化数量'
                },
                ticks: {
                  stepSize: 1
                }
              },
              x: {
                title: {
                  display: true,
                  text: data.groupBy === 'day' ? '日期' : (data.groupBy === 'week' ? '周次' : '月份')
                }
              }
            }
          }
        });
      } else {
        canvas.style.display = 'none';
        var msg = document.createElement('div');
        msg.className = 'no-data-msg';
        msg.innerHTML = '📊 暂无有效转化数据<br><span style="font-size:12px;">请尝试其他日期范围</span>';
        parent.appendChild(msg);
      }
    })
    .catch(function(err) {
      console.error('Load conversion trend error:', err);
    });
}

function setChartGroup(group) {
  currentGroupBy = group;
  var buttons = document.querySelectorAll('.btn-group-btn');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].getAttribute('data-group') === group) {
      buttons[i].classList.add('active');
    } else {
      buttons[i].classList.remove('active');
    }
  }
  loadConversionTrend();
}

function loadAgents() {
  return fetch("/api/get-agents")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.agents) {
        agentsList = data.agents;
      }
      return agentsList;
    })
    .catch(function(err) {
      console.error("Load agents error:", err);
      return [];
    });
}

function exportAllLeads() {
  // Show loading indicator
  var originalText = event.target.innerText;
  event.target.innerText = '导出中...';
  event.target.disabled = true;
  
  // Fetch all leads without any filters
  fetch('/api/export?all=true')
    .then(function(response) {
      if (!response.ok) throw new Error('导出失败');
      return response.blob();
    })
    .then(function(blob) {
      // Create download link
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'leads_export_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      // Reset button
      event.target.innerText = originalText;
      event.target.disabled = false;
    })
    .catch(function(err) {
      alert('导出失败: ' + err.message);
      event.target.innerText = originalText;
      event.target.disabled = false;
    });
}

function loadFilters() {
  fetch('/api/leads?limit=1')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.filters) {
        var html = '<div class="filters">';
        html += '<div class="filter-group"><label>状态</label><select id="filterStatus"><option value="">全部</option><option value="pending">待处理</option><option value="verified">已验证</option><option value="rejected">已拒绝</option></select></div>';
        html += '<div class="filter-group"><label>代理</label><select id="filterAgent"><option value="">全部</option>';
        for (var i = 0; i < data.filters.agents.length; i++) {
          html += '<option value="' + data.filters.agents[i] + '">' + data.filters.agents[i] + '</option>';
        }
        html += '</select></div>';
        html += '<div class="filter-group"><label>流量类型</label><select id="filterTraffic"><option value="">全部</option>';
        for (var j = 0; j < data.filters.trafficTypes.length; j++) {
          html += '<option value="' + data.filters.trafficTypes[j] + '">' + data.filters.trafficTypes[j] + '</option>';
        }
        html += '</select></div>';
        html += '<div class="filter-group"><label>开始日期</label><input type="date" id="filterDateFrom"></div>';
        html += '<div class="filter-group"><label>结束日期</label><input type="date" id="filterDateTo"></div>';
        html += '<div class="filter-group"><label>搜索</label><input type="text" id="filterSearch" placeholder="客户号/代理/区域"></div>';
        html += '<button class="btn btn-primary" onclick="applyFilters()">搜索</button>';
        html += '<button onclick="resetFilters()">重置</button>';
        html += '</div>';
        document.getElementById('filtersPanel').innerHTML = html;
      }
    });
}

function applyFilters() {
  currentFilters = {
    status: document.getElementById('filterStatus').value,
    agent: document.getElementById('filterAgent').value,
    traffic_type: document.getElementById('filterTraffic').value,
    date_from: document.getElementById('filterDateFrom').value,
    date_to: document.getElementById('filterDateTo').value,
    search: document.getElementById('filterSearch').value
  };
  currentPage = 1;
  selectedLeads.clear();
  loadLeads();
  loadCombinedConversionStats();
loadConversionTrend();
}

function resetFilters() {
  var fs = document.getElementById('filterStatus');
  var fa = document.getElementById('filterAgent');
  var ft = document.getElementById('filterTraffic');
  var fd1 = document.getElementById('filterDateFrom');
  var fd2 = document.getElementById('filterDateTo');
  var fsearch = document.getElementById('filterSearch');
  if (fs) fs.value = '';
  if (fa) fa.value = '';
  if (ft) ft.value = '';
  if (fd1) fd1.value = '';
  if (fd2) fd2.value = '';
  if (fsearch) fsearch.value = '';
  applyFilters();
}

function loadLeads() {
  var url = '/api/leads?page=' + currentPage + '&limit=20';
  if (currentFilters.status) url += '&status=' + currentFilters.status;
  if (currentFilters.agent) url += '&agent=' + currentFilters.agent;
  if (currentFilters.traffic_type) url += '&traffic_type=' + currentFilters.traffic_type;
  if (currentFilters.date_from) url += '&date_from=' + currentFilters.date_from;
  if (currentFilters.date_to) url += '&date_to=' + currentFilters.date_to;
  if (currentFilters.search) url += '&search=' + encodeURIComponent(currentFilters.search);
  
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        clientCounts = data.clientCounts || {};
        verifiedClientIds = data.verifiedClientIds || [];
        renderTable(data.data);
        if (data.pagination) {
          renderPagination(data.pagination);
        }
      }
    })
    .catch(function(err) {
      console.error("Load leads error:", err);
    });
}

function renderTable(leads) {
  var container = document.getElementById('tablePanel');
  if (!leads || leads.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px">暂无数据</div>';
    return;
  }
  
  var html = '<div class="table-wrapper"><table><thead><tr>';
  html += '<th>ID</th><th>客户号</th><th>询问途径</th><th>代理</th><th>区域</th><th>租金</th><th>售价</th>';
  html += '<th>交易类型</th><th>来源</th><th>Campaign</th><th>状态</th><th>预算</th><th>转化价值</th>';
  html += '<th>询问时间</br>(转化时间)</th><th>验证人/跟进人</th><th>验证时间</th><th>操作</th>';
  html += '</thead><tbody>';
  
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    var frozen = isFrozen(lead.client_id, lead.status, verifiedClientIds);
    
    var verifiedBy = lead.verified_by || '-';
    if (verifiedBy === 'admin_batch') verifiedBy = '管理员批量';
    var verifiedAt = lead.verified_at ? new Date(lead.verified_at).toLocaleString() : '-';

    var isRent = true;
    if (lead.budget_range && lead.budget_range !== '' && lead.budget_range !== null) {
      isRent = !lead.budget_range.includes('m') && lead.budget_range !== '0';
    }
    var transactionTypeDisplay = isRent ? '租用' : '购买';
    var budgetOptions = isRent ? rentBudgetOptions : buyBudgetOptions;
    var currentBudget = lead.budget_range || '';
    
    var currentValue = (lead.value !== null && lead.value !== undefined) ? lead.value : null;
    var displayValue = '';
    var displayPlaceholder = '';

    if (currentValue === null) {
      displayValue = '';
      displayPlaceholder = '-';
    } else if (currentValue === 0) {
      displayValue = '0';
      displayPlaceholder = '';
    } else {
      displayValue = currentValue;
      displayPlaceholder = '';
    }
    
    var statusText = '';
    var statusBg = '';
    var statusColor = '';
    if (currentValue === null) {
      statusText = '待处理';
      statusBg = '#ffc107';
      statusColor = '#856404';
    } else if (currentValue === 0) {
      statusText = '已拒绝';
      statusBg = '#dc3545';
      statusColor = 'white';
    } else {
      statusText = '已验证';
      statusBg = '#28a745';
      statusColor = 'white';
    }
    
    var leadCount = clientCounts[lead.client_id] || 0;
    var hasMultipleLeads = leadCount > 1;
    var clientDisplay = (hasMultipleLeads && lead.client_id && lead.client_id !== '-') 
      ? '<span class="client-link" onclick="showClientLeads(\\'' + (lead.client_id || '') + '\\')">' + (lead.client_id || '-') + ' (' + leadCount + ')</span>'
      : (lead.client_id || '-');
    
    var rowClass = frozen ? 'frozen-row' : '';
    html += '<tr class="' + rowClass + '">';
    html += '<td>' + lead.id + '</td>';
    html += '<td class="wrap-text">' + clientDisplay + '</br>(' + lead.user_ip + ')</td>';  
    html += '<td>' + lead.click_type + '</td>';    
    html += '<td>' + (lead.agent_name || '-') + '</td>';
    html += '<td>' + (lead.district || '-') + '</td>';
    html += '<td>' + (lead.rent || '-') + '</td>';
    html += '<td>' + (lead.property_price || '-') + '</td>'; 
    html += '<td><select id="tx_type_' + lead.id + '" class="tx-type-select" onchange="onTransactionTypeChange(' + lead.id + ')" ' + (frozen ? 'disabled' : '') + '>';
    html += '<option value="rent" ' + (lead.transaction_type === 'rent' ? 'selected' : '') + '>租用</option>';
    html += '<option value="buy" ' + (lead.transaction_type === 'buy' ? 'selected' : '') + '>购买</option>';
    html += '</select></td>';
    html += '<td><span>' + (lead.traffic_type || 'direct') + '</span></td>';
    html += '<td>' + (lead.campaign_name || '-') + '</td>'; 
    html += '<td><input type="text" id="status_' + lead.id + '" value="' + statusText + '" disabled class="status-input" style="background-color:' + statusBg + ';color:' + statusColor + ';"></td>';

    // Budget dropdown
    html += '<td><select id="budget_' + lead.id + '" class="budget-select" data-original-budget="' + (currentBudget && currentBudget !== '' ? escapeHtml(currentBudget) : '') + '" onchange="updateValueFromBudget(' + lead.id + ')" ' + (frozen ? 'disabled' : '') + '>';
    html += '<option value="">请选择</option>';
    for (var j = 0; j < budgetOptions.length; j++) {
      var opt = budgetOptions[j];
      var selected = (currentBudget === opt.value) ? 'selected' : '';
      html += '<option value="' + opt.value + '" ' + selected + '>' + opt.label + '</option>';
    }
    html += '</select></td>';



    html += '<td><input type="text" id="value_' + lead.id + '" value="' + displayValue + '" placeholder="' + displayPlaceholder + '" readonly class="value-display"></td>';
    html += '<td>' + new Date(lead.created_at).toLocaleString() + '</br>(' + lead.time_to_conversion + ')</td>';


// 验证人 dropdown
html += '<td><select id="verified_by_' + lead.id + '" class="verified-by-select" data-lead-id="' + lead.id + '" ' + (frozen ? 'disabled' : '') + '>';
html += '<option value="">-</option>';
for (var a = 0; a < agentsList.length; a++) {
  var agent = agentsList[a];
  var agentName = agent.agent_name;
  var selected = (verifiedBy === agentName || (lead.verified_by === agentName)) ? 'selected' : '';
  html += '<option value="' + escapeHtml(agentName) + '" ' + selected + '>' + escapeHtml(agentName) + '</option>';
}
html += '</select></td>';




    html += '<td>' + verifiedAt + '<td>';
    html += '<td><button class="btn btn-primary" onclick="updateLead(' + lead.id + ')" style="padding:4px 8px;font-size:12px" ' + (frozen ? 'disabled' : '') + '>保存</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function isFrozen(clientId, currentStatus, verifiedClientIdsList) {
  if (!clientId || clientId === '-') return false;
  if (currentStatus === 'verified') return false;
  return verifiedClientIdsList.indexOf(clientId) !== -1;
}

function showClientLeads(clientId) {
  if (!clientId || clientId === '-') return;
  
  var modal = document.getElementById('clientModal');
  if (!modal) {
    var modalHtml = '<div id="clientModal" class="modal"><div class="modal-content"><div class="modal-header"><h3>客户线索详情 - <span id="modalClientId"></span></h3><span class="modal-close" onclick="closeModal()">&times;</span></div><div id="modalBody"><div style="text-align:center;padding:40px">加载中...</div></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modal = document.getElementById('clientModal');
  }
  
  document.getElementById('modalClientId').innerText = clientId;
  modal.style.display = 'block';
  
  fetch('/api/client-leads?client_id=' + encodeURIComponent(clientId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        var html = '<table class="client-leads-table"><thead><tr>';
        html += '<th>ID</th>';
        html += '<th>状态</th>';
        html += '<th>验证人</th>';
        html += '<th>验证日期</th>';
        html += '<th>创建日期</th>';
        html += '<th>转化价值</th>';
        html += '</tr></thead><tbody>';
        
        for (var i = 0; i < data.leads.length; i++) {
          var lead = data.leads[i];
          var statusText = '';
          var statusClass = '';
          if (lead.status === 'pending') {
            statusText = '待处理';
            statusClass = 'status-pending-small';
          } else if (lead.status === 'verified') {
            statusText = '已验证';
            statusClass = 'status-verified-small';
          } else {
            statusText = '已拒绝';
            statusClass = 'status-rejected-small';
          }
          
          var verifiedBy = lead.verified_by || '-';
          if (verifiedBy === 'admin_batch') verifiedBy = '管理员批量';
          var verifiedAt = lead.verified_at ? new Date(lead.verified_at).toLocaleString() : '-';
          var createdAt = lead.created_at ? new Date(lead.created_at).toLocaleString() : '-';
          var valueDisplay = (lead.value === null || lead.value === undefined) ? '-' : lead.value;
          
          html += '<tr>';
          html += '<td>' + lead.id + '</td>';
          html += '<td><span class="' + statusClass + '">' + statusText + '</span></td>';
          html += '<td>' + verifiedBy + '</td>';
          html += '<td>' + verifiedAt + '</td>';
          html += '<td>' + createdAt + '</td>';
          html += '<td>' + valueDisplay + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table>';
        document.getElementById('modalBody').innerHTML = html;
      } else {
        document.getElementById('modalBody').innerHTML = '<div style="color:red">加载失败: ' + data.error + '</div>';
      }
    })
    .catch(function(err) {
      document.getElementById('modalBody').innerHTML = '<div style="color:red">网络错误</div>';
    });
}

function closeModal() {
  var modal = document.getElementById('clientModal');
  if (modal) modal.style.display = 'none';
}

window.onclick = function(event) {
  var modal = document.getElementById('clientModal');
  if (event.target === modal) closeModal();
};

function calculateValueFromBudget(budgetRange, isRent, rentValue, priceValue) {
  if (budgetRange === '0') return 0;
  
  function extractNumber(str) {
    if (!str || str === '-') return 0;
    var match = str.match(/(\\d+(?:,\\d+)?)/);
    if (!match) return 0;
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  var rentNum = extractNumber(rentValue);
  var priceNum = extractNumber(priceValue);
  
  if (isRent) {
    switch (budgetRange) {
      case 'below_20k': return 2000;
      case '20k_50k': return Math.round(35000 * 0.3);
      case '50k_80k': return Math.round(65000 * 0.3);
      case '80k_120k': return Math.round(100000 * 0.3);
      case '120k_160k': return Math.round(140000 * 0.3);
      case 'above_160k': return Math.round(200000 * 0.3);
      default: return rentNum > 0 ? Math.round(rentNum * 0.3) : 2000;
    }
  } else {
    switch (budgetRange) {
      case 'below_8m': return 2000;
      case '8m_15m': return Math.round(11500000 * 0.003);
      case '15m_20m': return Math.round(17500000 * 0.003);
      case '20m_50m': return Math.round(35000000 * 0.003);
      case 'above_50m': return Math.round(50000000 * 0.003);
      default: return priceNum > 0 ? Math.round(priceNum * 0.003) : 2000;
    }
  }
}

function updateStatusDisplay(statusInput, value) {
  if (value === null || value === undefined || value === '') {
    statusInput.value = '待处理';
    statusInput.style.backgroundColor = '#ffc107';
    statusInput.style.color = '#856404';
  } else if (value === 0) {
    statusInput.value = '已拒绝';
    statusInput.style.backgroundColor = '#dc3545';
    statusInput.style.color = 'white';
  } else {
    statusInput.value = '已验证';
    statusInput.style.backgroundColor = '#28a745';
    statusInput.style.color = 'white';
  }
}

function updateValueFromBudget(id) {
  var budgetSelect = document.getElementById('budget_' + id);
  var valueInput = document.getElementById('value_' + id);
  var statusInput = document.getElementById('status_' + id);
  var txTypeSelect = document.getElementById('tx_type_' + id);
  var verifiedBySelect = document.getElementById('verified_by_' + id);
  
  if (!budgetSelect || !valueInput) return;
  
  // Get previous value (stored in data attribute)
  var previousBudget = budgetSelect.getAttribute('data-original-budget') || '';
  var currentBudget = budgetSelect.value;
  
  var row = budgetSelect.closest('tr');
  if (!row) return;
  
  var cells = row.querySelectorAll('td');
  var rentValue = cells[5] ? cells[5].innerText : '';
  var priceValue = cells[6] ? cells[6].innerText : '';
  var isRent = (txTypeSelect && txTypeSelect.value === 'rent');
  
  // Check if this is a new selection (was empty, now has value)
  var wasEmpty = (previousBudget === '' || previousBudget === null);
  var isNowSelected = (currentBudget && currentBudget !== '');
  
  if (currentBudget && currentBudget !== '') {
    // Calculate and update value
    var newValue = calculateValueFromBudget(currentBudget, isRent, rentValue, priceValue);
    valueInput.value = newValue;
    valueInput.placeholder = '';
    valueInput.classList.add('pending-change');
    updateStatusDisplay(statusInput, newValue);
    
    // Auto-select verified_by ONLY when budget was previously empty and now selected
    if (wasEmpty && isNowSelected) {
      // Get agent name from the "代理" column (index 3)
      var agentName = cells[3] ? cells[3].innerText.trim() : '';
      
      if (verifiedBySelect && agentName && agentName !== '-' && agentName !== '') {
        // Find and select the matching agent in the dropdown
        var optionFound = false;
        for (var i = 0; i < verifiedBySelect.options.length; i++) {
          if (verifiedBySelect.options[i].value === agentName) {
            verifiedBySelect.selectedIndex = i;
            optionFound = true;
            break;
          }
        }
        // Optional: if agent not found in dropdown, you could add a temporary option
        if (!optionFound) {
          console.log('Agent "' + agentName + '" not found in verified_by dropdown options');
        }
      }
    }
  } else {
    // Budget was cleared
    valueInput.value = '';
    valueInput.placeholder = '-';
    valueInput.classList.remove('pending-change');
    updateStatusDisplay(statusInput, null);
    // Do NOT auto-clear verified_by when budget is cleared
  }
  
  // Store the current budget as the "original" for next time
  budgetSelect.setAttribute('data-original-budget', currentBudget);
}

function onTransactionTypeChange(id) {
  var txTypeSelect = document.getElementById('tx_type_' + id);
  var budgetSelect = document.getElementById('budget_' + id);
  var valueInput = document.getElementById('value_' + id);
  var statusInput = document.getElementById('status_' + id);
  
  if (!txTypeSelect || !budgetSelect) return;
  
  var isRent = (txTypeSelect.value === 'rent');
  var budgetOptions = isRent ? rentBudgetOptions : buyBudgetOptions;
  var currentBudget = budgetSelect.value;
  
  var newHtml = '<option value="">请选择</option>';
  for (var i = 0; i < budgetOptions.length; i++) {
    var opt = budgetOptions[i];
    var selected = (currentBudget === opt.value) ? 'selected' : '';
    newHtml += '<option value="' + opt.value + '" ' + selected + '>' + opt.label + '</option>';
  }
  budgetSelect.innerHTML = newHtml;
  
  if (currentBudget && currentBudget !== '') {
    var row = budgetSelect.closest('tr');
    if (row) {
      var cells = row.querySelectorAll('td');
      var rentValue = cells[5] ? cells[5].innerText : '';
      var priceValue = cells[6] ? cells[6].innerText : '';
      var newValue = calculateValueFromBudget(currentBudget, isRent, rentValue, priceValue);
      if (valueInput) {
        valueInput.value = newValue;
        valueInput.classList.add('pending-change');
        updateStatusDisplay(statusInput, newValue);
      }
    }
  } else {
    if (valueInput) {
      valueInput.value = '';
      valueInput.placeholder = '-';
      valueInput.classList.remove('pending-change');
      updateStatusDisplay(statusInput, null);
    }
  }
}

function updateLead(id) {
  var budgetSelect = document.getElementById('budget_' + id);
  var valueInput = document.getElementById('value_' + id);
  var txTypeSelect = document.getElementById('tx_type_' + id);
  var verifiedBySelect = document.getElementById('verified_by_' + id);
  
  // Debug: log what we're getting
  console.log('Updating lead:', id);
  console.log('Verified by select element:', verifiedBySelect);
  if (verifiedBySelect) {
    console.log('Selected verified_by value:', verifiedBySelect.value);
  }
  
  var budget = budgetSelect ? budgetSelect.value : '';
  var transactionType = txTypeSelect ? txTypeSelect.value : '';
  var verifiedBy = verifiedBySelect ? verifiedBySelect.value : '';
  var value = null;
  
  if (budget === '0') {
    value = 0;
  } else if (budget && budget !== '') {
    if (valueInput && valueInput.value !== '' && valueInput.placeholder !== '-') {
      value = parseInt(valueInput.value);
    } else {
      var row = budgetSelect.closest('tr');
      if (row) {
        var cells = row.querySelectorAll('td');
        var rentValue = cells[5] ? cells[5].innerText : '';
        var priceValue = cells[6] ? cells[6].innerText : '';
        var isRent = (transactionType === 'rent');
        value = calculateValueFromBudget(budget, isRent, rentValue, priceValue);
      } else {
        value = 2000;
      }
    }
  }
  
  var statusText = (value === null) ? '待处理' : ((value === 0) ? '已拒绝' : '已验证');
  var confirmMsg = '确定要将线索 #' + id + ' 标记为 ' + statusText + '吗？';
  if (value !== null && value > 0) confirmMsg += '\\n转化价值: ' + value;
  else if (value === 0) confirmMsg += '\\n此线索将被标记为垃圾/拒绝';
  if (verifiedBy) confirmMsg += '\\n验证人: ' + verifiedBy;
  
  if (!confirm(confirmMsg)) return;
  
  fetch('/api/leads/batch-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      leads: [{ id: id }], 
      budgets: [budget],
      values: [value],
      transactionTypes: [transactionType],
      verifiedBy: [verifiedBy]  // Make sure this is included
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      loadLeads();
    } else {
      alert('操作失败: ' + data.error);
    }
  })
  .catch(function(err) {
    alert('网络错误: ' + err.message);
  });
}


function renderPagination(pagination) {
  var container = document.getElementById('paginationPanel');
  if (!container) return;
  
  if (!pagination || pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  var html = '';
  html += '<button onclick="goToPage(1)" ' + (currentPage === 1 ? 'disabled' : '') + '>首页</button>';
  html += '<button onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>上一页</button>';
  
  var startPage = Math.max(1, currentPage - 2);
  var endPage = Math.min(pagination.totalPages, currentPage + 2);
  
  for (var i = startPage; i <= endPage; i++) {
    var activeStyle = (i === currentPage) ? 'style="background:#667eea;color:white"' : '';
    html += '<button onclick="goToPage(' + i + ')" ' + activeStyle + '>' + i + '</button>';
  }
  
  html += '<button onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === pagination.totalPages ? 'disabled' : '') + '>下一页</button>';
  html += '<button onclick="goToPage(' + pagination.totalPages + ')" ' + (currentPage === pagination.totalPages ? 'disabled' : '') + '>末页</button>';
  
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadLeads();
}

// ============================================
// Hotline Handlers Functions
// ============================================

function loadAllHotlineSelections() {
  fetch("/api/get-agents")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.agents && data.agents.length > 0) {
        var telSelect = document.getElementById("hotlineTel");
        var formSelect = document.getElementById("hotlineForm");
        var msgSelect = document.getElementById("hotlineMsg");
        
        if (!telSelect || !formSelect || !msgSelect) return;
        
        var html = '';
        for (var i = 0; i < data.agents.length; i++) {
          var agent = data.agents[i];
          // 新格式：存储 ["agent_name", "dingtalk_id"]
          var optionValue = JSON.stringify([agent.agent_name, agent.dingtalk_id]);
          var displayText = agent.agent_name + ' (' + agent.phone_number + ')';
          html += '<option value="' + optionValue.replace(/"/g, '&quot;') + '">' + escapeHtml(displayText) + '</option>';
        }
        
        telSelect.innerHTML = html;
        formSelect.innerHTML = html;
        msgSelect.innerHTML = html;
        
        loadHotlineTel();
        loadHotlineForm();
        loadHotlineMsg();
      }
    })
    .catch(function(err) {
      console.error("Load agents error:", err);
    });
}

function loadHotlineTel() {
  fetch("/api/get-hotline-tel")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.value) {
        var select = document.getElementById("hotlineTel");
        if (select) selectValueFromKV(select, data.value);
      }
    })
    .catch(function(err) {
      console.error("Load hotline tel error:", err);
    });
}

function loadHotlineForm() {
  fetch("/api/get-hotline-form")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.value) {
        var select = document.getElementById("hotlineForm");
        if (select) selectValueFromKV(select, data.value);
      }
    })
    .catch(function(err) {
      console.error("Load hotline form error:", err);
    });
}

function loadHotlineMsg() {
  fetch("/api/get-hotline-msg")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.value) {
        var select = document.getElementById("hotlineMsg");
        if (select) selectValueFromKV(select, data.value);
      }
    })
    .catch(function(err) {
      console.error("Load hotline msg error:", err);
    });
}

function selectValueFromKV(select, savedValue) {
  if (!select || !savedValue) return;
  
  for (var i = 0; i < select.options.length; i++) {
    var optionValue = select.options[i].value;
    
    try {
      var savedParsed = JSON.parse(savedValue);
      var optionParsed = JSON.parse(optionValue);
      
      // 比较 dingtalk_id（数组第二个元素）
      if (savedParsed[1] === optionParsed[1]) {
        select.selectedIndex = i;
        break;
      }
    } catch(e) {
      if (optionValue === savedValue) {
        select.selectedIndex = i;
        break;
      }
    }
  }
}

function updateAllHotlineSelections() {
  var telSelect = document.getElementById("hotlineTel");
  var formSelect = document.getElementById("hotlineForm");
  var msgSelect = document.getElementById("hotlineMsg");
  var msgSpan = document.getElementById("hotlineMsgSpan");
  
  var telValue = telSelect ? telSelect.value : "";
  var formValue = formSelect ? formSelect.value : "";
  var msgValue = msgSelect ? msgSelect.value : "";
  
  var promises = [];
  
  if (telValue) {
    promises.push(
      fetch("/api/update-hotline-tel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: telValue })
      })
    );
  }
  
  if (formValue) {
    promises.push(
      fetch("/api/update-hotline-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: formValue })
      })
    );
  }
  
  if (msgValue) {
    promises.push(
      fetch("/api/update-hotline-msg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: msgValue })
      })
    );
  }
  
  Promise.all(promises)
    .then(function(responses) {
      return Promise.all(responses.map(function(r) { return r.json(); }));
    })
    .then(function(results) {
      var allSuccess = results.every(function(r) { return r.success; });
      if (allSuccess && msgSpan) {
        msgSpan.style.color = "green";
        msgSpan.innerHTML = "✓ 已更新所有热线处理人";
        setTimeout(function() { if(msgSpan) msgSpan.innerHTML = ""; }, 3000);
      } else if (msgSpan) {
        msgSpan.style.color = "red";
        msgSpan.innerHTML = "更新失败";
      }
    })
    .catch(function(err) {
      if (msgSpan) {
        msgSpan.style.color = "red";
        msgSpan.innerHTML = "網絡錯誤";
      }
    });
}

// ============================================
// Reinstatement Functions
// ============================================

function showReinstatementPage() {
  var app = document.getElementById("app");
  app.innerHTML = "<div class='admin-box'><div style='display:flex;justify-content:space-between;margin-bottom:20px'><h2>Google Ads Reinstatement - 合格线索</h2><button class='btn btn-danger' onclick='hideReinstatementPage()'>返回主页面</button></div><div style='margin-bottom:20px'><button class='btn btn-primary' onclick='loadReinstatementLeads()'>刷新列表</button><button class='btn btn-success' onclick='exportToGoogleSheets()' style='background:#25D366;'>📤 导出选中到 Google Sheets</button> <span id='reinCountSpan' style='margin-left:20px'></span></div><div id='reinStatsPanel' style='margin-bottom:20px'></div><div id='reinTablePanel'>加载中...</div></div>";
  loadReinstatementLeads();
}

function hideReinstatementPage() {
  // Clear the reinstatement data
  selectedReinIds.clear();
  reinstatementLeads = [];
  
  // Call the main render function to show admin page
  render();
}
function loadReinstatementLeads() {
  selectedReinIds.clear();
  
  var url = "/api/reinstatement-leads?qualified_only=true";
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        reinstatementLeads = data.leads || [];
        reinstatementStats = data.stats || {};
        renderReinstatementStats();
        renderReinstatementTable();
      } else {
        document.getElementById("reinTablePanel").innerHTML = "<div style='color:red'>加载失败: " + (data.error || "未知错误") + "</div>";
      }
    })
    .catch(function(err) {
      console.error("Fetch error:", err);
      document.getElementById("reinTablePanel").innerHTML = "<div style='color:red'>网络错误: " + err.message + "</div>";
    });
}

function renderReinstatementStats() {
  var c = document.getElementById("reinStatsPanel");
  if (!c) return;
  
  var total = reinstatementStats.total || 0;
  var qualified = reinstatementStats.qualified || 0;
  var pending2days = reinstatementStats.pending_2days || 0;
  
  var h = "<div style='display:flex;gap:15px;margin-bottom:20px;flex-wrap:wrap'>";
  h += "<div style='background:#e8f5e9;padding:15px;border-radius:8px;min-width:120px;text-align:center'><div style='font-size:24px;font-weight:bold;color:#4caf50'>" + total + "</div><div style='font-size:12px;color:#666'>总线索</div></div>";
  h += "<div style='background:#fff3e0;padding:15px;border-radius:8px;min-width:120px;text-align:center'><div style='font-size:24px;font-weight:bold;color:#4caf50'>" + qualified + "</div><div style='font-size:12px;color:#666'>合格线索</div></div>";
  h += "<div style='background:#fff3e0;padding:15px;border-radius:8px;min-width:120px;text-align:center'><div style='font-size:24px;font-weight:bold;color:#ff9800'>" + pending2days + "</div><div style='font-size:12px;color:#666'>等待1天</div></div>";
  h += "</div>";
  c.innerHTML = h;
}

function renderReinstatementTable() {
  var c = document.getElementById("reinTablePanel");
  if (!c) return;
  
  if (!reinstatementLeads || reinstatementLeads.length === 0) {
    c.innerHTML = "<div style='text-align:center;padding:40px'>暂无合格线索</div>";
    return;
  }
  
  var h = "<div class='table-wrapper'><table style='width:100%;border-collapse:collapse;background:white'>";
  h += "<thead><tr style='background:#f8f9fa'>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'><input type='checkbox' id='selectAllRein' onchange='toggleSelectAllRein()'></th>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>客户号</th>"; 
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>转化价值</th>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>点击类型</th>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>创建日期</th>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>天数(创建)</th>";
  h += "<th style='padding:12px;text-align:left;border-bottom:1px solid #eee'>状态</th>";
  h += "</tr></thead><tbody>";
  
  for (var i = 0; i < reinstatementLeads.length; i++) {
    var ld = reinstatementLeads[i];
    var isQualified = true;
    var rowBg = "#e8f5e9";
    var isChecked = selectedReinIds.has(ld.id);
    
    var daysValue = ld.days_since_creation || 0;
    var createdDate = ld.created_at || ld.verified_at || "-";
    var valueNum = (ld.value && ld.value !== "null") ? ld.value : 0;
    var clickType = ld.click_type || "-";
    var statusText = "合格";
    
    var checkboxHtml = '<input type="checkbox" class="rein-cb" data-id="' + ld.id + '" ' + (isChecked ? "checked" : "") + ' onclick="handleCheckboxClick(this)">';
    h += "<tr style='background:" + rowBg + "'>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + checkboxHtml + "</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + (ld.client_id || "-") + "</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>$" + valueNum + "</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + clickType + "</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + (createdDate ? createdDate.substring(0,10) : "-") + "</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + daysValue + " 天</td>";
    h += "<td style='padding:12px;border-bottom:1px solid #eee'>" + statusText + "</td>";
    h += "</tr>";
  }
  h += "</tbody></table></div>";
  c.innerHTML = h;
  updateReinCount();
}

function handleCheckboxClick(checkbox) {
  var id = checkbox.getAttribute("data-id");
  if (checkbox.checked) {
    selectedReinIds.add(id);
  } else {
    selectedReinIds.delete(id);
  }
  updateReinCount();
}

function toggleSelectAllRein() {
  var sa = document.getElementById("selectAllRein");
  var cbs = document.querySelectorAll(".rein-cb:not([disabled])");
  for (var i = 0; i < cbs.length; i++) {
    cbs[i].checked = sa.checked;
    var id = cbs[i].getAttribute("data-id");
    if (sa.checked) {
      selectedReinIds.add(id);
    } else {
      selectedReinIds.delete(id);
    }
  }
  updateReinCount();
}

function updateReinCount() {
  var span = document.getElementById("reinCountSpan");
  if (span) span.innerHTML = "已选择 " + selectedReinIds.size + " 条";
}

function showSubmissionDetails(selectedLeadsData, callback) {
  var modal = document.createElement("div");
  modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center";
  
  var content = '<div style="background:white;border-radius:12px;width:550px;max-width:90%;max-height:80%;overflow:auto;padding:20px;font-family:-apple-system, BlinkMacSystemFont, sans-serif">';
  content += '<h3 style="margin-bottom:20px;color:#333;margin-top:0">📋 Google Ads 提交确认</h3>';
  content += '<div style="margin-bottom:20px;padding:10px;background:#f8f9fa;border-radius:8px">';
  content += '<strong>客户数量:</strong> ' + selectedLeadsData.length + '<br>';
  content += '<strong>提交时间:</strong> ' + new Date().toLocaleString() + '<br>';
  content += '</div>';
  
  // Table with inline styles that override global CSS
  content += '<div style="overflow-x:auto;max-height:350px;overflow-y:auto;margin-bottom:15px">';
  content += '<table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;min-width:0">';
content += '<thead>';
content += '<tr style="background:#0d1117;color:#8b949e">';  // Changed from white to light gray
content += '<th style="padding:8px;border:1px solid #333;text-align:left;width:40%">客户号</th>';
content += '<th style="padding:8px;border:1px solid #333;text-align:center;width:20%">价值</th>';
content += '<th style="padding:8px;border:1px solid #333;text-align:center;width:20%">类型</th>';
content += '<th style="padding:8px;border:1px solid #333;text-align:center;width:20%">转化操作</th>';
content += ' </tr>';
content += '</thead><tbody>';
  
  for (var i = 0; i < selectedLeadsData.length; i++) {
    var lead = selectedLeadsData[i];
    var bgColor = (i % 2 === 0) ? '#ffffff' : '#f5f5f5';
    content += '<tr style="background:' + bgColor + '">';
    content += '<td style="padding:6px;border:1px solid #ddd;font-family:monospace;font-size:11px;word-break:break-all;white-space:normal">' + lead.client_id + '</td>';
    content += '<td style="padding:6px;border:1px solid #ddd;text-align:center">$' + lead.value + '</td>';
    content += '<td style="padding:6px;border:1px solid #ddd;text-align:center">' + lead.click_type + '</td>';
    content += '<td style="padding:6px;border:1px solid #ddd;text-align:center">' + lead.conversion_action + '</td>';
    content += ' </tr>';
  }
  content += '</tbody></table></div>';
  
  content += '<div style="margin-top:15px;padding:10px;background:#fff3cd;border-radius:8px;font-size:12px">';
  content += '⚠️ 注意：提交后无法撤销，转化价值将被更新到 Google Ads';
  content += '</div>';
  content += '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">';
  content += '<button id="cancelSubmitBtn" style="padding:10px 20px;background:#6c757d;color:white;border:none;border-radius:6px;cursor:pointer">取消</button>';
  content += '<button id="confirmSubmitBtn" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:6px;cursor:pointer">确认提交</button>';
  content += '</div></div>';
  
  modal.innerHTML = content;
  document.body.appendChild(modal);
  
  document.getElementById("confirmSubmitBtn").onclick = function() {
    modal.remove();
    callback(true);
  };
  
  document.getElementById("cancelSubmitBtn").onclick = function() {
    modal.remove();
    callback(false);
  };
  
  modal.onclick = function(e) {
    if (e.target === modal) {
      modal.remove();
      callback(false);
    }
  };
}

// ============================================
// Login / Logout / Render
// ============================================

function login() {
  var phone = document.getElementById('phone').value;
  var password = document.getElementById('password').value;
  var errorDiv = document.getElementById('loginError');
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone, password: password })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      token = data.token;
      localStorage.setItem('admin_token', token);
      render();
    } else {
      errorDiv.textContent = data.error || '登录失败';
      errorDiv.style.display = 'block';
    }
  })
  .catch(function() {
    errorDiv.textContent = '网络错误';
    errorDiv.style.display = 'block';
  });
}

function logout() {
  localStorage.removeItem('admin_token');
  token = null;
  render();
}

function loadCombinedConversionStats() {
  // Read the existing date filter values from the admin page
  var dateFrom = document.getElementById('filterDateFrom') ? document.getElementById('filterDateFrom').value : '';
  var dateTo = document.getElementById('filterDateTo') ? document.getElementById('filterDateTo').value : '';
  
  var url = '/api/combined-conversion-stats';
  var params = [];
  
  if (dateFrom) params.push('date_from=' + dateFrom);
  if (dateTo) params.push('date_to=' + dateTo);
  
  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        var html = '<div class="combined-stats-card">';
        html += '<div class="combined-stats-header-row">';
        html += '<span class="combined-stats-header-label">真实转化率</span>';
        html += '<span class="combined-stats-header-paid">广告</span>';
        html += '<span class="combined-stats-header-nonpaid">自然</span>';
        html += '</div>';
        
        for (var i = 0; i < data.stats.length; i++) {
          var stat = data.stats[i];
          html += '<div class="combined-stats-row">';
          html += '<span class="combined-stats-row-label">' + stat.label + '</span>';
          html += '<span class="combined-stats-row-paid">' + stat.paid_count + ' (' + stat.paid_percent + ')</span>';
          html += '<span class="combined-stats-row-nonpaid">' + stat.nonpaid_count + ' (' + stat.nonpaid_percent + ')</span>';
          html += '</div>';
        }
        
        html += '<div class="combined-stats-total">💰 总查询点击: 广告 ' + data.paid_total + ' | 自然 ' + data.nonpaid_total + '</div>';
        html += '</div>';
        
        var combinedCard = document.getElementById('combinedStatsCard');
        if (combinedCard) {
          combinedCard.innerHTML = html;
        }
      }
    })
    .catch(function(err) {
      console.error('Load combined stats error:', err);
    });
}

function render() {
  var app = document.getElementById('app');
  if (token) {
    app.innerHTML = '<div class="admin-box">' +
'<div class="button-bar">' +
'<div style="display:flex; gap:10px; align-items:center;">' +
'<button class="btn btn-primary" onclick="showReinstatementPage()">Google Ads Reinstatement</button>' +
'<button class="btn btn-success" onclick="exportAllLeads()" style="background:#28a745; color:white;">📥 导出全部 CSV</button>' +
'<button class="btn btn-danger" onclick="logout()">退出登录</button>' +
'</div>' +
'</div>' +
'<div class="stats-and-hotline-row">' +
'<div class="chart-container">' +
'<div class="chart-header">' +
'<h4>📈 有效转化趋势 (付费 vs 自然)</h4>' +
'<div class="chart-group-selector">' +
'<button class="btn-group-btn active" data-group="day">按日</button>' +
'<button class="btn-group-btn" data-group="week">按周</button>' +
'<button class="btn-group-btn" data-group="month">按月</button>' +
'</div>' +
'</div>' +
'<canvas id="conversionChart" style="width:100%; height:180px;"></canvas>' +
'</div>' +
'<div id="combinedStatsCard" class="combined-stats-container"></div>' +
'<div class="hotline-card">' +
'<div class="hotline-row">' +
'<div class="hotline-item"><label>电话热线:</label><select id="hotlineTel" class="hotline-select"></select></div>' +
'<div class="hotline-item"><label>表单热线:</label><select id="hotlineForm" class="hotline-select"></select></div>' +
'<div class="hotline-item"><label>消息热线:</label><select id="hotlineMsg" class="hotline-select"></select></div>' +
'<div><button class="btn btn-primary btn-small" onclick="updateAllHotlineSelections()">保存</button><span id="hotlineMsgSpan" class="hotline-msg"></span></div>' +
'</div>' +
'</div>' +
'</div>' +
      '<div id="filtersPanel"></div>' +
      '<div id="tablePanel"><div style="text-align:center;padding:40px">加载中...</div></div>' +
      '<div id="paginationPanel" style="margin-top:20px;text-align:center"></div>' +
      '</div>';
// Chart group button event listeners
var groupBtns = document.querySelectorAll('.btn-group-btn');
for (var i = 0; i < groupBtns.length; i++) {
  groupBtns[i].addEventListener('click', function(e) {
    var group = this.getAttribute('data-group');
    setChartGroup(group);
  });
}   
loadCombinedConversionStats();  
loadConversionTrend();
loadFilters();
loadAgents().then(function() {
  loadLeads();
});
loadAllHotlineSelections();
  } else {
    app.innerHTML = '<div class="login-box"><h2>LeasingHub 管理后台</h2><input type="text" id="phone" placeholder="手机号"><input type="password" id="password" placeholder="密码"><button onclick="login()">登录</button><div id="loginError" class="error"></div></div>';
  }
}
// ============================================
// Google Sheet Reinstatement
// ============================================
function exportToGoogleSheets() {
  if (selectedReinIds.size === 0) {
    alert("请先选择要导出的客户");
    return;
  }
  
  var selectedLeadsData = [];
  for (var i = 0; i < reinstatementLeads.length; i++) {
    var lead = reinstatementLeads[i];
    if (selectedReinIds.has(lead.id)) {
      var conversionAction = "";
      if (lead.click_type === "tel") {
        conversionAction = "tel";
      } else if (lead.click_type === "form") {
        conversionAction = "form";
      } else {
        conversionAction = "msg";
      }
      
      selectedLeadsData.push({
        client_id: lead.client_id,
        value: lead.value,
        click_type: lead.click_type,
        conversion_action: conversionAction,
        verified_at: lead.verified_at,
        gclid: lead.gclid || ''
      });
    }
  }
  
  if (selectedLeadsData.length === 0) {
    alert("没有找到合格的线索数据");
    return;
  }
  
  if (!confirm("确定要将 " + selectedLeadsData.length + " 个客户的线索导出到 Google Sheets 吗？")) return;
  
  var btn = event.target;
  var originalText = btn.innerText;
  btn.innerText = '导出中...';
  btn.disabled = true;
  
  fetch("/api/export-reinstatement-to-sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leads: selectedLeadsData })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    btn.innerText = originalText;
    btn.disabled = false;
    
    if (data.success) {
      alert(data.message);
      
      // ✅ CLEAR SELECTIONS
      selectedReinIds.clear();
      
      // ✅ REFRESH THE PAGE (reload reinstatement list)
      loadReinstatementLeads();
      
      // ✅ UPDATE THE SELECTION COUNT DISPLAY
      updateReinCount();
    } else {
      alert("导出失败: " + data.error);
    }
  })
  .catch(function(err) {
    btn.innerText = originalText;
    btn.disabled = false;
    alert("网络错误: " + err.message);
  });
}
// ============================================

render();
</script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}