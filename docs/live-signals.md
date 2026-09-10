# Binance Spot: live SMA1 / SMA238 monitoring

## Активная конфигурация

Единственный источник настроек — `libs/core-config/src/lib/monitoring.ts`:

- Symbols: BTCUSDT, ETHUSDT, XRPUSDT, TAOUSDT.
- Timeframes: 4h и 1d (UTC).
- SMA: fast=1, slow=238.
- History: 300 CLOSED candles на stream.

Добавление symbol требует изменения списка, а не business logic runner.
Активного 1m или SMA10/SMA50 monitoring нет. Общий тип Timeframe сохраняет 1m
для generic API и тестов. Mock использует тот же набор рынков и периоды,
но остаётся генератором CLOSED-сигналов, явно помеченных как mock.

## Runtime flow

Один последовательный market cycle с целевым периодом 1 секунда:

1. Получить Binance `/api/v3/time` один раз.
2. Обработать четыре symbols независимо. Для каждого symbol синхронизировать
   нужные closed windows 4h/1d и получить один `/api/v3/ticker/price`.
3. Использовать одну полученную цену symbol для обоих его timeframe.
4. Рассчитать SMA1/SMA238 и сравнить с сохранённым live-state этого stream.
5. Одной Redis MULTI/EXEC транзакцией сохранить state, последнее событие и pending.
6. Отдельный delivery cycle отправляет pending через Telegram.

Кеш runner — Map с ключом `symbol:timeframe`. Каждая запись содержит своё
окно candles и currentOpen. Истории и контекст разных рынков не смешиваются.
Сетевые ошибки одного stream не останавливают остальные streams. Цикл ожидает
текущую работу; параллельного второго market cycle нет. Медленная сеть увеличивает
период. Notification delivery не блокирует market calculations.

## История и current price

При старте, отсутствии/неполном кеше или изменении currentOpen вызывается прежний
syncBinanceCandles: весь сохраняемый диапазон запрашивается одним REST-запросом
с startTime/endTime. Окно из 300 помещается в лимит 1000. При простое восстанавливается
весь нужный диапазон без incremental sync, архива или database.

Свечи проверяются на source, symbol, timeframe, CLOSED status, уникальность,
порядок, непрерывность и актуальность последней свечи. Только после успешной
проверки Redis history заменяется целиком. Ошибка Binance не удаляет прежнее значение;
устаревшее/неполное окно не используется для live calculation. Исторические cross
во время backfill не вычисляются и не рассылаются.

Между закрытиями свечей history-запросов нет. На обычной 4h границе обновляются
четыре окна, на суточной — все восемь. При возможном пересечении границы во время
HTTP-запросов расчёт соответствующего timeframe откладывается до следующего цикла.
MOCK_TIME_SCALE не влияет на Binance timestamps.

SMA1 = current price. SMA238 = (сумма последних 237 CLOSED closes + current price) / 238.
Более старые 63 свечи — запас rolling window и не входят в текущую SMA238.
Current price никогда не записывается как CLOSED candle. HTTP ticker не содержит
времени сделки: observedAt — локальное время получения цены, detectedAt — создания
события. REST sampling может пропустить переходы между опросами; 1–2 секунды —
ориентир нормального наблюдения, а не гарантия Telegram delivery.

## BUY / SELL, restart и stop loss

Для каждого symbol/timeframe состояние независимо:

- below -> above: bull_cross + action=BUY;
- above -> below: bear_cross + action=SELL;
- повтор того же направления: без события;
- точное равенство сохраняет последнее направление без события.

BUY -> SELL -> BUY внутри одной формирующейся свечи создаёт три отдельных event ID,
без cooldown. Первое наблюдение без state только устанавливает baseline.
При restart сохранённое состояние продолжает работу: допустим один актуальный
transition от прежней стороны к текущей, но не реконструкция offline-пересечений.

Event сохраняет mode=live, source=binance, periods, action, signal, price,
now.fast/slow, prev.fast/slow, observedAt, detectedAt, candleOpenTime/candleCloseTime
и уникальный id. ts совпадает с observedAt. Telegram показывает BUY/SELL,
LIVE / INTRABAR, symbol, timeframe, SMA1/SMA238, price, SMA238, время и forming context.

