import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePdfRuntime } from '../src/infrastructure/pdf-runtime/pdf-runtime-provision.js';

const target = process.argv.includes('--test')
  ? resolve(process.env.LEXDISTILL_TEST_RUNTIME_DIR || process.env.STUDY_STUDIO_TEST_RUNTIME_DIR || fileURLToPath(new URL('../src/.test-runtime/', import.meta.url)))
  : fileURLToPath(new URL('../../desktop/src-tauri/resources/pdf-runtime/', import.meta.url));

await preparePdfRuntime({ runtimeDir: target });
console.log(`[pdf-build] PDF 组件已准备并加载验证：${target}`);
