import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      name: 'study_studio_audio_input_config',
      version: 1,
    }
  )
);
