import type { PaymentsService } from './PlatformService';
import { logInfo } from '../core/utils/logger';

/** Prototype payments: resolves a fake successful purchase. */
export class MockPaymentsService implements PaymentsService {
  async purchaseProduct(productId: string): Promise<{ success: boolean; productId: string }> {
    logInfo(`[payments] purchaseProduct("${productId}") -> mock success`);
    return { success: true, productId };
  }
}
