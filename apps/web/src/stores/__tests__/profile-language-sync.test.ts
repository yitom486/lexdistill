import { afterEach, beforeEach, expect, it } from 'bun:test';
import { useUserProfileStore } from '../useUserProfileStore.js';
import { findStudyGoalOption } from '../../config/learner-profile-options.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // 网关返回空对象即可：断言只关心本地归一化后的值
  globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
  useUserProfileStore.setState({
    profile: {
      ...useUserProfileStore.getState().profile,
      targetLanguage: 'en',
      studyGoal: 'CET6',
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('改备考目标即改语言（不会留下跨语言的目标）', async () => {
  await useUserProfileStore.getState().updateProfile({ studyGoal: 'JLPT_N2' });
  const profile = useUserProfileStore.getState().profile;
  expect(profile.targetLanguage).toBe('ja');
  expect(profile.studyGoal).toBe('JLPT_N2');
  expect(useUserProfileStore.getState().dailyTask.language).toBe('ja');
});

it('只改语言时，跨语言的目标落到该语言默认赛道', async () => {
  await useUserProfileStore.getState().updateProfile({ targetLanguage: 'ko' });
  const profile = useUserProfileStore.getState().profile;
  expect(profile.targetLanguage).toBe('ko');
  expect(findStudyGoalOption(profile.studyGoal)?.lang).toBe('ko');
});

it('同语言内换目标不动语言', async () => {
  await useUserProfileStore.getState().updateProfile({ studyGoal: 'CET4' });
  const profile = useUserProfileStore.getState().profile;
  expect(profile.targetLanguage).toBe('en');
  expect(profile.studyGoal).toBe('CET4');
});

it('只改无关字段时语言与目标都不动', async () => {
  await useUserProfileStore.getState().updateProfile({ displayName: '学员_b_01' });
  const profile = useUserProfileStore.getState().profile;
  expect(profile.targetLanguage).toBe('en');
  expect(profile.studyGoal).toBe('CET6');
});
