import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = __dirname;

const integrations = [
  { id: 'line', name: 'LINE OA', status: 'ready', scope: 'client', latencyMs: 164, purpose: 'Multilingual chatbot + human handoff' },
  { id: 'meta', name: 'Meta Messenger / Instagram DM', status: 'planned', scope: 'client', latencyMs: 210, purpose: 'Omnichannel inbox' },
  { id: 'gcp-speech', name: 'Google Cloud Speech-to-Text', status: 'ready', scope: 'internal', latencyMs: 320, purpose: 'Call transcript for QA' },
  { id: 'gcp-storage', name: 'Google Cloud Storage', status: 'ready', scope: 'internal', latencyMs: 90, purpose: 'Call recordings and KB documents' },
  { id: 'bigquery', name: 'BigQuery / Looker Studio', status: 'planned', scope: 'internal', latencyMs: 180, purpose: 'VoC and executive analytics' },
  { id: 'crm', name: 'HubSpot / Salesforce / Zendesk', status: 'ready', scope: 'client', latencyMs: 260, purpose: 'Ticket sync and customer history' },
  { id: 'agent-network', name: 'Agent Orchestrator API', status: 'ready', scope: 'internal', latencyMs: 140, purpose: 'Route work to other AI agents' }
];

const knowledgeArticles = [
  { id: 'KB-001', title: 'นโยบายคืนสินค้าและคืนเงิน', tags: ['refund', 'policy'], freshness: 92 },
  { id: 'KB-002', title: 'ขั้นตอนเช็คสถานะคำสั่งซื้อ', tags: ['tracking', 'order'], freshness: 88 },
  { id: 'KB-003', title: 'SOP การ escalate เคสร้องเรียน', tags: ['complaint', 'legal'], freshness: 81 },
  { id: 'KB-004', title: 'แพ็กเกจบริการและ SLA', tags: ['sales', 'sla'], freshness: 76 }
];

const ticketSamples = [
  { id: 'TCK-1042', channel: 'LINE OA', text: 'ของยังไม่ถึง จะฟ้อง สคบ. ถ้าไม่ตอบวันนี้', customer: 'VIP: Siam Retail', sentiment: 'angry' },
  { id: 'TCK-1043', channel: 'Facebook', text: 'สอบถามราคาแพ็กเกจ Growth และเชื่อม HubSpot ได้ไหม', customer: 'Bangkok Clinic', sentiment: 'neutral' },
  { id: 'TCK-1044', channel: 'Email', text: 'ต้องการคืนเงิน order #A192 เพราะสินค้าเสียหาย', customer: 'K. Ploy', sentiment: 'negative' }
];

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function scoreSentiment(text = '') {
  const lowered = text.toLowerCase();
  if (/(ฟ้อง|สคบ|ทนาย|เสียหาย|ไม่พอใจ|angry|refund)/i.test(lowered)) return { label: 'negative', score: -0.72 };
  if (/(ขอบคุณ|ดีมาก|รวดเร็ว|สนใจ|ราคา|demo)/i.test(lowered)) return { label: 'positive', score: 0.68 };
  return { label: 'neutral', score: 0.08 };
}

function classifyTicket(text = '') {
  const lower = text.toLowerCase();
  if (/(คืนเงิน|refund|return|เสียหาย)/i.test(lower)) return 'Refund';
  if (/(ฟ้อง|สคบ|ทนาย|ร้องเรียน|complaint)/i.test(lower)) return 'Complaint';
  if (/(ราคา|แพ็กเกจ|package|demo|sales)/i.test(lower)) return 'Sales';
  if (/(ระบบ|error|เชื่อม|api|technical)/i.test(lower)) return 'Technical';
  return 'General Support';
}

function priorityFrom(text = '', sentiment = scoreSentiment(text)) {
  if (/(ฟ้อง|สคบ|ทนาย|vip|ด่วน)/i.test(text) || sentiment.score < -0.6) return 'P1';
  if (sentiment.score < -0.2 || /(คืนเงิน|เสียหาย|refund)/i.test(text)) return 'P2';
  return 'P3';
}

function buildChatbotReply(message = '') {
  const category = classifyTicket(message);
  if (category === 'Refund') {
    return 'รับทราบค่ะ/ครับ สามารถคืนสินค้าได้ภายใน 7 วันหลังรับสินค้า กรุณาส่งเลขคำสั่งซื้อและรูปสินค้า ทีมงานจะตรวจสอบและสร้าง ticket ให้ทันที';
  }
  if (category === 'Complaint') {
    return 'ขออภัยในความไม่สะดวกค่ะ/ครับ เคสนี้ถูกจัดเป็น Priority สูงและส่งต่อ Supervisor แล้ว กรุณาแจ้งเบอร์โทรหรือเลขคำสั่งซื้อเพื่อเร่งติดตาม';
  }
  if (category === 'Sales') {
    return 'แพ็กเกจ Growth รองรับ LINE, Facebook, Agent Assist, Ticket Triage และเชื่อม CRM ได้ ทีมงานสามารถนัด demo 30 นาทีให้ได้ค่ะ/ครับ';
  }
  return 'สวัสดีค่ะ/ครับ AI Support พร้อมช่วยเหลือ 24/7 กรุณาระบุคำถาม เลขคำสั่งซื้อ หรือเรื่องที่ต้องการให้ทีมงานติดตามได้เลย';
}

