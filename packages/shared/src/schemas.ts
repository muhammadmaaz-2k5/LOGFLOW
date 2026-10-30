import { z } from 'zod';

export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export const TeamRoleSchema = z.enum(['admin', 'member', 'viewer']);

/**
 * Validates that a webhook URL uses http/https and does not point to
 * loopback, link-local, cloud metadata, or private RFC1918 addresses (SSRF protection).
 */
export function isSafeWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    // Block IPv4 private / loopback / link-local ranges
    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4Match) {
      const [_, a, b] = ipv4Match.map(Number);
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const IngestEventSchema = z.object({
  id: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'id must be alphanumeric, dash, or underscore')
    .optional(),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .or(z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid ISO timestamp'))
    .optional(),
  level: LogLevelSchema,
  service: z
    .string()
    .min(1, 'service is required')
    .max(128, 'service name must be <= 128 chars')
    .regex(
      /^[a-zA-Z0-9._:-]+$/,
      'service must contain alphanumeric, dot, colon, underscore, or dash characters'
    ),
  message: z.string().min(1, 'message is required').max(32768, 'message exceeds max length'),
  metadata: z
    .record(z.string().max(64), z.unknown())
    .refine(
      (val) => JSON.stringify(val).length <= 16384,
      'metadata payload exceeds 16KB limit'
    )
    .optional(),
  trace_id: z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9._:-]+$/, 'trace_id contains invalid characters')
    .optional()
});

export const IngestBatchSchema = z
  .array(IngestEventSchema)
  .min(1, 'At least 1 log event is required')
  .max(1000, 'Maximum 1000 events per batch');

export const RegisterSchema = z.object({
  email: z.string().trim().email('Valid email is required').max(160),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be <= 128 characters'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80)
});

export const LoginSchema = z.object({
  email: z.string().trim().email('Valid email is required').max(160),
  password: z.string().min(1, 'Password is required').max(128)
});

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(80),
  retention_days: z.number().int().min(1).max(365).default(30)
});

export const UpdateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  retention_days: z.number().int().min(1).max(365).optional()
});

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(2, 'Key name is required').max(80),
  rate_limit_per_min: z.number().int().min(10).max(100000).default(5000)
});

export const CreateAlertRuleSchema = z.object({
  name: z.string().trim().min(2, 'Rule name is required').max(120),
  service: z.string().trim().max(128).nullable().optional(),
  level: LogLevelSchema.default('error'),
  query: z.string().trim().max(500).nullable().optional(),
  threshold_count: z.number().int().min(1).max(100000),
  window_minutes: z.number().int().min(1).max(1440),
  notify_email: z
    .string()
    .trim()
    .email()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  notify_webhook_url: z
    .string()
    .trim()
    .url()
    .refine(isSafeWebhookUrl, 'Webhook URL must be a public HTTP/HTTPS endpoint (no localhost or private IPs)')
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  enabled: z.boolean().default(true)
});

export const UpdateAlertRuleSchema = CreateAlertRuleSchema.partial();

export const InviteMemberSchema = z.object({
  email: z.string().trim().email().max(160),
  name: z.string().trim().min(2).max(80),
  role: TeamRoleSchema,
  password: z.string().min(8).max(128).optional()
});

export const UpdateMemberRoleSchema = z.object({
  role: TeamRoleSchema
});

export const LogQueryParamsSchema = z.object({
  projectId: z.string().trim().min(1).max(80),
  q: z.string().max(1000).optional(),
  level: z.string().max(100).optional(),
  service: z.string().max(256).optional(),
  traceId: z.string().max(128).optional(),
  from: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid from timestamp')
    .optional(),
  to: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid to timestamp')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
