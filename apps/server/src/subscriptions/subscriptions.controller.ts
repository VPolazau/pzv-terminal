import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import type { Timeframe } from '@pzv-terminal/shared-types';
import { REDIS } from '../redis/redis.module';
import type { RedisClientType } from 'redis';

type SubscribeDto = {
  chatId: string;
  symbol: string;
  tf: Timeframe;
};

function chatKey(chatId: string) {
  return `subs:chat:${chatId}`;
}

function pairKey(symbol: string, tf: Timeframe) {
  return `subs:pair:${symbol}:${tf}`;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(@Inject(REDIS) private readonly redis: RedisClientType) {}

  @Post('subscribe')
  async subscribe(@Body() body: SubscribeDto) {
    const chatId = String(body.chatId).trim();
    const symbol = normalizeSymbol(body.symbol);
    const tf = body.tf;

    await this.redis.sAdd(chatKey(chatId), `${symbol}:${tf}`);
    await this.redis.sAdd(pairKey(symbol, tf), chatId);

    return { ok: true, chatId, symbol, tf };
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() body: SubscribeDto) {
    const chatId = String(body.chatId).trim();
    const symbol = normalizeSymbol(body.symbol);
    const tf = body.tf;
    await this.redis.sRem(chatKey(chatId), `${symbol}:${tf}`);
    await this.redis.sRem(pairKey(symbol, tf), chatId);

    return { ok: true, chatId, symbol, tf };
  }

  @Get()
  async list(@Query('chatId') chatId: string) {
    const id = String(chatId ?? '').trim();
    if (!id) return { ok: false, error: 'chatId is required' };
    const subs = await this.redis.sMembers(chatKey(id));
    return { ok: true, chatId: id, subs };
  }
}
