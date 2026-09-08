import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 云 OCR 设置（Azure Document Intelligence，失败页回填用）。
 * 铁律：endpoint/Key 只存本机 localStorage，随请求发网关（内存态用完即弃，
 * 网关不落盘）；不填 = 纯本地链路，行为不变。
 */
export interface OcrStoreState {
  azureDiEndpoint: string;
  azureDiKey: string;
  setAzureDi: (endpoint: string, key: string) => void;
  clearAzureDi: () => void;
}

export const useOcrStore = create<OcrStoreState>()(
  persist(
    (set) => ({
      azureDiEndpoint: '',
      azureDiKey: '',
      setAzureDi: (endpoint: string, key: string) =>
        set({ azureDiEndpoint: endpoint.trim(), azureDiKey: key.trim() }),
      clearAzureDi: () => set({ azureDiEndpoint: '', azureDiKey: '' }),
    }),
    { name: 'study_studio_ocr_config' }
  )
);
