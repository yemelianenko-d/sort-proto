import type { AnalyticsService } from './PlatformService';
import type { GameEventName, EventPayload } from '../core/events/EventBus';
import { logInfo } from '../core/utils/logger';

/**
 * Prototype analytics: structured console logs.
 * Swap for a real SDK adapter later — the call sites will not change.
 */
export class MockAnalyticsService implements AnalyticsService {
  track(event: GameEventName, payload: EventPayload): void {
    logInfo(`[analytics] ${event}`, JSON.stringify(payload));
  }
}
