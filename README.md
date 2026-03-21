# pzv-terminal

Монорепа для server + worker + shared libs.

## Стек

- Nx
- NestJS
- Redis
- pnpm

## Приложения

- `apps/server` - HTTP API
- `apps/worker` - фоновый раннер сигналов и уведомлений

## Локальный запуск

### 1. Поднять Redis

```bash
pnpm infra:up
```

### 2. Установить зависимости

```bash
pnpm install
```

### 3. Создать локальный env

Скопируй .env.example в .env.local

### 4. Запуск

```bash
pnpm dev
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
