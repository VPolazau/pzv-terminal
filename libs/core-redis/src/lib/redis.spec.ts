import { createClient } from 'redis';
import { closeRedis, connectRedis } from './redis';
jest.mock('redis', () => ({ createClient: jest.fn() }));

describe('Redis lifecycle', () => {
  afterEach(async () => {
    await closeRedis();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  function fakeClient() {
    const client = {
      isOpen: false,
      isReady: false,
      on: jest.fn(),
      connect: jest.fn(async () => {
        client.isOpen = true;
        client.isReady = true;
      }),
      close: jest.fn(async () => {
        client.isOpen = false;
      }),
      destroy: jest.fn(() => {
        client.isOpen = false;
      }),
    };
    jest
      .mocked(createClient)
      .mockReturnValue(client as unknown as ReturnType<typeof createClient>);
    return client;
  }
  it('shares the connection within a process and gracefully closes it', async () => {
    const client = fakeClient();
    expect(await connectRedis()).toBe(await connectRedis());
    expect(client.connect).toHaveBeenCalledTimes(1);
    await closeRedis();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();
  });
  it('destroys a reconnecting client on shutdown', async () => {
    const client = fakeClient();
    await connectRedis();
    client.isReady = false;
    await closeRedis();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
