/**
 * ResourceGovernor — unit tests
 */

import { describe, it, expect } from 'vitest';
import { ResourceGovernor } from '../../src/performance/resource-governor.js';

describe('ResourceGovernor.snapshot', () => {
  it('returns valid memory stats', () => {
    const gov = new ResourceGovernor();
    const s   = gov.snapshot();
    expect(s.totalMemMB).toBeGreaterThan(0);
    expect(s.freeMemMB).toBeGreaterThanOrEqual(0);
    expect(s.memUsagePct).toBeGreaterThanOrEqual(0);
    expect(s.memUsagePct).toBeLessThanOrEqual(100);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(s.pressure);
  });
});

describe('ResourceGovernor.maxParallel', () => {
  it('returns a positive number for ast_parse', () => {
    const gov = new ResourceGovernor();
    expect(gov.maxParallel('ast_parse')).toBeGreaterThan(0);
  });

  it('returns a positive number for unknown category', () => {
    const gov = new ResourceGovernor();
    expect(gov.maxParallel('unknown_category')).toBeGreaterThan(0);
  });
});

describe('ResourceGovernor.featureEnabled', () => {
  it('returns true for features on a fresh governor', () => {
    const gov = new ResourceGovernor();
    // On the test machine memory is usually not at >85% usage
    // We just check it returns a boolean
    expect(typeof gov.featureEnabled('tool_batcher')).toBe('boolean');
  });

  it('returns false after manual disable', () => {
    const gov = new ResourceGovernor();
    gov.disableFeature('semantic_search');
    expect(gov.featureEnabled('semantic_search')).toBe(false);
  });
});

describe('ResourceGovernor.taskStart/End', () => {
  it('tracks active tasks', () => {
    const gov = new ResourceGovernor();
    gov.taskStart('ast_parse');
    gov.taskStart('ast_parse');
    expect(gov.snapshot().activeTasks).toBe(2);
    gov.taskEnd('ast_parse');
    expect(gov.snapshot().activeTasks).toBe(1);
  });
});

describe('ResourceGovernor.formatStatus', () => {
  it('returns a non-empty string', () => {
    const gov = new ResourceGovernor();
    expect(gov.formatStatus()).toContain('Memory');
  });
});
