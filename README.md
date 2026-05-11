# AI Customer Service Agency Platform Demo

เว็บแอปตัวอย่างสำหรับโมเดล Agency/SaaS ที่ต่อยอดจากบริการ 1.1–1.6:

1. Multilingual Chatbot
2. Agent Assist
3. Ticket Triage
4. Call Summary & QA
5. Knowledge Base
6. Voice of Customer Analytics

## จุดประสงค์

โปรเจกต์นี้ออกแบบให้เห็นภาพระบบที่ใช้งานได้จริงแบบครบลูป แยกมุมมอง **Internal Agency** และ **Client Portal** พร้อม backend API จำลองสำหรับทดสอบ flow ก่อนต่อ LLM, LINE OA, CRM, Google Cloud หรือ agent ตัวอื่น

## Run locally

```bash
npm start
```

เปิดเว็บที่ <http://localhost:8080>

## Checks ก่อน push

```bash
npm run check
```

คำสั่งนี้ตรวจ syntax ของ backend และรัน automated tests ของ API หลัก

## Backend APIs

- `GET /api/health` — ตรวจสถานะ backend
- `GET /api/workspace` — โหลด dashboard, tenants, integrations, KB และ sample tickets
- `POST /api/chatbot/message` — โมดูล 1.1 chatbot
- `POST /api/agent-assist/suggest` — โมดูล 1.2 agent assist
- `POST /api/tickets/triage` — โมดูล 1.3 ticket triage
- `POST /api/calls/qa` — โมดูล 1.4 call QA
- `POST /api/knowledge-base/generate` — โมดูล 1.5 knowledge base
- `POST /api/voc/analyze` — โมดูล 1.6 voice of customer
- `POST /api/integrations/test` — ทดสอบแผนเชื่อม LINE, Google Cloud, CRM, BigQuery
- `POST /api/agents/orchestrate` — ตัวอย่าง route งานไป agent อื่น

## Architecture ที่แนะนำต่อ production

Frontend UI → Node.js API → LLM Gateway → PII/PDPA Redaction → Vector Search/KB → Google Cloud Speech/Storage/BigQuery → CRM/Helpdesk/LINE/Meta → Audit Log + Client Dashboard
