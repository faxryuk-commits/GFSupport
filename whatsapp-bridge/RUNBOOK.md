# WhatsApp Bridge — runbook

Что делать если bridge не подключается к WhatsApp. Пошагово, по порядку.

## Быстрый диагноз

```bash
curl -s https://<bridge-host>/health | jq
```

Смотрим:
- `ok` — true/false
- `lastConnectedAt` — null = ни разу не коннектились, иначе ISO дата
- `everConnected` — был ли хотя бы один успешный коннект за uptime процесса
- `initialRejectStreak` — счётчик handshake-rejection'ов до первого успеха (>0 = WA отвергает клиент)
- `totalDisconnects` — общее число с момента старта
- `lastError` — последняя причина обрыва

## Ветка A — `everConnected=false` и `initialRejectStreak>0`

WhatsApp отвергает мост на стадии handshake. Bridge сам уйдёт в backoff 30 мин → 1ч → 2ч → … до 6ч.

Возможные причины (по убыванию вероятности):

1. **IP в anti-abuse списке WA** — самая частая в облачных PaaS (Railway, Vercel, Render). Поправить нельзя, только сменить.
2. **Устаревший Baileys** — WA меняет протокол. См. ниже про обновление.
3. **Browser fingerprint в блокировке** — `Browsers.ubuntu('Chrome')` мог попасть в фильтр.

### Что делать

| Шаг | Действие | Эффект |
|---|---|---|
| 1 | Ждём 30+ мин с момента последнего 401, бридж сам попробует | Бесплатно, IP может остыть |
| 2 | Пересоздаём Railway service (новый IP) | Новый IP вне anti-abuse — обычно решает |
| 3 | Деплоим на Hetzner/Fly.io | Hetzner-IP в WA дружелюбнее чем Railway-IP shared range |
| 4 | Обновляем Baileys | Помогает если протокол изменился |

**Никогда не делай**: ручной рестарт каждые 5 минут «надо же что-то делать» — только глубже закопает IP в anti-abuse.

## Ветка B — `everConnected=true`, потом `lastConnectedAt` пропал

Bridge подключался, потом перестал. Чаще всего — потеря AUTH_DIR.

### Чек-лист

1. **Railway Volume на `/data` существует и примонтирован?** Без него каждый redeploy стирает auth.
   - Railway → Service → Settings → Volumes → должен быть mount на `/data`
   - Env: `AUTH_DIR=/data/auth_info`
2. **`lastError` содержит «Сессия отозвана сервером»?** — пользователь отключил привязку с телефона, нужен новый QR-скан через UI.
3. **Серия timeout/connectionLost** — нестабильная сеть Railway. Bridge сам справится через exp backoff.

## Ветка C — `ok=true`, но `messageStats.received=0`

Bridge подключён, но сообщения не приходят:

1. Проверить `filterMode` — может стоять `groups_only` и личные сообщения отфильтрованы ([routes.ts:88](src/routes.ts:88))
2. Проверить webhook URL: `env GFSUPPORT_WEBHOOK_URL`
3. Логи Railway → искать `[Webhook] Failed` или `[MSG] Skipped`

## Обновление Baileys

```bash
cd whatsapp-bridge
npm install @whiskeysockets/baileys@latest
npm run build
```

Версия 7.x в RC — пока не брать, нестабильно. Берём последнюю 6.x.

После апгрейда проверить что:
- `useMultiFileAuthState` всё ещё в API
- `makeWASocket` принимает тот же `auth/logger/printQRInTerminal/browser/version` shape
- `DisconnectReason.*` коды не переименованы

## Полная пересборка («ядерный вариант»)

Если ничего не помогло за сутки:

1. Создать новый Railway service из этого репо
2. Подключить **новый Volume** на `/data`
3. Скопировать env: `BRIDGE_SECRET`, `GFSUPPORT_WEBHOOK_URL`, `AUTH_DIR=/data/auth_info`, `BLOB_READ_WRITE_TOKEN`, `FILTER_MODE`
4. Получить новый публичный URL → обновить `WHATSAPP_BRIDGE_URL` в Vercel env
5. Открыть UI настроек → пройти QR-привязку

Старый service не сносить пока новый не подтвердил `lastConnectedAt != null` и `messageStats.received > 0`.

## История болезни

- `aeee087` — изначальная интеграция
- `0aa57b5` — `Browsers.ubuntu('Chrome')` (был кастомный fingerprint, давал 405)
- `be48f5c` — `fetchLatestBaileysVersion()` от 405
- `9472125` — AUTH_DIR=/data/auth_info под Railway Volume
- `de66f21` — 401/403 → auto-wipe (тогда было разумно, сейчас разделили на initial vs session)
- `53a32e1` — pair-code как обход «Can't link new devices»
- `ef8cfae` — exp backoff + watchdog + Telegram-алерты при downtime > 30 мин
- (текущий патч) — отдельная ветка для initial-rejection с длинным backoff, чтобы не выжигать IP в WA anti-abuse
