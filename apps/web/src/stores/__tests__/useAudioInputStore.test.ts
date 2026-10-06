import { describe, it, expect, beforeEach } from 'bun:test';
import { useAudioInputStore } from '../useAudioInputStore.js';

describe('useAudioInputStore', () => {
  beforeEach(() => {
    useAudioInputStore.setState({ preferredDeviceId: '' });
  });

  it('initializes with an empty preferred device id', () => {
    expect(useAudioInputStore.getState().preferredDeviceId).toBe('');
  });

  it('updates preferredDeviceId correctly', () => {
    useAudioInputStore.getState().setPreferredDeviceId('mic-device-123');
    expect(useAudioInputStore.getState().preferredDeviceId).toBe('mic-device-123');

    useAudioInputStore.getState().setPreferredDeviceId('');
    expect(useAudioInputStore.getState().preferredDeviceId).toBe('');
  });
});
