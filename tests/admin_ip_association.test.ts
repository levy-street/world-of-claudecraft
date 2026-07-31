import { describe, expect, it } from 'vitest';
import { cleanIpAssociationLookup, UNKNOWN_IP_ASSOCIATION } from '../server/admin_ip_association';

describe('admin IP association lookup', () => {
  it('accepts canonical IP addresses and the exact stored unknown marker', () => {
    expect(cleanIpAssociationLookup(' ::ffff:203.0.113.7 ')).toBe('203.0.113.7');
    expect(cleanIpAssociationLookup(` ${UNKNOWN_IP_ASSOCIATION} `)).toBe('unknown');
  });

  it('rejects arbitrary non-IP metadata and marker variants', () => {
    expect(cleanIpAssociationLookup('not-an-ip')).toBe('');
    expect(cleanIpAssociationLookup('UNKNOWN')).toBe('');
    expect(cleanIpAssociationLookup('unknown:proxy')).toBe('');
    expect(cleanIpAssociationLookup('')).toBe('');
    expect(cleanIpAssociationLookup(null)).toBe('');
  });
});
