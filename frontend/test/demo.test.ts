import { describe, expect, it, vi } from 'vitest';
import { withBase } from '@/lib/basePath';

vi.mock('@livekit/components-react', () => ({}));
vi.mock('livekit-client', () => ({}));

const { echoTurn } = await import('@/components/DemoView');

describe('echoTurn', () => {
  it('answers with exactly what was heard', () => {
    const [user, echo] = echoTurn('hello there', 5, 'x');
    expect(user).toMatchObject({ fromUser: true, text: 'hello there', timestamp: 5 });
    expect(echo).toMatchObject({ fromUser: false, text: 'hello there' });
    expect(user!.id).not.toBe(echo!.id);
  });
});

describe('withBase', () => {
  it('leaves paths alone without a base path', () => {
    expect(withBase('/settings')).toBe('/settings');
  });
});
