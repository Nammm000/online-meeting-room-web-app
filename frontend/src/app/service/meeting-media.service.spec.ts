import { encodeReaction, parseReaction, shouldAutoSubscribe } from 'service/meeting-media.service';

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

/** The reaction wire codec — receivers shape-check and drop anything malformed. */
describe('reaction codec', () => {
  it('round-trips every reaction key', () => {
    for (const key of ['heart', 'laugh', 'cry', 'like'] as const) {
      expect(parseReaction(encodeReaction(key))).toEqual({ type: 'reaction', reaction: key });
    }
  });

  it('rejects malformed JSON bytes', () => {
    expect(parseReaction(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('rejects an empty payload', () => {
    expect(parseReaction(new Uint8Array(0))).toBeNull();
  });

  it('rejects non-object JSON', () => {
    expect(parseReaction(new TextEncoder().encode('"heart"'))).toBeNull();
    expect(parseReaction(new TextEncoder().encode('42'))).toBeNull();
  });

  it('rejects a wrong type discriminator', () => {
    const raw = new TextEncoder().encode(JSON.stringify({ type: 'other', reaction: 'heart' }));
    expect(parseReaction(raw)).toBeNull();
  });

  it('rejects an unknown reaction key', () => {
    const raw = new TextEncoder().encode(JSON.stringify({ type: 'reaction', reaction: 'fire' }));
    expect(parseReaction(raw)).toBeNull();
  });
});