suggestedStopLoss — optional число. Шаблон показывает Suggested SL только при
наличии поля. Расчёта SL нет: формула остаётся отдельным продуктовым решением.
Trading API, сделки и stop-loss orders не добавлены.

## Redis и HTTP

- `market:candles:{symbol}:{tf}`: 300 CLOSED candles, TTL 4h — 180 суток, 1d — 365 суток.
- `signals:live_state:sma_cross:binance:{symbol}:{tf}:1:238`: live-state без TTL.
- `signals:last:sma_cross:{symbol}:{tf}`: последнее событие без TTL, формат ключа сохранён.
- `signals:pending:telegram`: прежний hash event ID -> событие и per-recipient delivery state.
- `subs:pair:*` / `subs:chat:*`: прежняя схема подписок, single остаётся основным режимом.

Старые 1m и 10:50 state keys не удаляются и не участвуют в активном monitoring.
Старое значение last может оставаться видимым до нового события — его periods,
timeframe и timestamps показывают исходную стратегию. Ранее созданные pending
не удаляются и могут доставляться после restart: это сохранение обещанного retry,
а не продолжение расчёта старой стратегии.

`GET /api/signals/last` по умолчанию читает BTCUSDT/4h и возвращает сохранённый event.
`GET /api/signals/sma-cross` по умолчанию использует BTCUSDT/4h и периоды 1/238,
остаётся расчётом по CLOSED candles, явно возвращает mode=closed и action либо null.
Generic SMA API остаётся параметризованным. Для дневных данных передать tf=1d.

## Доставка и ограничения

Существующие pending/retry/per-recipient deliveredAt сохранены. Положительный
Telegram HTTP/API ответ фиксируется для конкретного получателя; успешному подписчику
не повторяют событие из-за ошибки другого. Failed delivery остаётся pending с
backoff 1, 2, 4... до 30 секунд с учётом Telegram retry_after. Это retry доставки,
не cooldown сигналов. Pending удаляется только после успеха всем получателям.

Shutdown останавливает scheduling, завершает текущую отправку и оставляет остальной
pending для restart, затем закрывает Redis. Запускать один worker: distributed
locking отсутствует. Потеря ответа Telegram после приёма сообщения или падение
между Telegram success и Redis acknowledgement может дать дубль: sendMessage
не имеет idempotency key. Неустранимые ошибки получателя накапливают pending;
политика permanent errors и очистки backlog пока не реализована.

## Binance requests

Обычный цикл: один time + четыре ticker requests = пять HTTP requests/секунду,
приблизительно 540 request-weight/минуту (time=1, ticker одного symbol=2).
Первоначальные восемь klines requests добавляют суммарный weight 16; они не
повторяются каждую секунду. Это небольшая нагрузка для текущего набора рынков;
лимит IP также расходуют другие приложения, поэтому абсолютная гарантия отсутствует.

Каждый history/price request имеет локальный retry с backoff до 30 секунд. Ответ
429/418 включает общую паузу Binance requests по Retry-After; обычная ошибка
одного stream не останавливает здоровые. HTTP timeout сохранён: 5 секунд.

Источники: [Binance market endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market),
[Binance REST limits](https://developers.binance.com/en/docs/products/spot/rest-api#limits).

## Ручная проверка

1. Запустить один worker в binance/single. В стартовом логе должны быть четыре
   symbols, два timeframe, периоды 1/238 и limit=300.
2. Проверить все восемь history keys: длина 300, source=binance, sorted/unique,
   последняя candle закрыта. Старый BTCUSDT:1m не должен обновляться.
3. На пустом новом state не должно быть initialization BUY/SELL.
4. Сверить API/Telegram live price и SMA238; дождаться реального перехода и
   проверить независимость symbols/timeframes. Строки Suggested SL пока не будет.
5. После restart проверить сохранённый state, восстановленную историю и отсутствие
   пачки реконструированных исторических сигналов.
6. Проверить pending/retry после временной ошибки доставки и отсутствие повтора
   уже успешному получателю; остановка worker должна завершить оба цикла.

Новых зависимостей/секретов нет. Redis reset и миграционная очистка не требуются.
Реальные Binance/Telegram endpoints не запускаются автоматическими unit-тестами.
