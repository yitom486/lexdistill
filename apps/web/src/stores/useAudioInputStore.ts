import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigratedStorage } from './store-storage.js';

export interface AudioInputStoreState {
  preferredDeviceId: string;
  setPreferredDeviceId: (deviceId: string) => void;
}

export const useAudioInputStore = create<AudioInputStoreState>()(
  persist(
    (set) => ({
      preferredDeviceId: '',
      setPreferredDeviceId: (preferredDeviceId: string) => set({ preferredDeviceId }),
    }),
    {
      name: 'lexdistill_audio_input_config',
      storage: createMigratedStorage(['study_studio_audio_input_config']),
      version: 1,
    }
  )
);
