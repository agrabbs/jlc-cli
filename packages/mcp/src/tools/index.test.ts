import { describe, expect, it } from 'bun:test';

import { toolHandlers, tools } from './index.js';

describe('tools', () => {
  it('exposes a handler for every registered tool', () => {
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      expect(toolHandlers[tool.name]).toBeDefined();
    }
  });
});
