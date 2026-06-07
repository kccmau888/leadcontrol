export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // ============================================
    // 1. 验证页面路由
    // ============================================
    if (path === '/test-districts' && request.method === 'GET') {
      const districtsJson = await env.AGENT_PHONE_MAP.get('districts');
      return new Response(JSON.stringify({ raw: districtsJson, parsed: districtsJson ? JSON.parse(districtsJson) : null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path === '/verify' && request.method === 'GET') {
      return handleVerifyPage(env, url, request);
    }
    
    if (path === '/verify' && request.method === 'POST') {
      return handleVerifyAction(request, env);
    }
    
    // ============================================
    // 2. 管理后台路由
    // ============================================
    if (path === '/admin' && request.method === 'GET') {
      return handleAdminPage(env);
    }
    
    if (path === '/admin/api/login' && request.method === 'POST') {
      return handleAdminLogin(request, env);
    }
    
    if (path === '/admin/api/leads' && request.method === 'GET') {
      return handleAdminGetLeads(request, env);
    }
    
    if (path === '/admin/api/leads/batch-update' && request.method === 'POST') {
      return handleAdminBatchUpdate(request, env);
    }
    
    if (path === '/admin/api/stats' && request.method === 'GET') {
      return handleAdminGetStats(env);
    }
    
    if (path === '/admin/api/export' && request.method === 'GET') {
      return handleAdminExport(request, env);
    }
    
    // ============================================
    // 3. 原有的 API 路由（接收 GTM 数据）
    // ============================================
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const data = await request.json();
      
      const client_id = String(data.client_id || 'unknown');
      const rent = String(data.rent || '');
      const property_price = String(data.property_price || '');
      const size = String(data.size || '');
      const district = String(data.district || '');
      const property_type = String(data.property_type || '');
      const agent_code = String((data.agent || '').toLowerCase());
      const click_type = String(data.click_type || '');
      const page_location = String(data.page_location || '');
      const landing_page = String(data.landing_page || '');
      
      const now = new Date();
      const isoTime = now.toISOString();
      const formattedTime = now.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
      
      const utm_source = String(data.utm_source || '');
      const utm_medium = String(data.utm_medium || '');
      const utm_campaign = String(data.utm_campaign || '');
      const utm_term = String(data.utm_term || '');
      const utm_content = String(data.utm_content || '');
      const gclid = String(data.gclid || '');
      const referrer = String(data.referrer || '');
      
      const traffic_type = String(data.traffic_type || '');
      const traffic_source = String(data.traffic_source || '');
      const traffic_detail = String(data.traffic_detail || '');

      // ============================================
      // 提取搜索词
      // ============================================
      let search_query = '';
      if (referrer && referrer.includes('google.com')) {
        try {
          const referrerUrl = new URL(referrer);
          search_query = referrerUrl.searchParams.get('q') || '';
          if (search_query) search_query = decodeURIComponent(search_query);
        } catch (e) {}
      }
      if (landing_page && landing_page.includes('?') && !search_query) {
        try {
          const landingUrl = new URL(landing_page);
          search_query = landingUrl.searchParams.get('q') || '';
          if (search_query) search_query = decodeURIComponent(search_query);
        } catch (e) {}
      }

      // ============================================
      // 0. 查询同一 client_id 的历史记录
      // ============================================
      let historyRecords = [];
      try {
        const historyStmt = await env.lead_db.prepare(`
          SELECT id, agent_name, click_type, status, created_at, verified_at, verified_by
          FROM leads WHERE client_id = ? ORDER BY id ASC LIMIT 10
        `);
        const { results } = await historyStmt.bind(client_id).all();
        historyRecords = results;
        console.log(`📋 Found ${historyRecords.length} history record(s) for client: ${client_id}`);
      } catch (historyError) {
        console.error('History query error:', historyError);
      }

      // ============================================
      // 1. 获取代理电话和名称（支持 general_enquiry 特殊逻辑）
      // ============================================
      const DEFAULT_HOTLINE = env.DEFAULT_HOTLINE || '+85291333030';
      let agent_phone = DEFAULT_HOTLINE;
      let agent_found = false;
      let effective_agent_name = agent_code;  // For database storage, defaults to GTM value
      
      // Special handling for general_enquiry
           // Special handling for general_enquiry
      if (agent_code === 'general_enquiry') {
        let kvKey;
        if (click_type === 'tel') {
          kvKey = 'general_enquiry';
        } else if (click_type === 'form') {
          kvKey = 'general_enquiry_form';
        } else {
          kvKey = 'general_enquiry_msg';
        }
        try {
          const kvValue = await env.AGENT_PHONE_MAP.get(kvKey);
          if (kvValue) {
            let parsedValue;
            if (typeof kvValue === 'string' && kvValue.startsWith('[')) {
              parsedValue = JSON.parse(kvValue);
            } else {
              parsedValue = kvValue;
            }
            if (Array.isArray(parsedValue) && parsedValue.length >= 2) {
              effective_agent_name = parsedValue[0];   // Agent code name (e.g., "kevin_chan")
              agent_phone = parsedValue[1];            // Phone number
              agent_found = true;
              console.log(`✅ general_enquiry (${click_type}) → Key: ${kvKey}, Agent: ${effective_agent_name}, Phone: ${agent_phone}`);
            } else {
              console.log(`⚠️ Invalid format for ${kvKey}, expected JSON array ["agent_name","phone"]`);
            }
          } else {
            console.log(`⚠️ KV key ${kvKey} not found, using defaults`);
          }
        } catch (e) {
          console.error(`KV error for ${kvKey}:`, e);
        }
      } else if (agent_code) {
        // Regular agent: KV stores just the phone number
        try {
          const kvPhone = await env.AGENT_PHONE_MAP.get(agent_code);
          if (kvPhone) {
            agent_phone = kvPhone;
            agent_found = true;
            console.log(`✅ Agent found: ${agent_code} -> ${agent_phone}`);
          } else {
            console.log(`⚠️ Agent not found in KV: ${agent_code}, using default`);
          }
        } catch (kvError) {
          console.error(`KV error for ${agent_code}:`, kvError);
        }
      } else if (agent_code) {
        // Regular agent: KV stores just the phone number
        try {
          const kvPhone = await env.AGENT_PHONE_MAP.get(agent_code);
          if (kvPhone) {
            agent_phone = kvPhone;
            agent_found = true;
            console.log(`✅ Agent found: ${agent_code} -> ${agent_phone}`);
          } else {
            console.log(`⚠️ Agent not found in KV: ${agent_code}, using default`);
          }
        } catch (kvError) {
          console.error(`KV error for ${agent_code}:`, kvError);
        }
      }

      if (!agent_phone.startsWith('+')) {
        agent_phone = '+' + agent_phone;
      }
      
      // For DingTalk message display name, use effective_agent_name directly
      let agent_display_name = effective_agent_name;

      // ============================================
      // 2. 写入数据库
      // ============================================
      let leadId = null;
      let dbError = null;
      try {
        const insertStmt = await env.lead_db.prepare(`
          INSERT INTO leads (
            client_id, agent_name, agent_phone, click_type,
            rent, property_price, size, district, property_type,
            page_location, page_referrer, landing_page,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content,
            gclid, traffic_type, traffic_source, traffic_detail,
            search_query, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = await insertStmt.bind(
          client_id, effective_agent_name, agent_phone, click_type,
          rent, property_price, size, district, property_type,
          page_location, referrer, landing_page,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content,
          gclid, traffic_type, traffic_source, traffic_detail,
          search_query, 'pending', isoTime
        ).run();

        leadId = result.meta.last_row_id;
        console.log(`✅ Lead saved, ID: ${leadId} | Agent: ${effective_agent_name}`);
      } catch (error) {
        dbError = error;
        console.error('❌ Database insert error:', error);
      }

      // ============================================
      // 3. 获取钉钉凭证和发送消息
      // ============================================
      const DINGTALK_APP_KEY = env.DINGTALK_APP_KEY;
      const DINGTALK_APP_SECRET = env.DINGTALK_APP_SECRET;
      const DINGTALK_AGENT_ID = env.DINGTALK_AGENT_ID;

      if (!DINGTALK_APP_KEY || !DINGTALK_APP_SECRET || !DINGTALK_AGENT_ID) {
        return new Response(JSON.stringify({ error: 'Missing DingTalk credentials' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 获取钉钉 Access Token
      const tokenUrl = `https://oapi.dingtalk.com/gettoken?appkey=${DINGTALK_APP_KEY}&appsecret=${DINGTALK_APP_SECRET}`;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();
      
      if (tokenData.errcode !== 0) {
        return new Response(JSON.stringify({ error: `Token error: ${tokenData.errmsg}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      const accessToken = tokenData.access_token;

      // 获取接收人的钉钉 User ID (需要手机号)
      const userRes = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: agent_phone })
      });
      const userData = await userRes.json();
      
      let userId = null;
      if (userData.errcode === 0 && userData.result && userData.result.userid) {
        userId = userData.result.userid;
        console.log(`✅ DingTalk user ID found for ${agent_phone}`);
      } else {
        console.log(`⚠️ Could not retrieve DingTalk user ID for ${agent_phone}`);
      }

      // 构建房源信息摘要
      const propertyLines = [];
      if (rent) propertyLines.push(`💰 **租:** ${rent}`);
      if (property_price) propertyLines.push(`🏷️ **售:** ${property_price}`);
      if (size) propertyLines.push(`📐 **面积:** ${size}`);
      if (district) propertyLines.push(`📍 **区域:** ${district}`);
      if (property_type) propertyLines.push(`🏢 **类型:** ${property_type}`);
      
      const propertyInfo = propertyLines.length > 0 
        ? propertyLines.join('\n') 
        : '📋 暂无房源详细信息';

      // 构建营销来源信息
      const marketingLines = [];
      if (traffic_type) marketingLines.push(`**流量类型:** ${traffic_type}`);
      if (traffic_source) marketingLines.push(`**来源:** ${traffic_source}`);
      if (traffic_detail) marketingLines.push(`**详情:** ${traffic_detail}`);
      if (utm_source) marketingLines.push(`**UTM来源:** ${utm_source}`);
      if (utm_medium) marketingLines.push(`**UTM媒介:** ${utm_medium}`);
      if (utm_campaign) marketingLines.push(`**UTM活动:** ${utm_campaign}`);
      if (utm_term) marketingLines.push(`**UTM关键词:** ${utm_term}`);
      if (gclid) marketingLines.push(`**GCLID:** \`${gclid.substring(0, 30)}...\``);
      
      const marketingInfo = marketingLines.length > 0 
        ? marketingLines.join('\n') 
        : '未检测到来源信息';

      // ============================================
      // 构建历史记录部分
      // ============================================
      let historySection = '';
      if (historyRecords.length > 0) {
        const historyLines = [];
        historyLines.push(`\n\n---\n\n### 📜 历史记录 (同一客户)\n\n`);
        historyLines.push(`| ID | 日期 | 代理 | 来源 | 状态 | 处理人 | 处理时间 |`);
        historyLines.push(`|----|------|------|------|------|--------|----------|`);
        
        for (const record of historyRecords) {
          if (record.id === leadId) continue;
          
          let recordDate = record.created_at || '未知';
          if (recordDate && recordDate !== '未知') {
            try {
              recordDate = new Date(recordDate).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
            } catch (e) {}
          }
          
          const recordId = record.id;
          const recordAgent = record.agent_name || '未知';
          const recordClickType = record.click_type || '未知';
          const recordStatus = record.status === 'pending' ? '⏳ 待处理' : (record.status === 'verified' ? '✅ 确认有效' : '❌ 确认垃圾');
          
          const recordVerifiedBy = record.verified_by || '-';
          
          let recordVerifiedDate = record.verified_at || '未处理';
          if (recordVerifiedDate && recordVerifiedDate !== '未处理') {
            try {
              recordVerifiedDate = new Date(recordVerifiedDate).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
            } catch (e) {}
          }
          
          historyLines.push(`| ${recordId} | ${recordDate} | ${recordAgent} | ${recordClickType} | ${recordStatus} | ${recordVerifiedBy} | ${recordVerifiedDate} |`);
        }
        
        if (historyLines.length > 2) {
          historySection = historyLines.join('\n');
          const historyCount = historyRecords.length - (leadId ? 1 : 0);
          if (historyCount > 0) {
            historySection += `\n\n⚠️ **注意：该客户已有 ${historyCount} 次历史咨询记录，请确认是否需要重复跟进！**`;
          }
        }
      }

      // 重复点击警告
      const repeatWarning = data.previous_conversion ? '\n\n⚠️ **该用户之前已点击过咨询按钮！**' : '';

      // ============================================
      // 构建验证链接
      // ============================================
      const host = request.headers.get('host');
      const verifyUrl = `https://${host}/verify?id=${leadId}`;

      // ============================================
      // 构建完整的钉钉消息
      // ============================================
      let messageText = `## 📞 新线索通知\n\n` +
        `**线索ID:** \`#${leadId || 'N/A'}\`\n\n` +
        `${formattedTime}\n\n` +
        `---\n\n` +
        `**客号:** \`${client_id}\`\n\n` +
        `---\n\n` +
        `${propertyInfo}\n\n` +
        `---\n\n` +
        `### 👤 ${agent_display_name}\n\n` +
        `---\n\n` +
        `### 🎯 线索来源\n\n` +
        `**接收模式:** ${click_type || '未知'}\n\n`;
      
      if (search_query) {
        messageText += `**🔍 搜索词:** ${search_query}\n\n`;
      }
      
      messageText += `${marketingInfo}\n\n` +
        `---\n\n` +
        `### 🌐 落地页\n\n` +
        `${landing_page || '未知'}\n\n` +
        `---\n\n` +
        `### 📍 点击页面\n\n` +
        `${page_location || '未知'}\n\n` +
        `---\n\n` +
        `### 🔗 [验证线索](${verifyUrl})\n\n` +
        `⚠️<font color="red">优先跟进权归首位确认线索者所有</font>\n\n` +
        `---\n\n` +
        `${repeatWarning}${historySection}`;
      
      // 发送钉钉消息给代理
      if (userId) {
        const sendRes = await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: parseInt(DINGTALK_AGENT_ID),
            userid_list: userId,
            msg: {
              msgtype: 'markdown',
              markdown: {
                title: '📞 新线索通知',
                text: messageText
              }
            }
          })
        });
        const sendData = await sendRes.json();
        
        if (sendData.errcode !== 0) {
          console.error(`Send error: ${sendData.errmsg}`);
        }
      } else {
        console.warn(`No user ID for ${agent_phone}, message not sent.`);
      }

      // ============================================
      // 4. 发送副本给管理员
      // ============================================

      let adminPhones = [];
      try {
        const adminsJson = await env.AGENT_PHONE_MAP.get('admins');
        if (adminsJson) {
          adminPhones = JSON.parse(adminsJson);
        }
      } catch (e) {}

      const adminMessageText = `## 📋 线索副本 (管理员)\n\n` +
        `**线索ID:** \`#${leadId || 'N/A'}\`\n\n` +
        `${formattedTime}\n\n` +
        `---\n\n` +
        `**客号:** \`${client_id}\`\n\n` +
        `**代理:** ${agent_display_name}\n\n` +
        `**代理电话:** ${agent_phone}\n\n` +
        `---\n\n` +
        `${propertyInfo}\n\n` +
        `---\n\n` +
        `### 🎯 线索来源\n\n` +
        `**接收模式:** ${click_type || '未知'}\n\n` +
        (search_query ? `**🔍 搜索词:** ${search_query}\n\n` : '') +
        `${marketingInfo}\n\n` +
        `---\n\n` +
        `### 🌐 落地页\n\n` +
        `${landing_page || '未知'}\n\n` +
        `---\n\n` +
        `### 📍 点击页面\n\n` +
        `${page_location || '未知'}\n\n` +
        `---\n\n` +
        `### 🔗 [验证线索](${verifyUrl})\n\n` +
        `⚠️<font color="red">优先跟进权归首位确认线索者所有</font>\n\n` +
        `---\n\n` +
        `⚠️ 此消息为系统自动发送的副本。${historySection}`;

      let adminSentCount = 0;
      for (const adminPhone of adminPhones) {
        try {
          let formattedAdminPhone = adminPhone;
          if (!formattedAdminPhone.startsWith('+')) {
            formattedAdminPhone = '+' + formattedAdminPhone;
          }
          
          const adminUserRes = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${accessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile: formattedAdminPhone })
          });
          const adminUserData = await adminUserRes.json();
          
          if (adminUserData.errcode === 0 && adminUserData.result && adminUserData.result.userid) {
            const adminUserId = adminUserData.result.userid;
            await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent_id: parseInt(DINGTALK_AGENT_ID),
                userid_list: adminUserId,
                msg: {
                  msgtype: 'markdown',
                  markdown: {
                    title: '📋 线索副本',
                    text: adminMessageText
                  }
                }
              })
            });
            adminSentCount++;
          }
        } catch (e) {}
      }

      // 返回成功
      return new Response(JSON.stringify({ 
        success: true, 
        lead_id: leadId,
        client_id: client_id,
        agent_mapped: agent_found,
        agent_used: agent_phone,
        agent_display_name: agent_display_name,
        admin_copies_sent: adminSentCount,
        history_count: historyRecords.length,
        db_error: dbError ? dbError.message : null
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  },
};

// ============================================
// 计算转化价值
// ============================================

function calculateValue(type, range, baseRent, basePrice) {
  const extractNumber = (str) => {
    if (!str) return 0;
    const match = str.match(/(\d+(?:,\d+)?)/);
    return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
  };
  
  const rentNum = extractNumber(baseRent);
  const priceNum = extractNumber(basePrice);
  
  if (type === 'rent') {
    switch (range) {
      case 'below_20k': return 2000;
      case '20k_50k': return Math.round(35000 * 0.3);
      case '50k_80k': return Math.round(65000 * 0.3);
      case '80k_120k': return Math.round(100000 * 0.3);
      case '120k_160k': return Math.round(140000 * 0.3);
      case 'above_160k': return Math.round(200000 * 0.3);
      default: return rentNum > 0 ? Math.round(rentNum * 0.3) : 2000;
    }
  } else {
    switch (range) {
      case 'below_8m': return 2000;
      case '8m_15m': return Math.round(11500000 * 0.003);
      case '15m_20m': return Math.round(17500000 * 0.003);
      case '20m_50m': return Math.round(35000000 * 0.003);
      case 'above_50m': return Math.round(50000000 * 0.003);
      default: return priceNum > 0 ? Math.round(priceNum * 0.003) : 2000;
    }
  }
}

// ============================================
// 验证页面处理函数
// ============================================

async function handleVerifyPage(env, url, request) {
  const leadId = url.searchParams.get('id');
  
  if (!leadId) {
    return new Response('缺少线索ID参数', { status: 400 });
  }
  
  // 查询线索信息
  const lead = await env.lead_db.prepare(`
    SELECT id, client_id, agent_name, click_type, 
           rent, property_price, size, district, property_type,
           landing_page, page_location, status, created_at, verified_at, verified_by
    FROM leads 
    WHERE id = ?
  `).bind(leadId).first();
  
  if (!lead) {
    return new Response('线索不存在', { status: 404 });
  }
  
  // 获取 URL 参数
  const mode = url.searchParams.get('mode');
  const isRecoveryMode = (mode === 'recovery');
  
  // 检查同一 client_id 是否有已被处理的记录
  const verifiedRecord = await env.lead_db.prepare(`
    SELECT id, agent_name, verified_by, verified_at, status
    FROM leads 
    WHERE client_id = ? AND status = 'verified'
    ORDER BY verified_at DESC
    LIMIT 1
  `).bind(lead.client_id).first();
  
  const rejectedRecord = await env.lead_db.prepare(`
    SELECT id, agent_name, verified_by, verified_at, status
    FROM leads 
    WHERE client_id = ? AND status = 'rejected'
    ORDER BY verified_at DESC
    LIMIT 1
  `).bind(lead.client_id).first();
  
  // 如果已经有 verified 记录，永久锁定
  if (verifiedRecord) {
    const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>线索验证 - 已锁定</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px;display:flex;justify-content:center;align-items:center}.container{max-width:500px;margin:0 auto;background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden}.header{background:linear-gradient(135deg,#da196e,#b9155e);color:white;padding:30px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.content{padding:30px}.warning-icon{font-size:60px;text-align:center;margin-bottom:20px}.warning-message{background:#fff3cd;border-left:4px solid #ffc107;padding:16px;border-radius:8px;margin-bottom:20px}.info-row{padding:8px 0;border-bottom:1px solid #e9ecef}.info-label{font-weight:600;color:#495057;display:inline-block;width:100px}.info-value{color:#212529}.button-group{display:flex;gap:16px;margin-top:24px}.btn{flex:1;padding:12px 20px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:transform 0.2s,opacity 0.2s}.btn:hover{transform:translateY(-2px);opacity:0.9}.btn-back{background:#6c757d;color:white}.footer{background:#f8f9fa;padding:16px 30px;text-align:center;font-size:12px;color:#6c757d}</style>
</head>
<body>
<div class="container"><div class="header"><h1>🔍 线索验证</h1></div>
<div class="content"><div class="warning-icon">⚠️</div>
<div class="warning-message"><strong>此客户已被其他代理确认为有效线索！</strong><br><br>
<div class="info-row"><span class="info-label">处理代理：</span><span class="info-value">${escapeHtml(verifiedRecord.agent_name) || '未知'}</span></div>
<div class="info-row"><span class="info-label">处理时间：</span><span class="info-value">${new Date(verifiedRecord.verified_at).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}</span></div></div>
</div>
<div class="footer">此线索来自 LeasingHub 系统<br><font color="red">该客户已被确认有效，无法再次修改</font></div></div>
</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  
  // 如果是恢复模式，直接显示正常验证页面
  if (isRecoveryMode && rejectedRecord) {
    // 继续往下执行，显示正常验证页面
  } else if (rejectedRecord && !isRecoveryMode) {
    const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>线索验证 - 可恢复</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px;display:flex;justify-content:center;align-items:center}.container{max-width:500px;margin:0 auto;background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden}.header{background:linear-gradient(135deg,#da196e,#b9155e);color:white;padding:30px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.content{padding:30px}.warning-icon{font-size:60px;text-align:center;margin-bottom:20px}.warning-message{background:#fff3cd;border-left:4px solid #ffc107;padding:16px;border-radius:8px;margin-bottom:20px}.info-row{padding:8px 0;border-bottom:1px solid #e9ecef}.info-label{font-weight:600;color:#495057;display:inline-block;width:100px}.info-value{color:#212529}.button-group{display:flex;gap:16px;margin-top:24px;justify-content:center}.btn{flex:1;padding:12px 20px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:transform 0.2s,opacity 0.2s;text-decoration:none;text-align:center;display:inline-block;max-width:200px}.btn-verify{background:#28a745;color:white}.footer{background:#f8f9fa;padding:16px 30px;text-align:center;font-size:12px;color:#6c757d}</style>
</head>
<body>
<div class="container"><div class="header"><h1>🔍 线索验证</h1></div>
<div class="content"><div class="warning-icon">⚠️</div>
<div class="warning-message"><strong>此线索曾被标记为垃圾线索！</strong><br><br>
<div class="info-row"><span class="info-label">原处理代理：</span><span class="info-value">${escapeHtml(rejectedRecord.agent_name) || '未知'}</span></div>
<div class="info-row"><span class="info-label">原处理时间：</span><span class="info-value">${new Date(rejectedRecord.verified_at).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}</span></div></div>
<p style="margin-bottom:20px;color:#666;">该线索曾被标记为垃圾/无关询问，如需重新确认，请点击下方按钮继续。</p>
<div class="button-group"><a href="/verify?id=${leadId}&mode=recovery" class="btn btn-verify" style="text-decoration:none;text-align:center;display:inline-block;">✅ 继续验证此线索</a></div></div>
<div class="footer">此线索来自 LeasingHub 系统</div></div>
</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  
  // 正常显示验证页面
  const districtsJson = await env.AGENT_PHONE_MAP.get('districts');
  let districts = ['Central', 'Sheung_Wan', 'Causeway_Bay', 'Tsimshatsui', 'Mongkok', 'Kwun_Tong', 'Kowloon_Bay'];
  if (districtsJson) {
    try { districts = JSON.parse(districtsJson); } catch (e) {}
  }
  
  const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>线索验证 - LeasingHub</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px}.container{max-width:600px;margin:0 auto;background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden}.header{background:linear-gradient(135deg,#da196e,#b9155e);color:white;padding:30px;text-align:center}.header h1{font-size:24px;margin-bottom:8px}.header p{opacity:0.9;font-size:14px}.content{padding:30px}.info-section{background:#f8f9fa;border-radius:12px;padding:20px;margin-bottom:24px}.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e9ecef}.info-row:last-child{border-bottom:none}.info-label{font-weight:600;color:#495057;width:120px}.info-value{color:#212529;flex:1;word-break:break-word}.status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}.status-pending{background:#ffc107;color:#856404}.form-group{margin-bottom:20px}.form-group label{display:block;font-weight:600;color:#495057;margin-bottom:8px}.form-group select{width:100%;padding:12px;border:1px solid #ced4da;border-radius:8px;font-size:16px;background:white}.button-group{display:flex;gap:16px;margin-top:24px}.btn{flex:1;padding:14px 20px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:transform 0.2s,opacity 0.2s}.btn:hover{transform:translateY(-2px);opacity:0.9}.btn-verify{background:#28a745;color:white}.btn-reject{background:#dc3545;color:white}.btn-cancel{background:#6c757d;color:white}.footer{background:#f8f9fa;padding:16px 30px;text-align:center;font-size:12px;color:#6c757d}.message{padding:12px 16px;border-radius:8px;margin-bottom:20px;display:none}.message.success{background:#d4edda;color:#155724;border:1px solid #c3e6cb}.message.error{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb}.value-display{background:#e9ecef;padding:12px;border-radius:8px;margin-top:16px;text-align:center;font-size:18px;font-weight:bold;color:#da196e}@media (max-width:480px){.info-row{flex-direction:column}.info-label{width:100%;margin-bottom:4px}.button-group{flex-direction:column}}</style>
</head>
<body><div class="container"><div class="header"><h1>🔍 线索验证</h1><p id="headerSubtitle">${isRecoveryMode ? '⚠️ 此线索曾被标记为垃圾，请重新确认客户需求' : '请确认客户咨询信息并设置价值'}</p></div>
<div class="content"><div id="message" class="message"></div>
<div class="info-section"><div class="info-row"><span class="info-label">线索ID：</span><span class="info-value">#${lead.id}</span></div>
<div class="info-row"><span class="info-label">客号：</span><span class="info-value">${escapeHtml(lead.client_id)}</span></div>
<div class="info-row"><span class="info-label">状态：</span><span class="info-value"><span class="status-badge status-pending">${isRecoveryMode ? '待重新确认' : '⏳ 待处理'}</span></span></div></div>
<form id="verifyForm"><input type="hidden" id="agentName" value="${escapeHtml(lead.agent_name) || 'unknown'}">
<div class="form-group"><label>📍 区域</label><select id="district">${districts.map(d => `<option value="${escapeHtml(d)}" ${lead.district === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select></div>
<div class="form-group"><label>📋 租 / 买</label><select id="type" onchange="updateBudgetOptions()"><option value="rent" ${lead.rent ? 'selected' : ''}>租用 (Rent)</option><option value="buy" ${lead.property_price ? 'selected' : ''}>购买 (Buy)</option></select></div>
<div class="form-group"><label>💰 预算范围</label><select id="budgetRange"></select></div>
<div id="valueDisplay" class="value-display">预计价值: 计算中...</div>
<div class="button-group"><button type="button" class="btn btn-verify" onclick="submitVerify()">✅ 确认有效</button>${!isRecoveryMode ? '<button type="button" class="btn btn-reject" onclick="submitReject()">❌ 确认垃圾</button>' : ''}</div></form></div>
<div class="footer">此线索来自 LeasingHub 系统</div></div>
<script>
  const leadId = ${lead.id};
  const originalRent = ${lead.rent ? parseFloat(lead.rent.replace(/,/g, '')) : 0};
  const originalPrice = ${lead.property_price ? parseFloat(lead.property_price.replace(/,/g, '')) : 0};
  const isRecoveryMode = ${isRecoveryMode};
  
  function getAgentName() {
    return document.getElementById('agentName').value;
  }
  
  const rentOptions = [
    { value: 'below_20k', label: 'Below 2萬', baseValue: 20000 },
    { value: '20k_50k', label: '2萬 - 5萬', baseValue: 35000 },
    { value: '50k_80k', label: '5萬 - 8萬', baseValue: 65000 },
    { value: '80k_120k', label: '8萬 - 12萬', baseValue: 100000 },
    { value: '120k_160k', label: '12萬 - 16萬', baseValue: 140000 },
    { value: 'above_160k', label: 'Above 16萬', baseValue: 200000 }
  ];
  
  const buyOptions = [
    { value: 'below_8m', label: 'Below 800萬', baseValue: 8000000 },
    { value: '8m_15m', label: '800萬 - 1500萬', baseValue: 11500000 },
    { value: '15m_20m', label: '1500萬 - 2000萬', baseValue: 17500000 },
    { value: '20m_50m', label: '2000萬 - 5000萬', baseValue: 35000000 },
    { value: 'above_50m', label: 'Above 5000萬', baseValue: 50000000 }
  ];
  
  function updateBudgetOptions() {
    const type = document.getElementById('type').value;
    const select = document.getElementById('budgetRange');
    const options = type === 'rent' ? rentOptions : buyOptions;
    
    select.innerHTML = '';
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    
    // 切换后重新设置默认值
    setDefaultBudgetRange();
  }
  
  function calculateValue() {
    const type = document.getElementById('type').value;
    const range = document.getElementById('budgetRange').value;
    let value = 0;
    if (type === 'rent') {
      switch(range) {
        case 'below_20k': value = 2000; break;
        case '20k_50k': value = Math.round(35000 * 0.3); break;
        case '50k_80k': value = Math.round(65000 * 0.3); break;
        case '80k_120k': value = Math.round(100000 * 0.3); break;
        case '120k_160k': value = Math.round(140000 * 0.3); break;
        case 'above_160k': value = Math.round(200000 * 0.3); break;
        default: value = Math.round((originalRent || 35000) * 0.3);
      }
    } else {
      switch(range) {
        case 'below_8m': value = 2000; break;
        case '8m_15m': value = Math.round(11500000 * 0.003); break;
        case '15m_20m': value = Math.round(17500000 * 0.003); break;
        case '20m_50m': value = Math.round(35000000 * 0.003); break;
        case 'above_50m': value = Math.round(50000000 * 0.003); break;
        default: value = Math.round((originalPrice || 11500000) * 0.003);
      }
    }
    document.getElementById('valueDisplay').innerHTML = '💰 预计价值: HK$ ' + value.toLocaleString();
    return value;
  }
  
  function setDefaultBudgetRange() {
    const type = document.getElementById('type').value;
    const select = document.getElementById('budgetRange');
    
    if (type === 'rent' && originalRent > 0) {
      const monthlyRent = originalRent;
      var defaultRange = null;
      
      if (monthlyRent < 20000) {
        defaultRange = 'below_20k';
      } else if (monthlyRent >= 20000 && monthlyRent < 50000) {
        defaultRange = '20k_50k';
      } else if (monthlyRent >= 50000 && monthlyRent < 80000) {
        defaultRange = '50k_80k';
      } else if (monthlyRent >= 80000 && monthlyRent < 120000) {
        defaultRange = '80k_120k';
      } else if (monthlyRent >= 120000 && monthlyRent < 160000) {
        defaultRange = '120k_160k';
      } else if (monthlyRent >= 160000) {
        defaultRange = 'above_160k';
      }
      
      if (defaultRange) {
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === defaultRange) {
            select.selectedIndex = i;
            break;
          }
        }
      }
    } else if (type === 'buy' && originalPrice > 0) {
      const salePrice = originalPrice;
      var defaultRange = null;
      
      if (salePrice < 8000000) {
        defaultRange = 'below_8m';
      } else if (salePrice >= 8000000 && salePrice < 15000000) {
        defaultRange = '8m_15m';
      } else if (salePrice >= 15000000 && salePrice < 20000000) {
        defaultRange = '15m_20m';
      } else if (salePrice >= 20000000 && salePrice < 50000000) {
        defaultRange = '20m_50m';
      } else if (salePrice >= 50000000) {
        defaultRange = 'above_50m';
      }
      
      if (defaultRange) {
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === defaultRange) {
            select.selectedIndex = i;
            break;
          }
        }
      }
    }
    
    calculateValue();
  }
  
  document.addEventListener('DOMContentLoaded', function() { 
    updateBudgetOptions();
    setDefaultBudgetRange();
    document.getElementById('budgetRange').addEventListener('change', calculateValue);
  });

async function submitVerify() {
  const statusType = isRecoveryMode ? 'reinstated' : 'verified';
  const district = document.getElementById('district').value;
  const type = document.getElementById('type').value;
  const budgetRange = document.getElementById('budgetRange').value;
  const value = calculateValue();
  const agentName = getAgentName();
  const messageDiv = document.getElementById('message');
  const submitBtn = event.target;
  const form = document.getElementById('verifyForm');
  const header = document.getElementById('pageHeader');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const infoSection = document.querySelector('.info-section');
  
  submitBtn.disabled = true;
  submitBtn.textContent = '处理中...';
  
  // 先改变样式（无论成功失败，都表示已处理）
  if (header) {
    header.style.background = 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)';
  }
  if (headerSubtitle) headerSubtitle.style.display = 'none';
  if (infoSection) infoSection.style.display = 'none';

  try {
    const response = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: leadId,
        status: statusType,
        district: district,
        transaction_type: type,
        budget_range: budgetRange,
        value: value,
        verified_by: agentName
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // 隐藏表单
      if (form) form.style.display = 'none';
      // 显示成功消息
      messageDiv.className = 'message success';
      messageDiv.style.display = 'block';
      messageDiv.innerHTML = '<strong>✅ 确认成功！</strong><br>价值已记录。<br>请手动关闭此页面。';
      
      // 使用 replace 替换当前历史记录，防止后退到已处理的页面
      window.history.replaceState(null, '', window.location.pathname + '?id=' + leadId + '&processed=1');
    } else {
      throw new Error(result.error || '操作失败');
    }
  } catch (error) {
    messageDiv.className = 'message error';
    messageDiv.style.display = 'block';
    messageDiv.innerText = '操作失败：' + error.message;
    submitBtn.disabled = false;
    submitBtn.textContent = '✅ 确认有效';
    // 如果失败，恢复头部颜色
    if (header) {
      header.style.background = 'linear-gradient(135deg, #da196e, #b9155e)';
    }
    if (headerSubtitle) headerSubtitle.style.display = 'block';
    if (infoSection) infoSection.style.display = 'block';
  }
}

async function submitReject() {
  if (isRecoveryMode) return;
  const agentName = getAgentName();
  const messageDiv = document.getElementById('message');
  const submitBtn = event.target;
  const form = document.getElementById('verifyForm');
  const header = document.getElementById('pageHeader');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const infoSection = document.querySelector('.info-section');
  
  submitBtn.disabled = true;
  submitBtn.textContent = '处理中...';
  
  // 先改变样式
  if (header) {
    header.style.background = 'linear-gradient(135deg, #dc3545 0%, #b91a2a 100%)';
  }
  if (headerSubtitle) headerSubtitle.style.display = 'none';
  if (infoSection) infoSection.style.display = 'none';
  
  try {
    const response = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: leadId,
        status: 'rejected',
        value: 0,
        budget_range: '0',
        verified_by: agentName
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      if (form) form.style.display = 'none';
      messageDiv.className = 'message success';
      messageDiv.style.display = 'block';
      messageDiv.innerHTML = '<strong>❌ 已标记为垃圾线索</strong><br>请手动关闭此页面。';
    } else {
      throw new Error(result.error || '操作失败');
    }
  } catch (error) {
    messageDiv.className = 'message error';
    messageDiv.style.display = 'block';
    messageDiv.innerText = '操作失败：' + error.message;
    submitBtn.disabled = false;
    submitBtn.textContent = '❌ 确认垃圾';
    // 如果失败，恢复头部颜色
    if (header) {
      header.style.background = 'linear-gradient(135deg, #da196e, #b9155e)';
    }
    if (headerSubtitle) headerSubtitle.style.display = 'block';
    if (infoSection) infoSection.style.display = 'block';
  }
}

function cancelAction() {
  const form = document.getElementById('verifyForm');
  const messageDiv = document.getElementById('message');
  const header = document.getElementById('pageHeader');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const infoSection = document.querySelector('.info-section');
  
  if (form) form.style.display = 'none';
  if (infoSection) infoSection.style.display = 'none';
  if (headerSubtitle) headerSubtitle.style.display = 'none';
  if (header) {
    header.style.background = 'linear-gradient(135deg, #6c757d 0%, #545b62 100%)';
  }
  messageDiv.style.display = 'block';
  messageDiv.style.background = '#e9ecef';
  messageDiv.style.color = '#6c757d';
  messageDiv.style.border = '1px solid #ced4da';
  messageDiv.innerHTML = '<strong>已取消</strong><br>请手动关闭此页面。';
}

  window.updateBudgetOptions = updateBudgetOptions;
  window.calculateValue = calculateValue;
  window.submitVerify = submitVerify;
  window.submitReject = submitReject;
  window.cancelAction = cancelAction;
</script>
</body>
</html>`;
  
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ============================================
// 处理验证操作
// ============================================

async function handleVerifyAction(request, env) {
  try {
    const { id, status, district, transaction_type, budget_range, value, verified_by } = await request.json();
    
    if (!id || (!['verified', 'rejected', 'reinstated'].includes(status))) {
      return new Response(JSON.stringify({ error: '参数错误' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const now = new Date().toISOString();
    const verifiedBy = verified_by || 'system';
    
    let result;
    
    if (status === 'verified') {
      result = await env.lead_db.prepare(`
        UPDATE leads 
        SET status = ?, verified_at = ?, verified_by = ?,
            district = ?, transaction_type = ?, budget_range = ?, value = ?
        WHERE id = ?
      `).bind(status, now, verifiedBy, district, transaction_type, budget_range, value, id).run();
      
    } else if (status === 'rejected') {
      result = await env.lead_db.prepare(`
        UPDATE leads 
        SET status = ?, verified_at = ?, verified_by = ?, value = ?, budget_range = ?
        WHERE id = ?
      `).bind(status, now, verifiedBy, 0, '0', id).run();
      
    } else {
      result = await env.lead_db.prepare(`
        UPDATE leads 
        SET status = 'verified', verified_at = ?, verified_by = ?,
            district = ?, transaction_type = ?, budget_range = ?, value = ?
        WHERE id = ?
      `).bind(now, verifiedBy, district, transaction_type, budget_range, value, id).run();
    }
    
    if (result.meta.rows_written === 0) {
      return new Response(JSON.stringify({ error: '线索不存在' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Verify action error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// HTML 转义函数
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ============================================
// 管理后台 - 登录验证
// ============================================
async function handleAdminLogin(request, env) {
  try {
    const { phone, password } = await request.json();
    
    // 从 KV 读取管理员密码
    let adminPassword = null;
    try {
      adminPassword = await env.AGENT_PHONE_MAP.get('admin_password');
    } catch (e) {}
    
    if (!adminPassword) {
      return new Response(JSON.stringify({ success: false, error: '系统配置错误：未设置管理员密码' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (password !== adminPassword) {
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 从 KV 读取管理员列表
    let adminPhones = [];
    try {
      const adminsJson = await env.AGENT_PHONE_MAP.get('admins');
      if (adminsJson) {
        adminPhones = JSON.parse(adminsJson);
      }
    } catch (e) {}
    
    if (!adminPhones.includes(phone)) {
      return new Response(JSON.stringify({ success: false, error: '手机号不在管理员列表中' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const token = btoa(`${phone}:${Date.now()}`);
    
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
// 管理后台 - 获取统计数据
// ============================================

async function handleAdminGetStats(env) {
  try {
    const statusStmt = await env.lead_db.prepare(`
      SELECT status, COUNT(*) as count FROM leads GROUP BY status
    `).all();
    
    const statusCounts = {};
    for (const row of statusStmt.results) {
      statusCounts[row.status] = row.count;
    }
    
    const today = new Date().toISOString().slice(0, 10);
    const todayStmt = await env.lead_db.prepare(`
      SELECT COUNT(*) as count FROM leads WHERE date(created_at) = date(?)
    `).bind(today).first();
    
    const totalStmt = await env.lead_db.prepare(`SELECT COUNT(*) as count FROM leads`).first();
    
    return new Response(JSON.stringify({
      success: true,
      stats: {
        pending: statusCounts.pending || 0,
        verified: statusCounts.verified || 0,
        rejected: statusCounts.rejected || 0,
        total: totalStmt.count || 0,
        today: todayStmt.count || 0
      }
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

// ============================================
// 管理后台 - 获取线索列表
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
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    const countStmt = await env.lead_db.prepare(`SELECT COUNT(*) as total FROM leads ${whereClause}`);
    const countResult = await countStmt.bind(...params).first();
    const total = countResult.total;
    
    const dataStmt = await env.lead_db.prepare(`
      SELECT id, client_id, agent_name, agent_phone, click_type,
        rent, property_price, size, district, property_type,
        landing_page, page_location, page_referrer,
        utm_source, utm_medium, utm_campaign, gclid,
        traffic_type, traffic_source,
        value, status, verified_by, created_at, verified_at
      FROM leads ${whereClause}
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
    
    return new Response(JSON.stringify({
      success: true,
      data: dataResult.results,
      pagination: { page: page, limit: limit, total: total, totalPages: Math.ceil(total / limit) },
      filters: {
        agents: agentsStmt.results.map(r => r.agent_name),
        trafficTypes: trafficStmt.results.map(r => r.traffic_type)
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Get leads error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// 管理后台 - 批量更新线索
// ============================================

async function handleAdminBatchUpdate(request, env) {
  try {
    const { leads, action, value } = await request.json();
    
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return new Response(JSON.stringify({ success: false, error: '没有选择线索' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const now = new Date().toISOString();
    const results = [];
    
    for (const lead of leads) {
      try {
        let updateStmt, params;
        
        if (action === 'verify') {
          updateStmt = await env.lead_db.prepare(`
            UPDATE leads SET status = 'verified', verified_at = ?, verified_by = ?, value = ?
            WHERE id = ? AND status != 'verified'
          `);
          params = [now, 'admin_batch', value || 2000, lead.id];
        } else if (action === 'reject') {
          updateStmt = await env.lead_db.prepare(`
            UPDATE leads SET status = 'rejected', verified_at = ?, verified_by = ?, value = 0
            WHERE id = ? AND status != 'verified'
          `);
          params = [now, 'admin_batch', lead.id];
        } else {
          continue;
        }
        
        const result = await updateStmt.bind(...params).run();
        results.push({ id: lead.id, success: result.meta.rows_written > 0 });
        
      } catch (err) {
        results.push({ id: lead.id, success: false, error: err.message });
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      results: results,
      summary: {
        total: leads.length,
        success: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Batch update error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// 管理后台 - 导出 CSV
// ============================================

async function handleAdminExport(request, env) {
  try {
    const url = new URL(request.url);
    
    const status = url.searchParams.get('status') || '';
    const agent = url.searchParams.get('agent') || '';
    const dateFrom = url.searchParams.get('date_from') || '';
    const dateTo = url.searchParams.get('date_to') || '';
    
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
    if (dateFrom) {
      whereConditions.push('date(created_at) >= date(?)');
      params.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push('date(created_at) <= date(?)');
      params.push(dateTo);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    const stmt = await env.lead_db.prepare(`
      SELECT id, client_id, agent_name, click_type, rent, district, property_type,
        utm_source, utm_medium, utm_campaign, gclid, traffic_type,
        value, status, verified_by, created_at, verified_at
      FROM leads ${whereClause}
      ORDER BY id DESC
    `);
    
    const result = await stmt.bind(...params).all();
    const leads = result.results;
    
    const headers = ['ID', '客户号', '代理', '点击类型', '租金', '区域', '物业类型',
      'UTM来源', 'UTM媒介', 'UTM活动', 'GCLID', '流量类型', '价值', '状态', '处理人', '创建时间', '处理时间'];
    
    const csvRows = [headers.join(',')];
    
    for (const lead of leads) {
      const row = [
        lead.id,
        `"${lead.client_id || ''}"`,
        `"${lead.agent_name || ''}"`,
        `"${lead.click_type || ''}"`,
        `"${lead.rent || ''}"`,
        `"${lead.district || ''}"`,
        `"${lead.property_type || ''}"`,
        `"${lead.utm_source || ''}"`,
        `"${lead.utm_medium || ''}"`,
        `"${lead.utm_campaign || ''}"`,
        `"${lead.gclid || ''}"`,
        `"${lead.traffic_type || ''}"`,
        lead.value || 0,
        lead.status || '',
        `"${lead.verified_by || ''}"`,
        lead.created_at || '',
        lead.verified_at || ''
      ];
      csvRows.push(row.join(','));
    }
    
    const csvContent = csvRows.join('\n');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads_export_${timestamp}.csv"`
      }
    });
    
  } catch (error) {
    console.error('Export error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// 管理后台 - HTML 页面
// ============================================
async function handleAdminPage(env) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LeasingHub 管理后台</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f2f5; }
    .login-box { max-width: 400px; margin: 100px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .login-box input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
    .login-box button { width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .error { color: red; margin-top: 10px; display: none; }
    .admin-box { display: none; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #f5f5f5; cursor: pointer; }
    .status-pending { color: orange; }
    .status-verified { color: green; }
    .status-rejected { color: red; }
    .filters { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
    .filters select, .filters input { padding: 8px; }
    .btn { padding: 8px 16px; cursor: pointer; }
    .btn-success { background: #28a745; color: white; border: none; }
    .btn-danger { background: #dc3545; color: white; border: none; }
    .pagination { margin-top: 20px; text-align: center; }
    .pagination button { margin: 0 5px; padding: 5px 10px; }
    .sidebar { position: fixed; left: 0; top: 0; width: 200px; height: 100%; background: #1a1a2e; color: white; padding: 20px; }
    .main-content { margin-left: 220px; }
    .stat-card { background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: inline-block; width: 150px; margin-right: 15px; text-align: center; }
  </style>
</head>
<body>
<div id="app"></div>

<script>
var token = localStorage.getItem('admin_token');

function render() {
  if (token) {
    showAdmin();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('app').innerHTML = '<div class="login-box"><h2>LeasingHub 管理后台</h2><input type="text" id="phone" placeholder="手机号"><input type="password" id="password" placeholder="密码"><button onclick="login()">登录</button><div id="loginError" class="error"></div></div>';
}

function showAdmin() {
  document.getElementById('app').innerHTML = '<div class="sidebar"><h3>LeasingHub</h3><button onclick="logout()" style="margin-top:20px">退出登录</button></div><div class="main-content"><div id="stats"></div><div class="filters" id="filters"></div><div><button class="btn btn-success" onclick="batchVerify()">批量确认有效</button> <button class="btn btn-danger" onclick="batchReject()">批量标记垃圾</button> <span id="selectedCount" style="margin-left:20px"></span></div><div id="table"></div><div id="pagination" class="pagination"></div></div>';
  loadStats();
  loadFilters();
  loadLeads();
}

window.login = function() {
  var phone = document.getElementById('phone').value;
  var password = document.getElementById('password').value;
  fetch('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone, password: password })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      token = data.token;
      localStorage.setItem('admin_token', token);
      showAdmin();
    } else {
      var err = document.getElementById('loginError');
      err.textContent = data.error || '登录失败';
      err.style.display = 'block';
    }
  });
};

window.logout = function() {
  localStorage.removeItem('admin_token');
  token = null;
  showLogin();
};

function loadStats() {
  fetch('/admin/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        var html = '';
        html += '<div class="stat-card"><h3>待处理</h3><div>' + (data.stats.pending || 0) + '</div></div>';
        html += '<div class="stat-card"><h3>已验证</h3><div>' + (data.stats.verified || 0) + '</div></div>';
        html += '<div class="stat-card"><h3>已拒绝</h3><div>' + (data.stats.rejected || 0) + '</div></div>';
        html += '<div class="stat-card"><h3>总计</h3><div>' + (data.stats.total || 0) + '</div></div>';
        document.getElementById('stats').innerHTML = html;
      }
    });
}

function loadFilters() {
  fetch('/admin/api/leads?limit=1')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success && data.filters) {
        var html = '<select id="filterStatus"><option value="">全部状态</option><option value="pending">待处理</option><option value="verified">已验证</option><option value="rejected">已拒绝</option></select>';
        html += '<select id="filterAgent"><option value="">全部代理</option>';
        for (var i = 0; i < data.filters.agents.length; i++) {
          html += '<option value="' + data.filters.agents[i] + '">' + data.filters.agents[i] + '</option>';
        }
        html += '</select>';
        html += '<select id="filterTraffic"><option value="">全部来源</option>';
        for (var j = 0; j < data.filters.trafficTypes.length; j++) {
          html += '<option value="' + data.filters.trafficTypes[j] + '">' + data.filters.trafficTypes[j] + '</option>';
        }
        html += '</select>';
        html += '<input type="date" id="filterDateFrom" placeholder="开始日期">';
        html += '<input type="date" id="filterDateTo" placeholder="结束日期">';
        html += '<input type="text" id="filterSearch" placeholder="搜索">';
        html += '<button onclick="applyFilters()">搜索</button>';
        html += '<button onclick="resetFilters()">重置</button>';
        document.getElementById('filters').innerHTML = html;
      }
    });
}

var currentPage = 1;
var currentFilters = {};
var selectedLeads = new Set();

window.applyFilters = function() {
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
};

window.resetFilters = function() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterAgent').value = '';
  document.getElementById('filterTraffic').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('filterSearch').value = '';
  applyFilters();
};

function loadLeads() {
  var url = '/admin/api/leads?page=' + currentPage + '&limit=20';
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
        renderTable(data.data);
        renderPagination(data.pagination);
      }
    });
}

function renderTable(leads) {
  if (!leads || leads.length === 0) {
    document.getElementById('table').innerHTML = '<p>暂无数据</p>';
    return;
  }
  var html = '<table><thead><tr><th><input type="checkbox" id="selectAll"></th><th>ID</th><th>客户号</th><th>代理</th><th>区域</th><th>租金</th><th>来源</th><th>状态</th><th>价值</th><th>时间</th><th>操作</th></tr></thead><tbody>';
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    var checked = selectedLeads.has(lead.id) ? 'checked' : '';
    html += '<tr>';
    html += '<td><input type="checkbox" class="lead-cb" data-id="' + lead.id + '" ' + checked + '></td>';
    html += '<td>' + lead.id + '</td>';
    html += '<td>' + (lead.client_id || '-') + '</td>';
    html += '<td>' + (lead.agent_name || '-') + '</td>';
    html += '<td>' + (lead.district || '-') + '</td>';
    html += '<td>' + (lead.rent || '-') + '</td>';
    html += '<td>' + (lead.traffic_type || '-') + '</td>';
    html += '<td class="status-' + lead.status + '">' + (lead.status === 'pending' ? '待处理' : (lead.status === 'verified' ? '已验证' : '已拒绝')) + '</td>';
    html += '<td><input type="number" id="val_' + lead.id + '" value="' + (lead.value || 0) + '" style="width:80px"></td>';
    html += '<td>' + new Date(lead.created_at).toLocaleString() + '</td>';
    html += '<td><button onclick="updateLead(' + lead.id + ', true)">确认</button></td>';
    html += '</tr>';
  }
  html += '</tbody></td>';
  document.getElementById('table').innerHTML = html;
  
  // 绑定复选框事件
  var cbs = document.querySelectorAll('.lead-cb');
  for (var j = 0; j < cbs.length; j++) {
    cbs[j].addEventListener('change', function(e) {
      var id = parseInt(e.target.getAttribute('data-id'));
      if (e.target.checked) {
        selectedLeads.add(id);
      } else {
        selectedLeads.delete(id);
      }
      document.getElementById('selectedCount').innerHTML = '已选择 ' + selectedLeads.size + ' 条';
    });
  }
  document.getElementById('selectAll').addEventListener('change', function(e) {
    var allCbs = document.querySelectorAll('.lead-cb');
    for (var k = 0; k < allCbs.length; k++) {
      allCbs[k].checked = e.target.checked;
      var cid = parseInt(allCbs[k].getAttribute('data-id'));
      if (e.target.checked) {
        selectedLeads.add(cid);
      } else {
        selectedLeads.delete(cid);
      }
    }
    document.getElementById('selectedCount').innerHTML = '已选择 ' + selectedLeads.size + ' 条';
  });
  document.getElementById('selectedCount').innerHTML = '已选择 ' + selectedLeads.size + ' 条';
}

function renderPagination(pagination) {
  if (!pagination || pagination.totalPages <= 1) {
    document.getElementById('pagination').innerHTML = '';
    return;
  }
  var html = '<button onclick="goToPage(1)" ' + (currentPage === 1 ? 'disabled' : '') + '>首页</button>';
  html += '<button onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + '>上一页</button>';
  for (var i = Math.max(1, currentPage - 2); i <= Math.min(pagination.totalPages, currentPage + 2); i++) {
    html += '<button onclick="goToPage(' + i + ')" ' + (i === currentPage ? 'style="background:#667eea;color:white"' : '') + '>' + i + '</button>';
  }
  html += '<button onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === pagination.totalPages ? 'disabled' : '') + '>下一页</button>';
  html += '<button onclick="goToPage(' + pagination.totalPages + ')" ' + (currentPage === pagination.totalPages ? 'disabled' : '') + '>末页</button>';
  document.getElementById('pagination').innerHTML = html;
}

window.goToPage = function(page) {
  currentPage = page;
  loadLeads();
};

window.updateLead = function(id, isVerify) {
  var value = document.getElementById('val_' + id).value;
  var action = isVerify ? 'verify' : 'reject';
  var val = isVerify ? parseInt(value) : 0;
  if (confirm('确定要将线索 #' + id + ' 标记为' + (isVerify ? '有效' : '垃圾') + '吗？')) {
    fetch('/admin/api/leads/batch-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: [{ id: id }], action: action, value: val })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        loadLeads();
        loadStats();
      } else {
        alert('操作失败');
      }
    });
  }
};

window.batchVerify = function() {
  if (selectedLeads.size === 0) { alert('请先选择线索'); return; }
  var val = prompt('请输入价值（默认2000）', '2000');
  if (val === null) return;
  var leads = [];
  selectedLeads.forEach(function(id) { leads.push({ id: id }); });
  fetch('/admin/api/leads/batch-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: leads, action: 'verify', value: parseInt(val) || 2000 })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      selectedLeads.clear();
      loadLeads();
      loadStats();
    } else {
      alert('操作失败');
    }
  });
};

window.batchReject = function() {
  if (selectedLeads.size === 0) { alert('请先选择线索'); return; }
  var leads = [];
  selectedLeads.forEach(function(id) { leads.push({ id: id }); });
  fetch('/admin/api/leads/batch-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: leads, action: 'reject', value: 0 })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      selectedLeads.clear();
      loadLeads();
      loadStats();
    } else {
      alert('操作失败');
    }
  });
};

window.exportCSV = function() {
  var url = '/admin/api/export?';
  if (currentFilters.status) url += 'status=' + currentFilters.status + '&';
  if (currentFilters.agent) url += 'agent=' + currentFilters.agent + '&';
  window.open(url, '_blank');
};

render();
</script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}