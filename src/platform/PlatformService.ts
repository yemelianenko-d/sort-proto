import type { GameEventName, EventPayload } from '../core/events/EventBus';
import type { Orientation, SafeAreaInsets } from '../core/utils/device';

/**
 * Platform abstraction layer.
 *
 * Gameplay code never imports browser/Capacitor APIs directly — everything
 * platform-specific goes through these interfaces. For the prototype only
 * mock/web implementations exist; native iOS/Android implementations can be
 * added later without touching /mechanics.
 */

export interface AnalyticsService {
  track(event: GameEventName, payload: EventPayload): void;
}

export interface AdsService {
  /** Resolves with `true` if the (mock) rewarded ad was "watched". */
  showRewardedAd(placement: string): Promise<boolean>;
}

export interface PaymentsService {
  purchaseProduct(productId: string): Promise<{ success: boolean; productId: string }>;
}

export interface StorageService {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface HapticsService {
  /** Best-effort vibration; silently no-ops where unsupported. */
  vibrate(pattern: number | number[]): void;
}

export interface DeviceService {
  isMobile(): boolean;
  orientation(): Orientation;
  screenSize(): { width: number; height: number };
  safeArea(): SafeAreaInsets;
  isStandalone(): boolean;
}

export interface PlatformService {
  readonly name: 'web' | 'ios' | 'android';
  analytics: AnalyticsService;
  ads: AdsService;
  payments: PaymentsService;
  storage: StorageService;
  device: DeviceService;
  haptics: HapticsService;
}