export function routeBusiness(method, pathname, body = {}) {
  if (method === 'GET' && pathname === '/api/health') {
    return { status: 200, body: { ok: true, service: 'AI Customer Service Agency Demo', version: '1.0.0' } };
  }
  if (method === 'GET' && pathname === '/api/workspace') {
    return {
      status: 200,
      body: {
        tenants: 12,
        activeConversations: 2847,
        automationRate: 67,
        avgResponseSeconds: 18,
        csat: 92,
        modules: ['Multilingual Chatbot', 'Agent Assist', 'Ticket Triage', 'Call QA', 'Knowledge Base', 'Voice of Customer'],
        integrations,
        knowledgeArticles,
        tickets: ticketSamples
      }
    };
  }
  if (method === 'POST' && pathname === '/api/chatbot/message') {
    const message = body.message || '';
    const sentiment = scoreSentiment(message);
    return { status: 200, body: { reply: buildChatbotReply(message), language: /[ก-๙]/.test(message) ? 'th' : 'en', sentiment, handoff: priorityFrom(message, sentiment) === 'P1' } };
  }
  if (method === 'POST' && pathname === '/api/agent-assist/suggest') {
    const message = body.message || 'ลูกค้าถามเรื่องคืนเงิน';
    const category = classifyTicket(message);
    return { status: 200, body: { category, suggestions: [buildChatbotReply(message), 'สรุปประวัติลูกค้า: เคยสั่งซื้อ 3 ครั้ง ไม่มีเคสค้าง', 'อ้างอิง KB: KB-001 นโยบายคืนสินค้าและคืนเงิน'], nextBestAction: priorityFrom(message) === 'P1' ? 'Escalate Supervisor' : 'Send suggested answer' } };
  }
  if (method === 'POST' && pathname === '/api/tickets/triage') {
    const text = body.text || ticketSamples[0].text;
    const sentiment = scoreSentiment(text);
    return { status: 200, body: { category: classifyTicket(text), priority: priorityFrom(text, sentiment), sentiment, routeTo: priorityFrom(text, sentiment) === 'P1' ? 'Supervisor / Legal Risk Queue' : 'Customer Service Queue', tags: ['auto-triage', classifyTicket(text).toLowerCase().replaceAll(' ', '-')] } };
  }
  if (method === 'POST' && pathname === '/api/calls/qa') {
    const transcript = body.transcript || 'สวัสดีค่ะ ยืนยันตัวตนแล้ว ลูกค้าขอคืนเงิน order A192 สรุปจะส่งเอกสารภายในวันนี้';
    return { status: 200, body: { summary: 'ลูกค้าต้องการคืนเงิน order A192 เนื่องจากสินค้าเสียหาย', actionItems: ['ส่งแบบฟอร์มคืนเงิน', 'ติดตามสถานะภายใน 24 ชั่วโมง'], qaScore: /ยืนยันตัวตน/.test(transcript) ? 94 : 78, compliance: { greeting: /สวัสดี/.test(transcript), identityVerification: /ยืนยันตัวตน/.test(transcript), closing: /ขอบคุณ|วันนี้/.test(transcript) }, coaching: 'เพิ่มการทวน SLA ตอนปิดสายเพื่อให้ลูกค้าชัดเจนขึ้น' } };
  }
  if (method === 'POST' && pathname === '/api/knowledge-base/generate') {
    const source = body.source || 'ticket เดือนนี้ถามเรื่องคืนสินค้าและ tracking เยอะที่สุด';
    return { status: 200, body: { article: { title: 'FAQ: การคืนสินค้าและตรวจสอบสถานะ', summary: source, sections: ['เงื่อนไขคืนสินค้า', 'เอกสารที่ต้องใช้', 'ระยะเวลาคืนเงิน', 'ช่องทางติดตามสถานะ'], staleRisks: ['ตรวจสอบ SLA คืนเงินล่าสุดกับทีม Operations'] }, macros: ['ขอเลขคำสั่งซื้อเพื่อเช็คสถานะ', 'ขอรูปสินค้าและใบเสร็จสำหรับการเคลม'] } };
  }
  if (method === 'POST' && pathname === '/api/voc/analyze') {
    const comments = body.comments || ['แอดมินตอบเร็ว', 'ของส่งช้า', 'คืนเงินยุ่งยาก'];
    return { status: 200, body: { themes: [{ name: 'Response Speed', sentiment: 0.74, count: 42 }, { name: 'Delivery Delay', sentiment: -0.51, count: 28 }, { name: 'Refund Friction', sentiment: -0.66, count: 19 }], executiveSummary: 'ลูกค้าชมความเร็วของแอดมิน แต่มีสัญญาณ churn จากการส่งช้าและขั้นตอนคืนเงิน ควรปรับ SOP และเพิ่ม proactive notification', sourceCount: comments.length } };
  }
  if (method === 'POST' && pathname === '/api/integrations/test') {
    const id = body.id || 'line';
    const item = integrations.find((integration) => integration.id === id) || integrations[0];
    return { status: 200, body: { ...item, connected: item.status === 'ready', checkedAt: new Date().toISOString() } };
  }
  if (method === 'POST' && pathname === '/api/agents/orchestrate') {
    const task = body.task || 'สรุปเคสร้องเรียนและสร้าง ticket';
    return { status: 200, body: { task, route: ['PII Redaction Agent', 'Knowledge Retrieval Agent', 'Response Draft Agent', 'Supervisor Escalation Agent'], mode: body.scope === 'client' ? 'Client-facing approval required' : 'Internal automation approved' } };
  }
  return { status: 404, body: { error: 'Not found' } };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = join(PUBLIC_DIR, safePath);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

export function createAppServer() {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readJson(req) : {};
      const result = routeBusiness(req.method, url.pathname, body);
      json(res, result.status, result.body);
      return;
    }
    await serveStatic(req, res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(PORT, () => {
    console.log(`AI Customer Service Agency Demo running at http://localhost:${PORT}`);
  });
}
