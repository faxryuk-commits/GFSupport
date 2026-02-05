# GFSupport Database Schema

## Соглашения по именованию

| Концепция | Название в БД | Название в UI | Тип ID |
|-----------|---------------|---------------|--------|
| Канал/Чат | `channel` | Канал | `VARCHAR(64)` |
| Сообщение | `message` | Сообщение | `VARCHAR(64)` |
| Кейс/Тикет | `case` | Кейс | `VARCHAR(64)` |
| Агент/Сотрудник | `agent` | Агент | `VARCHAR(64)` |
| Клиент | `user` | Клиент | `VARCHAR(64)` |

## Таблицы и связи

### 1. Основные сущности

```sql
-- Каналы (Telegram чаты)
support_channels (
  id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id BIGINT UNIQUE NOT NULL,
  ...
)

-- Сообщения
support_messages (
  id VARCHAR(64) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL REFERENCES support_channels(id),
  case_id VARCHAR(64) REFERENCES support_cases(id),
  ...
)

-- Кейсы
support_cases (
  id VARCHAR(64) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL REFERENCES support_channels(id),
  assignee_id VARCHAR(64) REFERENCES support_agents(id),
  source_message_id VARCHAR(64) REFERENCES support_messages(id),
  ...
)

-- Агенты
support_agents (
  id VARCHAR(64) PRIMARY KEY,
  telegram_id VARCHAR(64) UNIQUE,
  ...
)
```

### 2. Связи (Foreign Keys)

| Дочерняя таблица | Поле | Родительская таблица | ON DELETE |
|------------------|------|----------------------|-----------|
| `support_messages` | `channel_id` | `support_channels` | CASCADE |
| `support_messages` | `case_id` | `support_cases` | SET NULL |
| `support_cases` | `channel_id` | `support_channels` | CASCADE |
| `support_cases` | `assignee_id` | `support_agents` | SET NULL |
| `support_case_activities` | `case_id` | `support_cases` | CASCADE |
| `support_topics` | `channel_id` | `support_channels` | CASCADE |
| `support_conversations` | `channel_id` | `support_channels` | CASCADE |
| `support_reactions` | `message_id` | `support_messages` | CASCADE |
| `support_feedback` | `message_id` | `support_messages` | CASCADE |
| `support_commitments` | `channel_id` | `support_channels` | CASCADE |
| `support_commitments` | `case_id` | `support_cases` | SET NULL |
| `support_reminders` | `channel_id` | `support_channels` | CASCADE |
| `support_solutions` | `case_id` | `support_cases` | CASCADE |
| `support_dialogs` | `channel_id` | `support_channels` | CASCADE |
| `support_agent_activity` | `agent_id` | `support_agents` | CASCADE |

### 3. Обязательные индексы

```sql
-- Для быстрого поиска сообщений по каналу
CREATE INDEX idx_messages_channel ON support_messages(channel_id);
CREATE INDEX idx_messages_channel_date ON support_messages(channel_id, created_at DESC);

-- Для быстрого поиска кейсов
CREATE INDEX idx_cases_channel ON support_cases(channel_id);
CREATE INDEX idx_cases_status ON support_cases(status) WHERE status != 'resolved';
CREATE INDEX idx_cases_assignee ON support_cases(assignee_id) WHERE assignee_id IS NOT NULL;

-- Для поиска непрочитанных
CREATE INDEX idx_messages_unread ON support_messages(channel_id, is_read) WHERE is_read = false;

-- Для статистики агентов
CREATE INDEX idx_activities_agent ON support_agent_activity(agent_id, created_at DESC);
```

### 4. Полный список таблиц (29)

#### Основные
| # | Таблица | Описание |
|---|---------|----------|
| 1 | `support_channels` | Telegram каналы/чаты |
| 2 | `support_messages` | Сообщения |
| 3 | `support_cases` | Кейсы/тикеты |
| 4 | `support_case_activities` | История изменений кейсов |
| 5 | `support_agents` | Агенты/сотрудники |
| 6 | `support_users` | Клиенты |

#### Структура чатов
| # | Таблица | Описание |
|---|---------|----------|
| 7 | `support_topics` | Топики в форум-группах |
| 8 | `support_conversations` | Сессии общения |
| 9 | `support_reactions` | Реакции на сообщения |

#### Агенты и доступ
| # | Таблица | Описание |
|---|---------|----------|
| 10 | `support_agent_activity` | Логи действий агентов |
| 11 | `support_agent_sessions` | Сессии авторизации |
| 12 | `support_invites` | Приглашения для регистрации |

#### AI и автоматизация
| # | Таблица | Описание |
|---|---------|----------|
| 13 | `support_ai_patterns` | Паттерны AI анализа |
| 14 | `support_auto_templates` | Шаблоны автоответов |
| 15 | `support_automations` | Правила автоматизации |
| 16 | `support_solutions` | База решений проблем |
| 17 | `support_dialogs` | Диалоги для обучения AI |
| 18 | `support_embeddings` | Векторные представления |
| 19 | `support_faq` | Часто задаваемые вопросы |

#### Обратная связь
| # | Таблица | Описание |
|---|---------|----------|
| 20 | `support_feedback` | Оценки качества |
| 21 | `support_commitments` | Обязательства |
| 22 | `support_reminders` | Напоминания |

#### Рассылки
| # | Таблица | Описание |
|---|---------|----------|
| 23 | `support_broadcasts` | Рассылки |
| 24 | `support_broadcast_scheduled` | Запланированные рассылки |
| 25 | `support_broadcast_clicks` | Статистика кликов |

#### Справочники
| # | Таблица | Описание |
|---|---------|----------|
| 26 | `support_settings` | Настройки системы |
| 27 | `support_docs` | База знаний |
| 28 | `support_learning_stats` | Статистика обучения AI |

#### Служебные
| # | Таблица | Описание |
|---|---------|----------|
| 29 | `support_case_ticket_seq` | Sequence для номеров тикетов |

---

## Диаграмма связей

```
┌─────────────────┐
│ support_agents  │◄──────────────────────────────────────┐
└────────┬────────┘                                       │
         │                                                │
         │ agent_id                                       │ assignee_id
         ▼                                                │
┌────────────────────┐                          ┌────────┴────────┐
│support_agent_      │                          │ support_cases   │◄─────┐
│activity            │                          └────────┬────────┘      │
└────────────────────┘                                   │               │
                                                         │ channel_id    │ case_id
                                                         ▼               │
┌─────────────────────────────────────────────────────────────────┐      │
│                      support_channels                           │      │
└─────────────────────────────┬───────────────────────────────────┘      │
                              │                                          │
          ┌───────────────────┼───────────────────┐                      │
          │                   │                   │                      │
          ▼                   ▼                   ▼                      │
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│support_messages │ │support_topics   │ │support_         │              │
│                 │ │                 │ │conversations    │              │
└────────┬────────┘ └─────────────────┘ └─────────────────┘              │
         │                                                               │
         │ message_id                                                    │
         ▼                                                               │
┌─────────────────┐                                                      │
│support_reactions│                                                      │
│support_feedback │──────────────────────────────────────────────────────┘
└─────────────────┘
```

---

*Последнее обновление: 2026-02-05*
