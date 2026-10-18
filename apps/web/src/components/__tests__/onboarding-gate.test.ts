import { beforeEach, expect, it } from 'bun:test';
import { shouldShowOnboarding } from '../OnboardingDialog.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';

const base = { fresh: true, isFetched: true, dismissed: false, onboardingCompleted: false };

beforeEach(() => {
  usePreferencesStore.setState({ onboardingCompleted: false });
});

it('首次进入且画像已就绪时出现', () => {
  expect(shouldShowOnboarding(base)).toBe(true);
});

it('已经选过（本地标记）就不再出现', () => {
  expect(shouldShowOnboarding({ ...base, onboardingCompleted: true })).toBe(false);
});

it('本会话跳过过就不再出现', () => {
  expect(shouldShowOnboarding({ ...base, dismissed: true })).toBe(false);
});

it('画像未拉完或已有学习记录时不弹', () => {
  expect(shouldShowOnboarding({ ...base, isFetched: false })).toBe(false);
  expect(shouldShowOnboarding({ ...base, fresh: false })).toBe(false);
});

it('completeOnboarding 写入持久化标记（跨重启不再弹）', () => {
  expect(usePreferencesStore.getState().onboardingCompleted).toBe(false);
  usePreferencesStore.getState().completeOnboarding();
  expect(usePreferencesStore.getState().onboardingCompleted).toBe(true);
  expect(shouldShowOnboarding({ ...base, onboardingCompleted: usePreferencesStore.getState().onboardingCompleted })).toBe(false);
});
