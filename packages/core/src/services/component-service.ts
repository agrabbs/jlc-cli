/**
 * Component Service
 * High-level API for searching and fetching components
 */

import type { ComponentSearchResult, EasyEDAComponentData, EasyEDACommunityComponent } from '../types/index.js';
import { jlcClient } from '../api/jlc.js';
import { easyedaClient } from '../api/easyeda.js';
import { easyedaCommunityClient } from '../api/easyeda-community.js';
import { isLcscId, isEasyEDAUuid } from '../utils/index.js';

export interface SearchOptions {
  limit?: number;
  inStock?: boolean;
  basicOnly?: boolean;
  source?: 'lcsc' | 'community' | 'easyeda-community' | 'all';
}

export interface ComponentDetails {
  lcscId: string;
  name: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  pinCount: number;
  padCount: number;
  has3DModel: boolean;
  datasheet?: string;
}

export interface ComponentService {
  search(query: string, options?: SearchOptions): Promise<ComponentSearchResult[]>;
  fetch(id: string): Promise<EasyEDAComponentData | null>;
  fetchCommunity(uuid: string): Promise<EasyEDACommunityComponent | null>;
  getDetails(lcscId: string): Promise<ComponentDetails>;
}

/**
 * Validates a component ID (LCSC or EasyEDA UUID)
 */
function validateComponentId(id: string): void {
  if (!id || id.trim() === '') {
    throw new Error('Component ID cannot be empty');
  }

  if (id.includes('\0')) {
    throw new Error('Component ID contains null bytes');
  }

  const isValidLcsc = isLcscId(id);
  const isValidUuid = isEasyEDAUuid(id);

  if (!isValidLcsc && !isValidUuid) {
    throw new Error(
      `Invalid component ID format: ${id}. ` +
      `Expected LCSC part number (C followed by digits) or EasyEDA UUID (32-character hex string)`
    );
  }
}

export function createComponentService(): ComponentService {
  return {
    async search(query: string, options: SearchOptions = {}): Promise<ComponentSearchResult[]> {
      const { source = 'lcsc', limit = 20, inStock, basicOnly } = options;

      if (source === 'community' || source === 'easyeda-community') {
        const results = await easyedaCommunityClient.search({
          query,
          limit,
        });
        return results.map(r => ({
          lcscId: r.uuid,
          name: r.title,
          manufacturer: r.owner?.nickname || 'Community',
          description: r.description || '',
          package: r.package || '',
          stock: 0,
        }));
      }

      return jlcClient.search(query, { limit, inStock, basicOnly });
    },

    async fetch(id: string): Promise<EasyEDAComponentData | null> {
      validateComponentId(id);
      
      if (isLcscId(id)) {
        return easyedaClient.getComponentData(id);
      }
      // For community components, caller should use fetchCommunity and adapt
      return null;
    },

    async fetchCommunity(uuid: string): Promise<EasyEDACommunityComponent | null> {
      validateComponentId(uuid);
      return easyedaCommunityClient.getComponent(uuid);
    },

    async getDetails(lcscId: string): Promise<ComponentDetails> {
      validateComponentId(lcscId);
      
      const component = await easyedaClient.getComponentData(lcscId);
      if (!component) {
        throw new Error(`Component ${lcscId} not found`);
      }

      return {
        lcscId,
        name: component.info.name,
        manufacturer: component.info.manufacturer || '',
        description: component.info.description || '',
        category: component.info.category || '',
        package: component.info.package || '',
        pinCount: component.symbol?.pins?.length || 0,
        padCount: component.footprint?.pads?.length || 0,
        has3DModel: !!component.model3d,
        datasheet: component.info.datasheet,
      };
    },
  };
}
