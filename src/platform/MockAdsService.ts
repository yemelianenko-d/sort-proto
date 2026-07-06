import type { AdsService } from './PlatformService';
import { logInfo } from '../core/utils/logger';

/** Prototype ads: instantly "shows" a rewarded ad and resolves success. */
export class MockAdsService implements AdsService {
  async showRewardedAd(placement: string): Promise<boolean> {
    logInfo(`[ads] showRewardedAd("${placement}") -> mock success`);
    return true;
  }
}
