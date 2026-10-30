import { describe, it, expect } from 'vitest';
import {
  IngestEventSchema,
  IngestBatchSchema,
  CreateAlertRuleSchema,
  isSafeWebhookUrl
} from '../schemas.js';

describe('Ingest & Security validation schemas', () => {
  it('validates a well-formed ingestion batch', () => {
    const payload = [
      {
        id: 'evt_custom_01',
        timestamp: '2026-10-30T13:30:00.000Z',
        level: 'error',
        service: 'payment-api',
        message: 'Stripe webhook signature mismatch',
        metadata: { attempt: 2, region: 'us-east-1' },
        trace_id: 'tr-88219a'
      },
      {
        level: 'info',
        service: 'auth-service',
        message: 'Session created'
      }
    ];

    const res = IngestBatchSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it('rejects empty batch or invalid severity level', () => {
    expect(IngestBatchSchema.safeParse([]).success).toBe(false);

    const invalidLevel = IngestEventSchema.safeParse({
      level: 'critical',
      service: 'auth-service',
      message: 'Failed login'
    });
    expect(invalidLevel.success).toBe(false);
  });

  it('rejects invalid service characters or empty message', () => {
    const invalidService = IngestEventSchema.safeParse({
      level: 'warn',
      service: 'bad service with spaces!',
      message: 'Something happened'
    });
    expect(invalidService.success).toBe(false);

    const emptyMessage = IngestEventSchema.safeParse({
      level: 'info',
      service: 'api-gateway',
      message: ''
    });
    expect(emptyMessage.success).toBe(false);
  });

  it('blocks SSRF webhook URLs (localhost, 127.0.0.1, metadata 169.254.169.254, private IPs)', () => {
    expect(isSafeWebhookUrl('https://hooks.slack.com/services/T000/B000/X000')).toBe(true);
    expect(isSafeWebhookUrl('http://localhost:4000/internal')).toBe(false);
    expect(isSafeWebhookUrl('http://127.0.0.1:8080/admin')).toBe(false);
    expect(isSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeWebhookUrl('http://10.0.0.12/internal')).toBe(false);
    expect(isSafeWebhookUrl('http://192.168.1.1/router')).toBe(false);

    const badRule = CreateAlertRuleSchema.safeParse({
      name: 'SSRF Attempt',
      level: 'error',
      threshold_count: 5,
      window_minutes: 10,
      notify_webhook_url: 'http://127.0.0.1:4000/v1/internal'
    });
    expect(badRule.success).toBe(false);
  });
});
