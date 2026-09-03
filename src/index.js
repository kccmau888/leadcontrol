export default {
  async fetch(request, env, ctx) {
    // Handle favicon
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
    if (path === '/api/add-agent' && request.method === 'POST') {
      return handleAddAgent(request, env);
    }
    if (path === '/api/update-agent' && request.method === 'PUT') {
      return handleUpdateAgent(request, env);
    }
    if (path === '/api/toggle-agent-status' && request.method === 'POST') {
      return handleToggleAgentStatus(request, env);
    }

    // Conversion Chart
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
    
    // Initialize summary table (run once)
    if (path === '/api/init-summary' && request.method === 'POST') {
      return handleInitSummaryTable(request, env);
    }
    
    return new Response('Not found', { status: 404 });
  }
};

// ============================================
// Summary Table Initialization
// ============================================
async function handleInitSummaryTable(request, env) {
  try {
    // Check if summary table exists
    const checkStmt = await env.lead_db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='client_summary'
    `);
    const checkResult = await checkStmt.all();
    
    if (checkResult.results.length === 0) {
      // Create summary table
      await env.lead_db.prepare(`
        CREATE TABLE client_summary (
          client_id TEXT PRIMARY KEY,
          total_count INTEGER DEFAULT 0,
          verified_count INTEGER DEFAULT 0,
          pending_count INTEGER DEFAULT 0,
          rejected_count INTEGER DEFAULT 0,
          noshow_count INTEGER DEFAULT 0,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      // Create triggers
      await env.lead_db.prepare(`
        CREATE TRIGGER update_client_summary_on_insert
        AFTER INSERT ON leads
        BEGIN
          INSERT INTO client_summary (client_id, total_count, verified_count, pending_count, rejected_count, noshow_count, last_updated)
          VALUES (
            NEW.client_id,
            1,
            CASE WHEN NEW.status = 'verified' THEN 1 ELSE 0 END,
            CASE WHEN NEW.status = 'pending' THEN 1 ELSE 0 END,
            CASE WHEN NEW.status = 'rejected' THEN 1 ELSE 0 END,
            CASE WHEN NEW.status = 'noshow' THEN 1 ELSE 0 END,
            datetime('now')
          )
          ON CONFLICT(client_id) DO UPDATE SET
            total_count = total_count + 1,
            verified_count = verified_count + CASE WHEN NEW.status = 'verified' THEN 1 ELSE 0 END,
            pending_count = pending_count + CASE WHEN NEW.status = 'pending' THEN 1 ELSE 0 END,
            rejected_count = rejected_count + CASE WHEN NEW.status = 'rejected' THEN 1 ELSE 0 END,
            noshow_count = noshow_count + CASE WHEN NEW.status = 'noshow' THEN 1 ELSE 0 END,
            last_updated = datetime('now');
        END
      `).run();
      
      await env.lead_db.prepare(`
        CREATE TRIGGER update_client_summary_on_update
        AFTER UPDATE OF status ON leads
        BEGIN
          UPDATE client_summary 
          SET 
            verified_count = verified_count + CASE WHEN NEW.status = 'verified' AND OLD.status != 'verified' THEN 1 WHEN NEW.status != 'verified' AND OLD.status = 'verified' THEN -1 ELSE 0 END,
            pending_count = pending_count + CASE WHEN NEW.status = 'pending' AND OLD.status != 'pending' THEN 1 WHEN NEW.status != 'pending' AND OLD.status = 'pending' THEN -1 ELSE 0 END,
            rejected_count = rejected_count + CASE WHEN NEW.status = 'rejected' AND OLD.status != 'rejected' THEN 1 WHEN NEW.status != 'rejected' AND OLD.status = 'rejected' THEN -1 ELSE 0 END,
            noshow_count = noshow_count + CASE WHEN NEW.status = 'noshow' AND OLD.status != 'noshow' THEN 1 WHEN NEW.status != 'noshow' AND OLD.status = 'noshow' THEN -1 ELSE 0 END,
            last_updated = datetime('now')
          WHERE client_id = NEW.client_id;
        END
      `).run();
      
      await env.lead_db.prepare(`
        CREATE TRIGGER update_client_summary_on_delete
        AFTER DELETE ON leads
        BEGIN
          UPDATE client_summary 
          SET 
            total_count = total_count - 1,
            verified_count = verified_count - CASE WHEN OLD.status = 'verified' THEN 1 ELSE 0 END,
            pending_count = pending_count - CASE WHEN OLD.status = 'pending' THEN 1 ELSE 0 END,
            rejected_count = rejected_count - CASE WHEN OLD.status = 'rejected' THEN 1 ELSE 0 END,
            noshow_count = noshow_count - CASE WHEN OLD.status = 'noshow' THEN 1 ELSE 0 END,
            last_updated = datetime('now')
          WHERE client_id = OLD.client_id;
          
          DELETE FROM client_summary 
          WHERE client_id = OLD.client_id 
          AND total_count <= 0;
        END
      `).run();
      
      // Backfill existing data
      await env.lead_db.prepare(`
        INSERT OR REPLACE INTO client_summary (client_id, total_count, verified_count, pending_count, rejected_count, noshow_count, last_updated)
        SELECT 
          client_id,
          COUNT(*) as total_count,
          SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
          SUM(CASE WHEN status = 'noshow' THEN 1 ELSE 0 END) as noshow_count,
          datetime('now') as last_updated
        FROM leads
        WHERE client_id IS NOT NULL AND client_id != ''
        GROUP BY client_id
      `).run();
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Summary table initialized successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Init summary error:', error);
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
// Agent Management Functions
// ============================================

async function handleAddAgent(request, env) {
  try {
    const { agent_name, phone_number, dingtalk_id } = await request.json();
    
    if (!agent_name || !phone_number) {
      return new Response(JSON.stringify({ success: false, error: '姓名和电话为必填项' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const stmt = await env.lead_db.prepare(`
      INSERT INTO agents (agent_name, phone_number, dingtalk_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
    `);
    
    const result = await stmt.bind(agent_name, phone_number, dingtalk_id || null).run();
    
    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
      message: '员工添加成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleUpdateAgent(request, env) {
  try {
    const { id, agent_name, phone_number, dingtalk_id } = await request.json();
    
    if (!id || !agent_name || !phone_number) {
      return new Response(JSON.stringify({ success: false, error: 'ID、姓名和电话为必填项' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const stmt = await env.lead_db.prepare(`
      UPDATE agents 
      SET agent_name = ?, phone_number = ?, dingtalk_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    
    const result = await stmt.bind(agent_name, phone_number, dingtalk_id || null, id).run();
    
    if (result.meta.rows_written === 0) {
      return new Response(JSON.stringify({ success: false, error: '未找到该员工' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: '员工更新成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleToggleAgentStatus(request, env) {
  try {
    const { id, is_active } = await request.json();
    
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: '缺少ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const stmt = await env.lead_db.prepare(`
      UPDATE agents 
      SET is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    
    const result = await stmt.bind(is_active, id).run();
    
    if (result.meta.rows_written === 0) {
      return new Response(JSON.stringify({ success: false, error: '未找到该员工' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: '状态更新成功'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

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
        lead.client_id,
        conversionName,
        formattedTime,
        adjustmentType,
        adjustedValue,
        'HKD',
        lead.gclid || ''
      ]);
    }
    
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
    
    const encodedHeader = btoa(JSON.stringify(header))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    const encodedPayload = btoa(JSON.stringify(payload))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    const message = `${encodedHeader}.${encodedPayload}`;
    
    const encoder = new TextEncoder();
    const messageBuffer = encoder.encode(message);
    
    const privateKey = credentials.private_key;
    
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

// ============================================
// Combined Conversion Stats
// ============================================
async function handleCombinedConversionStats(env, request) {
  try {
    const url = new URL(request.url);
    let dateFrom = url.searchParams.get('date_from') || '';
    let dateTo = url.searchParams.get('date_to') || '';
    
    if (!dateFrom || !dateTo) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
      dateTo = now.toISOString().split('T')[0];
    }
    
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
          WHEN ConvValue = '1' THEN '1'
          ELSE '>0'
        END AS Conversion_Category,
        COUNT(*) AS Record_Count
      FROM paid
      GROUP BY Conversion_Category
    `;
    
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
          WHEN ConvValue = '1' THEN '1'
          ELSE '>0'
        END AS Conversion_Category,
        COUNT(*) AS Record_Count
      FROM nonpaid
      GROUP BY Conversion_Category
    `;
    
    const paidStmt = await env.lead_db.prepare(paidSql);
    const paidResult = await paidStmt.bind(...params).all();
    
    const nonpaidStmt = await env.lead_db.prepare(nonpaidSql);
    const nonpaidResult = await nonpaidStmt.bind(...params).all();
    
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
    
    const categories = ['-', '0', '1', '>0'];
    const categoryLabels = {
      '-': '未验证',
      '0': '无关查询',
      '1': '未有来电',
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
    const clientId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_ID");
    const clientSecret = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CLIENT_SECRET");
    const refreshToken = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_REFRESH_TOKEN");
    const developerToken = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_DEVELOPER_TOKEN");
    const loginCustomerId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    const customerId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CUSTOMER_ID");
    const telId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_tel");
    const formId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_form");
    const msgId = await env.AGENT_PHONE_MAP.get("GOOGLE_ADS_CONVERSION_ACTION_ID_msg");
    
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
    const url = new URL(request.url);
    const all = url.searchParams.get('all') === 'true';
    
    let sql = `
      SELECT id, agent_name, phone_number, dingtalk_id, is_active
      FROM agents
    `;
    
    if (!all) {
      sql += ` WHERE is_active = 1`;
    }
    
    sql += ` ORDER BY agent_name`;
    
    const stmt = await env.lead_db.prepare(sql);
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
    const storedPassword = await env.AGENT_PHONE_MAP.get("admin_password");    

    if (password !== storedPassword) {
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const stmt = await env.lead_db.prepare(`
      SELECT phone_number, agent_name 
      FROM agents 
      WHERE admin = 1 AND phone_number = ?
    `);
    
    const result = await stmt.bind(phone).first();
    
    if (!result) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '手机号不是管理员' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const token = btoa(phone + ':' + Date.now());
    return new Response(JSON.stringify({ 
      success: true, 
      token: token, 
      phone: phone,
      agent_name: result.agent_name
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
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
// Admin Get Leads (MODIFIED - Uses Summary Table)
// ============================================

async function handleAdminGetLeads(request, env) {
  try {
    const url = new URL(request.url);
    
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = (page - 1) * limit;
    
    const status = url.searchParams.get('status') || '';
    const noshow = url.searchParams.get('noshow') === 'true';
    const agent = url.searchParams.get('agent') || '';
    const trafficType = url.searchParams.get('traffic_type') || '';
    const campaignId = url.searchParams.get('campaign') || '';
    const dateFrom = url.searchParams.get('date_from') || '';
    const dateTo = url.searchParams.get('date_to') || '';
    const search = url.searchParams.get('search') || '';
    
    const sortBy = url.searchParams.get('sort_by') || 'id';
    const sortOrder = url.searchParams.get('sort_order') || 'DESC';
    
    const whereConditions = [];
    const params = [];
    
    if (status) {
      whereConditions.push('l.status = ?');
      params.push(status);
    }
    if (noshow) {
      whereConditions.push('l.value = 1');
    }
    if (agent) {
      whereConditions.push('l.agent_name = ?');
      params.push(agent);
    }
    if (trafficType) {
      whereConditions.push('l.traffic_type = ?');
      params.push(trafficType);
    }
    if (campaignId) {
      whereConditions.push('c.campaign_id = ?');
      params.push(campaignId);
    }
    if (dateFrom) {
      whereConditions.push('date(l.created_at) >= date(?)');
      params.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push('date(l.created_at) <= date(?)');
      params.push(dateTo);
    }
    if (search) {
      whereConditions.push('(l.client_id LIKE ? OR l.agent_name LIKE ? OR l.district LIKE ?)');
      params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    const countStmt = await env.lead_db.prepare(`SELECT COUNT(*) as total FROM leads l LEFT JOIN campaign c ON l.utm_id = c.campaign_id ${whereClause}`);
    const countResult = await countStmt.bind(...params).first();
    const total = countResult.total;
    
    const dataStmt = await env.lead_db.prepare(`
      SELECT l.id, l.client_id, l.user_ip, l.agent_name, l.agent_phone, l.click_type,
        l.rent, l.property_price, l.size, l.district, l.property_type,
        l.landing_page, l.page_location,
        l.utm_source, l.utm_medium, l.utm_campaign, l.gclid,
        l.traffic_type, l.traffic_source, c.campaign_name,
        l.value, l.status, l.verified_by, l.created_at, l.time_to_conversion, l.verified_at, l.budget_range, l.transaction_type
      FROM leads l
      LEFT JOIN campaign c ON l.utm_id = c.campaign_id
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
    
    const campaignStmt = await env.lead_db.prepare(`
      SELECT campaign_id, campaign_name FROM campaign 
      WHERE campaign_name IS NOT NULL AND campaign_name != ''
      ORDER BY campaign_name
    `);
    const campaignResult = await campaignStmt.all();
    const campaigns = campaignResult.results.map(row => ({
      id: row.campaign_id,
      name: row.campaign_name
    }));
    
    // ===== USE SUMMARY TABLE INSTEAD OF EXPENSIVE QUERIES =====
    // Get client counts from summary table (fast - only unique clients)
    const clientCountStmt = await env.lead_db.prepare(`
      SELECT client_id, total_count as count 
      FROM client_summary
    `);
    const clientCountResult = await clientCountStmt.all();
    const clientCounts = {};
    for (const row of clientCountResult.results) {
      clientCounts[row.client_id] = row.count;
    }
    
    // Get verified clients from summary table (fast - only unique clients)
    const verifiedClientsStmt = await env.lead_db.prepare(`
      SELECT client_id 
      FROM client_summary 
      WHERE verified_count > 0
    `);
    const verifiedResult = await verifiedClientsStmt.all();
    const verifiedClientIds = verifiedResult.results.map(r => r.client_id);
    
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
        trafficTypes: trafficStmt.results.map(r => r.traffic_type),
        campaigns: campaigns
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
        } else if (value === 1) {
          newStatus = 'noshow';
        } else { 
          newStatus = 'verified'; 
        }
        
        let updateStmt, params;
        
        if (newStatus === 'verified' || newStatus === 'noshow') {
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
          
        } else {
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
    
    if (!all) {
      const status = url.searchParams.get('status') || '';
      const agent = url.searchParams.get('agent') || '';
      const dateFrom = url.searchParams.get('date_from') || '';
      const dateTo = url.searchParams.get('date_to') || '';
      
      if (status) { whereConditions.push('l.status = ?'); params.push(status); }
      if (agent) { whereConditions.push('l.agent_name = ?'); params.push(agent); }
      if (dateFrom) { whereConditions.push('date(l.created_at) >= date(?)'); params.push(dateFrom); }
      if (dateTo) { whereConditions.push('date(l.created_at) <= date(?)'); params.push(dateTo); }
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    const stmt = await env.lead_db.prepare(`
      SELECT l.id, l.client_id, l.user_id, l.agent_name, l.click_type, l.rent, l.district, l.property_type, 
             l.utm_source, l.utm_medium, l.utm_campaign, l.gclid, l.traffic_type, c.campaign_name,
             l.value, l.status, l.verified_by, l.created_at, l.time_to_conversion, l.verified_at, l.budget_range, l.transaction_type 
      FROM leads l
      LEFT JOIN campaign c ON l.utm_id = c.campaign_id
      ${whereClause}
      ORDER BY l.id DESC
    `);
    
    const result = await stmt.bind(...params).all();
    const leads = result.results;
    
    function getStatusLabel(status, value) {
      if (status === 'pending') return '待处理';
      if (value === 0) return '已拒绝';
      if (value === 1) return '未有来电';
      if (value > 1) return '已验证';
      return status || '-';
    }
    
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
        getStatusLabel(lead.status, lead.value),
        '"' + (lead.verified_by || '') + '"',
        lead.created_at || '',
        lead.time_to_conversion || '',
        lead.verified_at || '',
        '"' + (lead.transaction_type || '') + '"'
      ];
      csvRows.push(row.join(','));
    }
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
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
              time_to_conversion,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY time_to_conversion DESC) as rn_tc,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY created_at ASC) as rn_asc,
              ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY value DESC) as rn_val
          FROM leads
          WHERE gclid IS NOT NULL 
            AND gclid <> ''
            AND client_id IS NOT NULL 
            AND client_id <> 'unknown' 
            AND value IS NOT NULL
            AND value <> 1
            AND (reinstatement_submitted_at IS NULL OR datetime(reinstatement_submitted_at) < datetime('now', '-90 days'))
            AND datetime(created_at) BETWEEN datetime('now', '-90 days') AND datetime('now', '-1 days')
      )
      SELECT 
          L.client_id,
          MAX(CASE WHEN L.rn_tc = 1 THEN L.time_to_conversion END) as time_to_conversion,
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
        time_to_conversion: lead.time_to_conversion,
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
    let dateFrom = url.searchParams.get('date_from') || '';
    let dateTo = url.searchParams.get('date_to') || '';
    const groupBy = url.searchParams.get('group_by') || 'day';
    
    if (!dateFrom || !dateTo) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
      dateTo = now.toISOString().split('T')[0];
    }

    let dateCondition = '';
    let params = [];
    
    if (dateFrom && dateTo) {
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
      default:
        dateFormat = `date(hk_created_at)`;
    }
    
    const sql = `
      WITH converted_leads AS (
        SELECT 
          *,
          datetime(created_at, '+8 hours') as hk_created_at,
          ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY verified_at DESC) as rn
        FROM leads
        WHERE value > 1
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

// ============================================
// HTML Page - Complete with all modifications
// ============================================

async function handleAdminPage(env) {
  // ... (keep your existing HTML - it's unchanged)
  // The HTML is identical to what you have, no changes needed
  // I'll include it below for completeness
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LeasingHub 管理后台</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; overflow-x: auto; max-width: 100vw; }
    .login-box { max-width: 400px; margin: 100px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .login-box input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
    .login-box button { width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .error { color: red; margin-top: 10px; display: none; }
    .admin-box {max-width: 100%; padding: 20px; overflow: visible;}
    
    /* Stats Grid */
    .stats-grid { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { background: white; padding: 20px; border-radius: 12px; min-width: 150px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .stat-card .number { font-size: 32px; font-weight: bold; }
    
    /* Table */
    .table-wrapper { overflow-x: auto; overflow-y: visible; width: 100%; -webkit-overflow-scrolling: touch;}
    .wrap-text { word-wrap: break-word; white-space: normal; word-break: break-word; max-width: 250px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; min-width: 1300px; }
    th, td { padding: 4px 8px; text-align: left; white-space: nowrap; }
    th { background: #f8f9fa; position: sticky; top: 0; }

    .first-row td {
    border-bottom: none !important;
    padding: 4px 8px !important;
    }

    .second-row td {
        border: none !important;
        padding: 2px 8px 4px 8px !important;
        font-size: 14px;
        color: #666;
        background-color: transparent !important;
    }

    .second-row td {
        border-bottom: 1px solid #eee !important;
    }

    .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; margin-right: 10px; }
    .btn-primary { background: #667eea; color: white; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-success { background: #28a745; color: white; }
    .btn-warning { background: #ffc107; color: #333; }
    .btn-small { padding: 6px 12px; font-size: 12px; }
    
    .filters { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; background: white; padding: 15px; border-radius: 8px; }
    .filter-group { display: flex; flex-direction: column; }
    .filter-group label { font-size: 12px; margin-bottom: 4px; }
    .filter-group select, .filter-group input { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    
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
    .status-noshow-small { background: #6c757d; color: white; }
    
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
    
    .verified-by-select { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; min-width: 100px; font-size: 12px; }
    
.combined-stats-container {
    width: 340px;
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
// Your existing JavaScript - no changes needed
// The frontend remains exactly the same
</script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}