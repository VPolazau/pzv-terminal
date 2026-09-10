# pzv-terminal

## О проекте

`pzv-terminal` - сервис для мониторинга криптовалютного рынка и генерации торговых сигналов в реальном времени.

Приложение получает рыночные данные с Binance, рассчитывает технические индикаторы и отслеживает заданные условия по выбранным торговым парам и таймфреймам. При возникновении сигнала система отправляет уведомление пользователю, чтобы он мог самостоятельно принять решение о входе или выходе из позиции.

Текущий этап проекта - мониторинг пересечений SMA1/SMA238 для BTC, ETH, XRP и TAO на таймфреймах 4h и 1d с live/intrabar определением BUY/SELL сигналов.

Монорепа для server + worker + shared libs.

Текущий market flow, live SMA, Redis state и retry Telegram описаны в
[docs/live-signals.md](docs/live-signals.md).

## Стек

- Nx
- NestJS
- Redis
- pnpm

## Приложения

- `apps/server` - HTTP API
- `apps/worker` - фоновый раннер сигналов и уведомлений

## Локальный запуск

### 1. Установить зависимости

```bash
pnpm install
```

### 2. Создать локальный env

Скопируй .env.example в .env.local

### 3. Запуск

```bash
pnpm dev
```

### 4. Поднять Redis

```bash
pnpm infra:up
```

## Полезные команды

```bash
pnpm dev
```

```bash
pnpm lint
```

```bash
pnpm infra:up
```

```bash
pnpm infra:down
```
