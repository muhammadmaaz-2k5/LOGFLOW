import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchesParsedQuery } from '../queryParser.js';

describe('parseSearchQuery', () => {
  it('parses level, service, and quoted phrase', () => {
    const parsed = parseSearchQuery('level:error service:auth "token expired"');
    expect(parsed.levels).toEqual(['error']);
    expect(parsed.services).toEqual(['auth']);
    expect(parsed.terms).toEqual(['token expired']);
  });

  it('supports comma-separated levels, services, trace_id, and bare keywords', () => {
    const parsed = parseSearchQuery('level:error,fatal service:payment-api,ledger trace:tr-9918 timeout 504');
    expect(parsed.levels).toEqual(['error', 'fatal']);
    expect(parsed.services).toEqual(['payment-api', 'ledger']);
    expect(parsed.traceIds).toEqual(['tr-9918']);
    expect(parsed.terms).toEqual(['timeout', '504']);
  });

  it('extracts custom metadata key:value pairs and ignores invalid levels', () => {
    const parsed = parseSearchQuery('level:invalid level:warn region:"us-east-1" env:prod');
    expect(parsed.levels).toEqual(['warn']);
    expect(parsed.metadataFilters).toEqual({
      region: 'us-east-1',
      env: 'prod'
    });
  });

  it('matches events accurately against parsed query', () => {
    const query = parseSearchQuery('level:error service:auth "token expired" env:prod');
    expect(
      matchesParsedQuery(
        {
          level: 'error',
          service: 'auth-service',
          message: 'JWT validation failed: token expired for user_id=42',
          metadata: { env: 'prod', user_id: 42 }
        },
        query
      )
    ).toBe(true);

    expect(
      matchesParsedQuery(
        {
          level: 'info',
          service: 'auth-service',
          message: 'JWT validation failed: token expired',
          metadata: { env: 'prod' }
        },
        query
      )
    ).toBe(false);
  });
});

