import type {
  PlatformService,
  StorageService,
  DeviceService,
  HapticsService,
} from './PlatformService';
import { MockAnalyticsService } from './MockAnalyticsService';
import { MockAdsService } from './MockAdsService';
import { MockPaymentsService } from './MockPaymentsService';
import { storageGet, storageSet, storageRemove } from '../core/utils/storage';
import {
  isTouchDevice,
  getOrientation,
  getScreenSize,
  getSafeAreaInsets,
  isStandaloneDisplayMode,
} from '../core/utils/device';

class WebStorageService implements StorageService {
  get(key: string): string | null {
    return storageGet(key);
  }
  set(key: string, value: string): void {
    storageSet(key, value);
  }
  remove(key: string): void {
    storageRemove(key);
  }
}

class WebHapticsService implements HapticsService {
  vibrate(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported -> ignore */
    }
  }
}

class WebDeviceService implements DeviceService {
  isMobile(): boolean {
    return isTouchDevice();
  }
  orientation() {
    return getOrientation();
  }
  screenSize() {
    return getScreenSize();
  }
  safeArea() {
    return getSafeAreaInsets();
  }
  isStandalone(): boolean {
    return isStandaloneDisplayMode();
  }
}

/** Default platform for the browser prototype. */
export class WebPlatformService implements PlatformService {
  readonly name = 'web' as const;
  analytics = new MockAnalyticsService();
  ads = new MockAdsService();
  payments = new MockPaymentsService();
  storage = new WebStorageService();
  device = new WebDeviceService();
  haptics = new WebHapticsService();
}
