import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8');
const ownerMessages = readFileSync(new URL('../components/OwnerMessages.jsx', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../../../main.py', import.meta.url), 'utf8');

test('رسائل المستلم تُراقب خارج حاوية القائمة الجانبية وتُفتح من زرها بأحداث واضحة', () => {
  const globalMount = dashboard.indexOf('<OwnerMessages isOwner={isOwner} lang={language} />');
  const mainStart = dashboard.indexOf('<main id="main-scroll-container"');
  assert.ok(globalMount > mainStart);
  assert.match(dashboard, /eoc-open-owner-message-composer/);
  assert.match(ownerMessages, /eoc-open-owner-message-composer/);
});

test('نجاح الإرسال يغلق نافذة الإنشاء تلقائياً بعد تأكيد الخادم', () => {
  assert.match(ownerMessages, /setComposerOpen\(false\)/);
  assert.match(ownerMessages, /successfulSendTimer\.current = window\.setTimeout/);
  assert.match(ownerMessages, /Number\(result\.recipient_count\)/);
});

test('كل مستلم يحصل على حدث realtime موجّه ورسالة دائمة مرتبطة بهويته', () => {
  assert.match(backend, /INSERT INTO owner_message_recipients/);
  assert.match(backend, /INSERT INTO realtime_events/);
  assert.match(backend, /'owner_message'/);
  assert.match(backend, /e\.target_user_id = %s/);
});
