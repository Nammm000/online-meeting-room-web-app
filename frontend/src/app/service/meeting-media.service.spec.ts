import { shouldAutoSubscribe } from 'service/meeting-media.service';

/**
 * The auto-subscription decision, isolated from all WebRTC plumbing: the
 * screen share is the one shared stream everyone watches; participant
 * cameras are strictly click-to-view.
 */
describe('shouldAutoSubscribe', () => {
  const nobody = new Set<number>();

  it('always subscribes to the screen share', () => {
    expect(shouldAutoSubscribe('screen_share', 9, nobody)).toBe(true);
    expect(shouldAutoSubscribe('screen_share', 9, new Set([3]))).toBe(true);
  });

  it('subscribes to a camera only after its tile was clicked', () => {
    expect(shouldAutoSubscribe('camera', 9, nobody)).toBe(false);
    expect(shouldAutoSubscribe('camera', 9, new Set([9]))).toBe(true);
    expect(shouldAutoSubscribe('camera', 9, new Set([3]))).toBe(false);
  });

  it('never subscribes to other sources', () => {
    expect(shouldAutoSubscribe('microphone', 9, new Set([9]))).toBe(false);
    expect(shouldAutoSubscribe('unknown', 9, new Set([9]))).toBe(false);
  });
});
