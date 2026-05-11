import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, routeBusiness } from '../server.js';

test('health endpoint returns service status', () => {
  const result = routeBusiness('GET', '/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('workspace exposes all six customer-service modules', () => {
  const result = routeBusiness('GET', '/api/workspace');
  assert.equal(result.status, 200);
  assert.equal(result.body.modules.length, 6);
  assert.ok(result.body.integrations.some((item) => item.id === 'gcp-speech'));
});

test('chatbot flags legal-risk complaint for handoff', () => {
  const result = routeBusiness('POST', '/api/chatbot/message', { message: 'จะฟ้อง สคบ. ถ้าไม่คืนเงินวันนี้' });
  assert.equal(result.status, 200);
  assert.equal(result.body.handoff, true);
  assert.equal(result.body.sentiment.label, 'negative');
});

test('ticket triage routes P1 complaint to supervisor queue', () => {
  const result = routeBusiness('POST', '/api/tickets/triage', { text: 'VIP บอกว่าจะฟ้องทนาย' });
  assert.equal(result.body.priority, 'P1');
  assert.match(result.body.routeTo, /Supervisor/);
});

test('call QA scores identity verification transcript', () => {
  const result = routeBusiness('POST', '/api/calls/qa', { transcript: 'สวัสดีค่ะ ยืนยันตัวตนแล้ว จะส่งเอกสารวันนี้' });
  assert.equal(result.body.compliance.identityVerification, true);
  assert.ok(result.body.qaScore >= 90);
});

test('HTTP server serves API responses', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/voc/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ comments: ['ส่งช้า', 'ตอบเร็ว'] })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.themes));
  await new Promise((resolve) => server.close(resolve));
});
