# Схема базы GFSupport

> Файл сгенерирован из боевой базы: `node scripts/db-schema.mjs`.
> Не редактируйте руками — правки сотрёт следующая генерация.
> Обновлено: 2026-09-05 · таблиц: 150

Все таймстампы — `timestamp` **без часового пояса**, значения в UTC.
Для ташкентского времени: `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'`.


## Поддержка (57)

### `support_agent_activity` · ~345 216 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| agent_id | varchar(50) | **нет** |  |
| session_id | varchar(50) | · |  |
| activity_type | varchar(50) | **нет** |  |
| activity_at | timestamp | **нет** | = now() |
| metadata | jsonb | · | = '{}' |

Индексы: `idx_activity_agent`, `idx_agent_activity_agent`

### `support_agent_ai_summaries` · ~1 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | integer | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| agent_name | varchar(255) | **нет** |  |
| agent_id | varchar(50) | · |  |
| period_from | date | **нет** |  |
| period_to | date | **нет** |  |
| source | varchar(20) | **нет** | = 'all' |
| verdict | varchar(20) | **нет** | = 'solid' |
| tldr | text | · |  |
| strengths | jsonb | **нет** | = '[]' |
| concerns | jsonb | **нет** | = '[]' |
| recommendations | jsonb | **нет** | = '[]' |
| kpi_snapshot | jsonb | · |  |
| generated_at | timestamptz | **нет** | = now() |

Индексы: `idx_agent_summaries_lookup`

### `support_agent_decisions` · ~9 224 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| channel_id | varchar(50) | · |  |
| channel_name | varchar(255) | · |  |
| source | varchar(20) | · |  |
| incoming_message | text | · |  |
| sender_name | varchar(255) | · |  |
| action | varchar(30) | · |  |
| reply_text | text | · |  |
| tag_agent_id | varchar(60) | · |  |
| tag_agent_name | varchar(255) | · |  |
| escalate_to_role | varchar(50) | · |  |
| case_priority | varchar(20) | · |  |
| case_title | varchar(255) | · |  |
| reasoning | text | · |  |
| confidence | real | · |  |
| context_messages_count | integer | · | = 0 |
| similar_history_count | integer | · | = 0 |
| feedback | varchar(20) | · |  |
| feedback_note | text | · |  |
| executed_actions | ARRAY | · |  |
| created_at | timestamp | · | = now() |
| outcome_at | timestamptz | · |  |
| knowledge | jsonb | · |  |

Индексы: `idx_decisions_org_created`

### `support_agent_markets` · ~6 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| agent_id | varchar(50) | **нет** | PK |
| market_id | varchar(50) | **нет** | PK |
| role | varchar(50) | · | = 'member' |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_agent_markets_agent`, `idx_agent_markets_market`

### `support_agent_sessions` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| agent_id | varchar(50) | **нет** |  |
| started_at | timestamp | **нет** | = now() |
| ended_at | timestamp | · |  |
| duration_minutes | integer | · |  |
| is_active | boolean | · | = true |
| org_id | varchar(50) | · |  |

Индексы: `idx_agent_sessions_org`, `idx_sessions_agent`

### `support_agents` · ~33 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| telegram_id | text | · |  |
| name | varchar(255) | **нет** |  |
| role | varchar(20) | · | = 'agent' |
| is_active | boolean | · | = true |
| is_online | boolean | · | = false |
| photo_url | text | · |  |
| email | varchar(255) | · |  |
| phone | varchar(50) | · |  |
| position | varchar(255) | · |  |
| department | varchar(255) | · |  |
| password_hash | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| last_active_at | timestamp | · |  |
| permissions | jsonb | · | = '[]' |
| username | varchar(255) | · |  |
| status | varchar(20) | · | = 'offline' |
| avatar_url | text | · |  |
| org_id | varchar(50) | · |  |
| merged_into | varchar(50) | · |  |
| position_key | varchar(30) | · |  |
| pbx_ext | varchar(20) | · |  |

Индексы: `idx_agents_org`, `support_agents_telegram_id_key`

### `support_ai_chat_messages` · ~10 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| session_id | varchar(60) | **нет** |  |
| role | varchar(20) | **нет** |  |
| content | text | · |  |
| tool_name | varchar(60) | · |  |
| tool_args | jsonb | · |  |
| tool_result | jsonb | · |  |
| tokens_in | integer | · | = 0 |
| tokens_out | integer | · | = 0 |
| created_at | timestamptz | **нет** | = now() |

Индексы: `idx_chat_messages_session`

### `support_ai_chat_sessions` · ~3 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| user_id | varchar(60) | **нет** |  |
| title | varchar(255) | **нет** | = 'Без названия' |
| period_default | varchar(10) | · | = '7d' |
| source_default | varchar(20) | · | = 'all' |
| archived | boolean | **нет** | = false |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `idx_chat_sessions_user`

### `support_ai_events` · ~64 840 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | · |  |
| actor | varchar(30) | · |  |
| kind | varchar(30) | · |  |
| channel_id | varchar(60) | · |  |
| channel_name | varchar(255) | · |  |
| tier | varchar(20) | · |  |
| reasoning | text | · |  |
| payload | jsonb | · |  |
| mode | varchar(10) | · |  |
| created_at | timestamptz | · | = now() |

### `support_ai_patterns` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(100) | **нет** | PK |
| category | varchar(50) | **нет** |  |
| name | varchar(200) | · |  |
| data | jsonb | **нет** |  |
| is_active | boolean | · | = true |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

### `support_analytics_snapshot` · ~1 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| data | jsonb | **нет** |  |
| computed_at | timestamptz | · | = now() |

### `support_audit_log` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| agent_id | varchar(50) | · |  |
| action | varchar(100) | **нет** |  |
| resource_type | varchar(50) | · |  |
| resource_id | varchar(50) | · |  |
| details | jsonb | · | = '{}' |
| ip_address | varchar(45) | · |  |
| created_at | timestamp | · | = now() |

Индексы: `idx_audit_action`, `idx_audit_agent`, `idx_audit_created`, `idx_audit_org`, `idx_audit_org_created`

### `support_auto_templates` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| intent | varchar(50) | **нет** |  |
| template_text | text | **нет** |  |
| personalization_vars | ARRAY | · |  |
| tone | varchar(20) | · | = 'professional' |
| language | varchar(10) | · | = 'ru' |
| priority | integer | · | = 0 |
| is_active | boolean | · | = true |
| usage_count | integer | · | = 0 |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_templates_intent`

### `support_automations` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | **нет** |  |
| description | text | · |  |
| trigger_type | varchar(50) | **нет** |  |
| trigger_config | jsonb | **нет** | = '{}' |
| action_type | varchar(50) | **нет** |  |
| action_config | jsonb | **нет** | = '{}' |
| is_active | boolean | · | = true |
| priority | integer | · | = 0 |
| executions_count | integer | · | = 0 |
| last_executed_at | timestamp | · |  |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_automations_org`

### `support_broadcast_clicks` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| broadcast_id | varchar(64) | · | → support_broadcasts.id |
| channel_id | varchar(64) | · |  |
| user_id | bigint | · |  |
| link_url | text | · |  |
| clicked_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

### `support_broadcast_recipients` · ~3 223 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(80) | **нет** | PK |
| broadcast_id | varchar(60) | **нет** |  |
| org_id | varchar(50) | **нет** |  |
| channel_id | varchar(50) | **нет** |  |
| telegram_chat_id | bigint | · |  |
| channel_name | varchar(255) | · |  |
| status | varchar(20) | **нет** | = 'queued' |
| attempts | integer | **нет** | = 0 |
| last_attempt_at | timestamptz | · |  |
| retry_after_at | timestamptz | · |  |
| error_code | varchar(40) | · |  |
| error_message | text | · |  |
| telegram_message_id | bigint | · |  |
| delivered_at | timestamptz | · |  |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `idx_broadcast_recipients_broadcast_status`, `idx_broadcast_recipients_org_error`, `idx_broadcast_recipients_queue`, `uniq_broadcast_recipient_channel`

### `support_broadcast_scheduled` · ~33 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | · |  |
| message_text | text | **нет** |  |
| target_type | varchar(30) | · | = 'all' |
| target_filter | jsonb | · | = '{}' |
| scheduled_at | timestamp | · |  |
| status | varchar(20) | · | = 'draft' |
| sent_count | integer | · | = 0 |
| failed_count | integer | · | = 0 |
| total_recipients | integer | · | = 0 |
| created_by | varchar(50) | · |  |
| created_at | timestamp | · | = now() |
| executed_at | timestamp | · |  |
| notification_type | varchar(30) | · | = 'announcement' |
| sender_type | varchar(20) | · | = 'ai' |
| sender_id | varchar(64) | · |  |
| sender_name | varchar(255) | · |  |
| media_url | text | · |  |
| media_type | varchar(30) | · |  |
| recipients_count | integer | · | = 0 |
| delivered_count | integer | · | = 0 |
| viewed_count | integer | · | = 0 |
| reaction_count | integer | · | = 0 |
| org_id | varchar(50) | · |  |
| message_type | varchar(30) | · | = 'announcement' |
| filter_type | varchar(30) | · | = 'all' |
| selected_channels | ARRAY | · |  |
| timezone | varchar(50) | · | = 'Asia/Tashkent' |
| sent_at | timestamp | · |  |
| broadcast_id | varchar(50) | · |  |
| error_message | text | · |  |
| started_at | timestamptz | · |  |
| completed_at | timestamptz | · |  |
| last_worker_at | timestamptz | · |  |
| queued_count | integer | **нет** | = 0 |

### `support_broadcast_stats` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| broadcast_id | varchar(50) | · |  |
| channel_id | varchar(50) | · |  |
| status | varchar(20) | · | = 'pending' |
| sent_at | timestamp | · |  |
| error_message | text | · |  |
| created_at | timestamp | · | = now() |

### `support_broadcasts` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| title | varchar(255) | **нет** |  |
| message | text | **нет** |  |
| target_type | varchar(50) | · | = 'all' |
| target_filter | jsonb | · | = '{}' |
| status | varchar(30) | · | = 'draft' |
| sent_count | integer | · | = 0 |
| delivered_count | integer | · | = 0 |
| read_count | integer | · | = 0 |
| click_count | integer | · | = 0 |
| created_by | varchar(64) | · |  |
| created_at | timestamp | · | = now() |
| sent_at | timestamp | · |  |
| completed_at | timestamp | · |  |
| org_id | varchar(50) | · |  |

Индексы: `idx_broadcasts_org`

### `support_case_activities` · ~8 203 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| case_id | varchar(50) | **нет** |  |
| manager_id | varchar(50) | · |  |
| type | varchar(50) | **нет** |  |
| title | varchar(255) | · |  |
| description | text | · |  |
| from_status | varchar(30) | · |  |
| to_status | varchar(30) | · |  |
| metadata | jsonb | · | = '{}' |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

### `support_case_activity` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(100) | **нет** | PK |
| case_id | varchar(100) | **нет** |  |
| activity_type | varchar(50) | · |  |
| actor_name | varchar(255) | · |  |
| actor_id | varchar(100) | · |  |
| details | jsonb | · | = '{}' |
| created_at | timestamp | · | = now() |

Индексы: `idx_case_activity_case`, `idx_case_activity_time`

### `support_case_comments` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| case_id | varchar(50) | **нет** |  |
| author_id | varchar(50) | · |  |
| author_name | varchar(255) | · |  |
| text | text | **нет** |  |
| is_internal | boolean | · | = false |
| created_at | timestamp | · | = now() |

Индексы: `idx_case_comments_case`

### `support_cases` · ~1 190 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(50) | · |  |
| company_id | varchar(50) | · |  |
| lead_id | varchar(50) | · |  |
| title | varchar(500) | **нет** |  |
| description | text | · |  |
| status | varchar(30) | · | = 'detected' |
| category | varchar(100) | · |  |
| subcategory | varchar(100) | · |  |
| root_cause | varchar(255) | · |  |
| priority | varchar(20) | · | = 'medium' |
| severity | varchar(20) | · | = 'normal' |
| assigned_to | varchar(50) | · |  |
| first_response_at | timestamp | · |  |
| resolved_at | timestamp | · |  |
| resolution_time_minutes | integer | · |  |
| resolution_notes | text | · |  |
| impact_mrr | numeric | · | = 0 |
| churn_risk_score | integer | · | = 0 |
| is_recurring | boolean | · | = false |
| related_case_id | varchar(50) | · |  |
| tags | ARRAY | · |  |
| metadata | jsonb | · | = '{}' |
| ticket_number | integer | · |  |
| source_message_id | varchar(64) | · |  |
| reporter_name | varchar(255) | · |  |
| updated_by | varchar(255) | · |  |
| created_by | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |
| market_id | varchar(50) | · |  |
| org_id | varchar(50) | · |  |
| is_shadow | boolean | · | = false |
| snoozed_until | timestamp | · |  |
| snoozed_by | varchar(255) | · |  |
| snooze_reason | text | · |  |
| topic | varchar(40) | · |  |

Индексы: `idx_cases_assigned`, `idx_cases_channel`, `idx_cases_company`, `idx_cases_created`, `idx_cases_is_shadow`, `idx_cases_market`, `idx_cases_org_channel`, `idx_cases_org_created`, `idx_cases_org_id`, `idx_cases_org_status`, `idx_cases_priority`, `idx_cases_snoozed`, `idx_cases_status`, `idx_cases_ticket_number`, `idx_support_cases_topic`

### `support_channels` · ~493 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| telegram_chat_id | bigint | · |  |
| name | varchar(255) | **нет** |  |
| type | varchar(20) | · | = 'client' |
| company_id | varchar(50) | · |  |
| lead_id | varchar(50) | · |  |
| is_active | boolean | · | = true |
| members_count | integer | · | = 0 |
| settings | jsonb | · | = '{}' |
| created_at | timestamp | · | = now() |
| last_message_at | timestamp | · |  |
| last_client_message_at | timestamp | · |  |
| last_team_message_at | timestamp | · |  |
| last_agent_message_at | timestamp | · |  |
| awaiting_reply | boolean | · | = false |
| unread_count | integer | · | = 0 |
| last_sender_name | varchar(255) | · |  |
| last_message_preview | text | · |  |
| is_forum | boolean | · | = false |
| updated_at | timestamp | · | = now() |
| photo_url | text | · |  |
| sla_category | varchar(30) | · | = 'client' |
| client_avg_response_ms | integer | · |  |
| client_response_count | integer | · | = 0 |
| response_comparison | jsonb | · | = '{}' |
| source | varchar(20) | · | = 'telegram' |
| external_chat_id | varchar(100) | · |  |
| market_id | varchar(50) | · |  |
| org_id | varchar(50) | · |  |
| sla_state | varchar(20) | · |  |
| sla_alert_level | integer | · | = 0 |
| sla_last_alert_at | timestamptz | · |  |
| meta_page_id | varchar(50) | · |  |

Индексы: `idx_channels_awaiting`, `idx_channels_company`, `idx_channels_last_message`, `idx_channels_market`, `idx_channels_org_active`, `idx_channels_org_id`, `idx_channels_org_last_msg`, `idx_channels_org_source`, `idx_channels_sla_category`, `idx_channels_telegram`, `idx_channels_type`, `idx_channels_unread`, `support_channels_telegram_chat_id_key`

### `support_commitments` · ~4 392 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(100) | **нет** |  |
| case_id | varchar(100) | · |  |
| message_id | varchar(100) | · |  |
| agent_id | varchar(100) | · |  |
| agent_name | varchar(255) | · |  |
| sender_role | varchar(30) | · |  |
| commitment_text | text | **нет** |  |
| commitment_type | varchar(30) | · | = 'promise' |
| is_vague | boolean | · | = false |
| priority | varchar(20) | · | = 'medium' |
| due_date | timestamptz | · |  |
| reminder_at | timestamptz | · |  |
| reminder_sent | boolean | · | = false |
| status | varchar(20) | · | = 'pending' |
| notes | text | · |  |
| completed_at | timestamptz | · |  |
| created_at | timestamptz | · | = now() |
| updated_at | timestamptz | · | = now() |
| promised_by | varchar(255) | · |  |
| org_id | varchar(50) | · |  |

Индексы: `idx_commitments_agent`, `idx_commitments_channel`, `idx_commitments_due_date`, `idx_commitments_org`, `idx_commitments_org_status`, `idx_commitments_status`

### `support_conversation_sessions` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(50) | **нет** |  |
| started_at | timestamp | **нет** |  |
| ended_at | timestamp | · |  |
| purpose | varchar(50) | · |  |
| value_score | integer | · | = 0 |
| participants | ARRAY | · |  |
| message_count | integer | · | = 0 |
| agent_message_count | integer | · | = 0 |
| client_message_count | integer | · | = 0 |
| has_case | boolean | · | = false |
| case_id | varchar(50) | · |  |
| summary | text | · |  |
| market_id | varchar(50) | · |  |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_conv_sessions_channel`, `idx_conv_sessions_org`, `idx_conv_sessions_purpose`

### `support_conversations` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| channel_id | varchar(64) | **нет** |  |
| started_at | timestamp | **нет** | = now() |
| ended_at | timestamp | · |  |
| status | varchar(32) | · | = 'active' |
| first_response_at | timestamp | · |  |
| message_count | integer | · | = 0 |
| agent_id | varchar(64) | · |  |
| client_satisfaction | integer | · |  |
| org_id | varchar(50) | · |  |

Индексы: `idx_conversations_channel`, `idx_conversations_org`, `idx_conversations_status`

### `support_dialogs` · ~3 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(50) | · |  |
| org_id | varchar(50) | · |  |
| question_text | text | · |  |
| question_hash | varchar(20) | · |  |
| question_category | varchar(100) | · |  |
| answer_text | text | · |  |
| answer_by | varchar(255) | · |  |
| answer_type | varchar(20) | · | = 'manual' |
| used_count | integer | · | = 1 |
| last_used_at | timestamp | · | = now() |
| embedding | ARRAY | · |  |
| created_at | timestamp | · | = now() |

### `support_docs` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | integer | **нет** | PK |
| title | text | **нет** |  |
| content | text | · |  |
| url | text | **нет** |  |
| path | text | · |  |
| category | text | · |  |
| keywords | ARRAY | · |  |
| content_hash | text | · |  |
| synced_at | timestamp | · | = now() |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |
| embedding | ARRAY | · |  |
| updated_at | timestamp | · | = now() |

Индексы: `support_docs_url_key`

### `support_faq` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| question | text | **нет** |  |
| answer | text | **нет** |  |
| keywords | ARRAY | · |  |
| category | varchar(50) | · |  |
| intent_match | varchar(50) | · |  |
| language | varchar(10) | · | = 'ru' |
| is_active | boolean | · | = true |
| usage_count | integer | · | = 0 |
| last_used_at | timestamp | · |  |
| created_at | timestamp | · | = now() |

Индексы: `idx_faq_intent`, `idx_faq_keywords`

### `support_frt_overrides` · ~5 494 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| message_id | varchar(50) | **нет** |  |
| channel_id | varchar(50) | **нет** |  |
| override_type | varchar(20) | **нет** |  |
| frt_minutes | integer | · |  |
| note | text | · |  |
| created_by | varchar(50) | · |  |
| created_by_name | varchar(255) | · |  |
| created_at | timestamptz | · | = now() |
| updated_at | timestamptz | · | = now() |

Индексы: `idx_frt_overrides_org_msg`, `support_frt_overrides_org_id_message_id_key`

### `support_invites` · ~9 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| token | varchar(100) | **нет** |  |
| email | varchar(255) | · |  |
| role | varchar(20) | · | = 'agent' |
| created_by | varchar(50) | · |  |
| used_at | timestamp | · |  |
| used_by | varchar(50) | · |  |
| expires_at | timestamp | · |  |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_invites_org`, `support_invites_token_key`

### `support_issue_taxonomy` · ~79 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | integer | **нет** | PK |
| org_id | varchar(50) | · | = 'org_delever' |
| domain | varchar(50) | **нет** |  |
| subtype | varchar(80) | **нет** |  |
| issues | integer | **нет** |  |
| automatable_pct | integer | **нет** |  |
| computed_at | timestamptz | · | = now() |

### `support_markets` · ~5 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | **нет** |  |
| code | varchar(10) | **нет** |  |
| country | varchar(100) | · |  |
| timezone | varchar(50) | · | = 'Asia/Tashkent' |
| is_active | boolean | · | = true |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_markets_org`, `support_markets_code_key`

### `support_messages` · ~342 414 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(100) | **нет** | PK |
| channel_id | varchar(50) | · |  |
| case_id | varchar(50) | · |  |
| telegram_message_id | bigint | · |  |
| sender_id | varchar(100) | · |  |
| sender_name | varchar(255) | · |  |
| sender_username | varchar(100) | · |  |
| is_from_client | boolean | · | = true |
| content_type | varchar(30) | · | = 'text' |
| text_content | text | · |  |
| media_url | text | · |  |
| media_file_id | varchar(255) | · |  |
| transcript | text | · |  |
| transcript_language | varchar(10) | · |  |
| ai_summary | text | · |  |
| ai_category | varchar(100) | · |  |
| ai_sentiment | varchar(20) | · |  |
| ai_intent | varchar(100) | · |  |
| ai_urgency | integer | · | = 0 |
| ai_extracted_entities | jsonb | · | = '{}' |
| is_problem | boolean | · | = false |
| is_processed | boolean | · | = false |
| reply_to_message_id | bigint | · |  |
| sender_role | varchar(20) | · | = 'client' |
| is_read | boolean | · | = false |
| read_at | timestamp | · |  |
| manager_id | varchar(50) | · |  |
| thread_id | bigint | · |  |
| thread_name | varchar(255) | · |  |
| sender_photo_url | text | · |  |
| reactions | jsonb | · | = '{}' |
| reply_to_text | text | · |  |
| reply_to_sender | varchar(255) | · |  |
| sentiment_score | numeric | · |  |
| sentiment_change | varchar(20) | · |  |
| auto_reply_candidate | boolean | · | = false |
| response_time_ms | integer | · |  |
| thumbnail_url | text | · |  |
| file_name | text | · |  |
| file_size | bigint | · |  |
| mime_type | text | · |  |
| media_type | varchar(20) | · |  |
| created_at | timestamp | · | = now() |
| processed_at | timestamp | · |  |
| transcription | text | · |  |
| is_deleted | boolean | · | = false |
| deleted_at | timestamp | · |  |
| forwarded_from | text | · |  |
| org_id | varchar(50) | · |  |
| ai_domain | varchar(50) | · |  |
| ai_subcategory | varchar(100) | · |  |
| ai_theme | varchar(300) | · |  |
| ai_tags | ARRAY | · |  |
| external_message_id | varchar(255) | · |  |

Индексы: `idx_messages_case`, `idx_messages_channel`, `idx_messages_channel_created`, `idx_messages_channel_date`, `idx_messages_content_type`, `idx_messages_created`, `idx_messages_external`, `idx_messages_is_read`, `idx_messages_org`, `idx_messages_org_channel`, `idx_messages_org_channel_created`, `idx_messages_org_client`, `idx_messages_org_created`, `idx_messages_org_domain`, `idx_messages_org_sentiment`, `idx_messages_org_subcategory`, `idx_messages_problem`, `idx_messages_response_time`, `idx_messages_sender_role`, `idx_messages_telegram`, `idx_messages_thread`

### `support_meta_accounts` · ~2 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| page_id | varchar(50) | **нет** |  |
| page_name | varchar(200) | · |  |
| page_token | text | · |  |
| ig_user_id | varchar(50) | · |  |
| ig_username | varchar(100) | · |  |
| market_id | varchar(50) | · |  |
| subscribed | boolean | **нет** | = false |
| subscribe_error | text | · |  |
| connected_by | varchar(50) | · |  |
| connected_by_name | varchar(150) | · |  |
| connected_at | timestamptz | **нет** | = now() |
| is_active | boolean | **нет** | = true |
| updated_at | timestamptz | **нет** | = now() |
| leads_ok | boolean | · |  |

Индексы: `uq_meta_accounts_page`

### `support_meta_comments` · ~40 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| platform | varchar(20) | **нет** |  |
| comment_id | varchar(80) | **нет** |  |
| parent_id | varchar(80) | · |  |
| post_id | varchar(80) | · |  |
| page_id | varchar(50) | · |  |
| market_id | varchar(50) | · |  |
| author_id | varchar(80) | · |  |
| author_name | varchar(200) | · |  |
| text | text | · |  |
| permalink | text | · |  |
| is_hidden | boolean | **нет** | = false |
| is_ours | boolean | **нет** | = false |
| replied_at | timestamptz | · |  |
| replied_by | varchar(150) | · |  |
| reply_text | text | · |  |
| created_at | timestamptz | **нет** | = now() |
| seen_at | timestamptz | **нет** | = now() |
| ai_class | varchar(20) | · |  |
| ai_draft | text | · |  |
| ai_reason | text | · |  |
| ai_at | timestamptz | · |  |
| ai_auto | boolean | **нет** | = false |

Индексы: `idx_meta_comments_open`, `uq_meta_comments`

### `support_meta_forms` · ~18 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| form_id | varchar(50) | **нет** | PK |
| name | varchar(255) | · |  |
| page_id | varchar(50) | · |  |
| market_id | varchar(50) | · |  |
| suggested_market | varchar(50) | · |  |
| status | varchar(30) | · |  |
| leads_count | integer | **нет** | = 0 |
| last_lead_at | timestamptz | · |  |
| seen_at | timestamptz | **нет** | = now() |

### `support_meta_integration` · ~1 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| app_id | varchar(50) | · |  |
| app_secret | text | · |  |
| verify_token | text | · |  |
| page_id | varchar(50) | · |  |
| page_name | varchar(200) | · |  |
| page_token | text | · |  |
| ig_user_id | varchar(50) | · |  |
| ig_username | varchar(100) | · |  |
| scopes | text | · |  |
| connected_by | varchar(50) | · |  |
| connected_by_name | varchar(150) | · |  |
| connected_at | timestamptz | · |  |
| token_expires_at | timestamptz | · |  |
| updated_at | timestamptz | **нет** | = now() |
| user_token | text | · |  |
| user_name | varchar(150) | · |  |
| redirect_uri | text | · |  |

### `support_meta_oauth_state` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| state | varchar(80) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| agent_id | varchar(50) | · |  |
| created_at | timestamptz | **нет** | = now() |

### `support_meta_posts` · ~12 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| platform | varchar(20) | **нет** |  |
| post_id | varchar(80) | **нет** |  |
| page_id | varchar(50) | · |  |
| kind | varchar(20) | · |  |
| caption | text | · |  |
| thumb_url | text | · |  |
| permalink | text | · |  |
| published_at | timestamptz | · |  |
| fetched_at | timestamptz | **нет** | = now() |
| fetch_error | text | · |  |

Индексы: `uq_meta_posts`

### `support_notifications` · ~140 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| agent_id | varchar(60) | **нет** |  |
| type | varchar(30) | **нет** |  |
| title | varchar(255) | **нет** |  |
| body | text | · |  |
| priority | varchar(20) | · | = 'medium' |
| channel_id | varchar(60) | · |  |
| channel_name | varchar(255) | · |  |
| sender_name | varchar(255) | · |  |
| decision_id | varchar(60) | · |  |
| is_read | boolean | · | = false |
| read_at | timestamp | · |  |
| created_at | timestamp | · | = now() |
| escalated_at | timestamp | · |  |
| link | varchar(255) | · |  |

### `support_organizations` · ~1 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | **нет** |  |
| slug | varchar(100) | **нет** |  |
| logo_url | text | · |  |
| plan | varchar(50) | · | = 'starter' |
| telegram_bot_token | text | · |  |
| telegram_bot_username | varchar(100) | · |  |
| whatsapp_bridge_url | text | · |  |
| whatsapp_bridge_secret | text | · |  |
| openai_api_key | text | · |  |
| ai_model | varchar(100) | · | = 'gpt-4o-mini' |
| settings | jsonb | · | = '{}' |
| max_agents | integer | · | = 5 |
| max_channels | integer | · | = 50 |
| max_messages_per_month | integer | · | = 10000 |
| is_active | boolean | · | = true |
| trial_ends_at | timestamp | · |  |
| owner_agent_id | varchar(50) | · |  |
| custom_domain | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |

Индексы: `idx_org_slug`, `support_organizations_slug_key`

### `support_otp` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | integer | **нет** | PK |
| email | varchar(255) | **нет** |  |
| code | varchar(6) | **нет** |  |
| purpose | varchar(50) | · | = 'registration' |
| attempts | integer | · | = 0 |
| expires_at | timestamp | **нет** |  |
| verified_at | timestamp | · |  |
| created_at | timestamp | · | = now() |
| telegram_username | varchar(255) | · |  |
| company_name | varchar(255) | · |  |

Индексы: `idx_otp_email_unique`

### `support_platform_settings` · ~16 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| key | varchar(100) | **нет** | PK |
| value | text | · |  |
| updated_at | timestamp | · | = now() |

### `support_platform_users` · ~2 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | integer | **нет** | PK |
| telegram_id | varchar(50) | **нет** |  |
| username | varchar(255) | · |  |
| first_name | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| reg_code | varchar(10) | · |  |

Индексы: `support_platform_users_telegram_id_key`

### `support_positions` · ~5 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| key | varchar(30) | **нет** |  |
| label | varchar(120) | **нет** |  |
| department | varchar(30) | **нет** |  |
| description | text | · |  |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |

Индексы: `uq_positions`

### `support_problem_scans` · ~312 199 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | · |  |
| channel_id | varchar(60) | · |  |
| window_start | timestamptz | · |  |
| window_end | timestamptz | · |  |
| message_count | integer | · |  |
| is_problem | boolean | · |  |
| confidence | real | · |  |
| category | varchar(120) | · |  |
| severity | varchar(12) | · |  |
| title | text | · |  |
| summary | text | · |  |
| regex_flag | boolean | · |  |
| case_id | varchar(100) | · |  |
| mode | varchar(10) | · |  |
| created_at | timestamptz | · | = now() |

Индексы: `idx_problem_scans_channel`

### `support_reactions` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| message_id | varchar(50) | **нет** |  |
| channel_id | varchar(50) | **нет** |  |
| telegram_message_id | bigint | · |  |
| user_id | bigint | · |  |
| user_name | varchar(255) | · |  |
| emoji | varchar(50) | **нет** |  |
| is_from_bot | boolean | · | = false |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_reactions_message`, `idx_reactions_org`

### `support_reminders` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(50) | **нет** |  |
| case_id | varchar(50) | · |  |
| message_id | varchar(50) | · |  |
| commitment_text | text | **нет** |  |
| commitment_type | varchar(30) | · | = 'vague' |
| is_vague | boolean | · | = false |
| detected_deadline | timestamp | · |  |
| auto_deadline | timestamp | · |  |
| reminder_at | timestamp | · |  |
| escalation_level | integer | · | = 0 |
| assigned_to | varchar(50) | · |  |
| assigned_name | varchar(255) | · |  |
| status | varchar(20) | · | = 'active' |
| completed_at | timestamp | · |  |
| escalated_at | timestamp | · |  |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_reminders_deadline`, `idx_reminders_org`, `idx_reminders_status`

### `support_reply_examples` · ~8 390 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| client_text | text | **нет** |  |
| human_reply | text | **нет** |  |
| human_sender | varchar(120) | · |  |
| lang | varchar(8) | · |  |
| channel | varchar(200) | · |  |
| said_at | timestamptz | · |  |
| source | varchar(20) | **нет** | = 'triples' |
| created_at | timestamptz | **нет** | = now() |
| norm_text | text | · |  |

Индексы: `idx_reply_examples_norm`, `idx_reply_examples_trgm`

### `support_root_cause_analysis` · ~5 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| market_id | varchar(50) | · |  |
| period_key | varchar(10) | **нет** |  |
| cluster_key | varchar(100) | **нет** |  |
| cluster_label | varchar(255) | · |  |
| sample_count | integer | · | = 0 |
| root_cause | text | · |  |
| what_breaks | text | · |  |
| why_it_happens | text | · |  |
| severity | varchar(20) | · |  |
| affected_count | integer | · | = 0 |
| fix_steps | jsonb | · | = '[]' |
| tags | jsonb | · | = '[]' |
| affected_channels | jsonb | · | = '[]' |
| example_message_ids | jsonb | · | = '[]' |
| model | varchar(50) | · |  |
| generated_at | timestamp | · | = now() |

Индексы: `idx_rca_org_period`

### `support_settings` · ~23 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| key | varchar(100) | **нет** | PK |
| value | text | · |  |
| updated_at | timestamp | · | = now() |
| org_id | varchar(50) | **нет** | PK · = 'org_delever' |

Индексы: `idx_settings_org`, `support_settings_org_key`

### `support_solutions` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| case_id | varchar(50) | · |  |
| category | varchar(100) | · |  |
| subcategory | varchar(100) | · |  |
| problem_keywords | ARRAY | · |  |
| problem_pattern | text | · |  |
| solution_text | text | **нет** |  |
| solution_steps | jsonb | · | = '[]' |
| success_score | integer | · | = 3 |
| resolution_time_minutes | integer | · |  |
| used_count | integer | · | = 0 |
| helpful_votes | integer | · | = 0 |
| not_helpful_votes | integer | · | = 0 |
| created_by | varchar(50) | · |  |
| is_verified | boolean | · | = false |
| is_active | boolean | · | = true |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_solutions_category`, `idx_solutions_keywords`, `idx_solutions_org`

### `support_super_admins` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| email | varchar(255) | **нет** |  |
| name | varchar(255) | **нет** |  |
| password_hash | varchar(255) | **нет** |  |
| role | varchar(50) | · | = 'admin' |
| is_active | boolean | · | = true |
| last_login_at | timestamp | · |  |
| created_at | timestamp | · | = now() |

Индексы: `support_super_admins_email_key`

### `support_topics` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| channel_id | varchar(50) | **нет** |  |
| thread_id | bigint | **нет** |  |
| name | varchar(255) | · |  |
| icon_color | varchar(20) | · |  |
| is_closed | boolean | · | = false |
| messages_count | integer | · | = 0 |
| last_message_at | timestamp | · |  |
| last_sender_name | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| org_id | varchar(50) | · |  |

Индексы: `idx_topics_channel`, `idx_topics_org`, `support_topics_channel_id_thread_id_key`

### `support_users` · ~2 246 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(100) | **нет** | PK |
| telegram_id | bigint | · |  |
| telegram_username | varchar(255) | · |  |
| name | varchar(255) | **нет** |  |
| photo_url | text | · |  |
| role | varchar(50) | · | = 'client' |
| department | varchar(100) | · |  |
| position | varchar(255) | · |  |
| is_active | boolean | · | = true |
| notes | text | · |  |
| channels | jsonb | · | = '[]' |
| metrics | jsonb | · | = '{}' |
| first_seen_at | timestamp | · | = now() |
| last_seen_at | timestamp | · | = now() |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |
| resolved_issues | jsonb | · | = '[]' |
| recurring_problems | ARRAY | · |  |
| communication_style | varchar(20) | · | = 'neutral' |
| avg_satisfaction | numeric | · |  |
| total_conversations | integer | · | = 0 |
| last_issue_summary | text | · |  |
| phone | varchar(50) | · |  |
| market_id | varchar(50) | · |  |
| org_id | varchar(50) | · |  |

Индексы: `idx_users_org_id`, `idx_users_phone`, `idx_users_role`, `idx_users_telegram`, `support_users_telegram_id_key`

## Продажи (36)

### `sales_accounts` · ~5 722 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| name | varchar(255) | **нет** |  |
| market_id | varchar(50) | · |  |
| city | varchar(100) | · |  |
| inn | varchar(20) | · |  |
| merchant_id | varchar(50) | · |  |
| channel_id | varchar(50) | · |  |
| onboarding_brand_id | varchar(50) | · |  |
| lifecycle | varchar(20) | **нет** | = 'lead' |
| account_type | varchar(20) | **нет** | = 'client' |
| partner_kind | varchar(30) | · |  |
| partner_program_id | varchar(50) | · |  |
| partner_terms | jsonb | · |  |
| referred_by_account_id | varchar(50) | · |  |
| owner_agent_id | varchar(50) | · |  |
| launched_at | timestamptz | · |  |
| first_order_at | timestamptz | · |  |
| notes | text | · |  |
| created_at | timestamptz | **нет** | = now() |
| archived_at | timestamptz | · |  |
| country | varchar(50) | · |  |
| segment | varchar(50) | · |  |
| website | varchar(200) | · |  |
| instagram | varchar(120) | · |  |
| telegram | varchar(120) | · |  |
| legal_name | varchar(255) | · |  |
| legal_address | text | · |  |
| bank_name | varchar(255) | · |  |
| bank_code | varchar(30) | · |  |
| bank_account | varchar(50) | · |  |
| tax_code | varchar(30) | · |  |
| signer_name | varchar(255) | · |  |
| signer_title | varchar(120) | · |  |
| signer_basis | varchar(120) | · |  |

Индексы: `idx_sales_accounts_channel`, `idx_sales_accounts_merchant`, `idx_sales_accounts_org`, `idx_sales_accounts_partner`, `idx_sales_accounts_referrer`

### `sales_activities` · ~48 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| deal_id | varchar(50) | · |  |
| account_id | varchar(50) | · |  |
| type | varchar(20) | **нет** |  |
| direction | varchar(10) | · |  |
| result | varchar(50) | · |  |
| text | text | · |  |
| message_id | varchar(50) | · |  |
| agent_id | varchar(50) | · |  |
| happened_at | timestamptz | **нет** | = now() |

Индексы: `idx_sales_activities_deal`

### `sales_assistant_log` · ~1 191 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(64) | **нет** |  |
| lead_id | varchar(64) | · |  |
| deal_id | varchar(64) | · |  |
| account_id | varchar(64) | · |  |
| action | varchar(40) | **нет** |  |
| channel | varchar(30) | · |  |
| step | integer | · | = 0 |
| message | text | · |  |
| reply | text | · |  |
| status | varchar(20) | · | = 'sent' |
| error | text | · |  |
| created_at | timestamp | · | = now() |

Индексы: `idx_sales_assistant_log_lead`, `idx_sales_assistant_log_time`

### `sales_call_insights` · ~29 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| call_uuid | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| status | varchar(16) | **нет** | = 'pending' |
| talk_sec | integer | · |  |
| lead_id | varchar(60) | · |  |
| transcript | text | · |  |
| summary | text | · |  |
| coach | text | · |  |
| error | text | · |  |
| created_at | timestamp | · | = now() |
| done_at | timestamp | · |  |

Индексы: `idx_call_insights_pending`

### `sales_contacts` · ~3 257 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| account_id | varchar(50) | **нет** |  |
| name | varchar(255) | · |  |
| role | varchar(100) | · |  |
| phone | varchar(50) | · |  |
| phone_norm | varchar(20) | · |  |
| telegram | varchar(100) | · |  |
| email | varchar(255) | · |  |
| is_primary | boolean | **нет** | = false |
| created_at | timestamptz | **нет** | = now() |

Индексы: `idx_sales_contacts_account`, `idx_sales_contacts_phone`

### `sales_deal_events` · ~4 627 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| deal_id | varchar(50) | **нет** |  |
| old_stage_id | varchar(50) | · |  |
| new_stage_id | varchar(50) | · |  |
| changed_by | varchar(255) | · |  |
| changed_at | timestamptz | **нет** | = now() |

Индексы: `idx_sales_events_deal`

### `sales_deals` · ~4 172 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| account_id | varchar(50) | **нет** |  |
| stage_id | varchar(50) | **нет** |  |
| owner_agent_id | varchar(50) | · |  |
| market_id | varchar(50) | · |  |
| title | varchar(255) | · |  |
| deal_type | varchar(20) | **нет** | = 'new' |
| pipeline | varchar(20) | **нет** | = 'sales' |
| source_lead_id | varchar(50) | · |  |
| external_id | varchar(120) | · |  |
| city | varchar(100) | · |  |
| points | integer | · |  |
| orders_per_day | varchar(50) | · |  |
| pos | varchar(100) | · |  |
| aggregators | varchar(255) | · |  |
| delivery_type | varchar(50) | · |  |
| pain | text | · |  |
| dm_name | varchar(255) | · |  |
| dm_confirmed | boolean | · |  |
| meeting_at | timestamptz | · |  |
| tariff | varchar(50) | · |  |
| items | jsonb | · |  |
| budget_stated | numeric | · |  |
| monthly_amount | numeric | · |  |
| onetime_amount | numeric | · |  |
| currency | varchar(10) | **нет** | = 'USD' |
| amount_usd | numeric | · |  |
| discount_pct | numeric | · |  |
| term_months | integer | · |  |
| valid_till | date | · |  |
| kp_file | varchar(500) | · |  |
| legal_name | varchar(255) | · |  |
| start_date | date | · |  |
| paid_at | timestamptz | · |  |
| expected_close_at | date | · |  |
| probability | integer | · |  |
| next_step | varchar(500) | · |  |
| next_step_at | timestamptz | · |  |
| stage_since | timestamptz | **нет** | = now() |
| stalled_at | timestamptz | · |  |
| approval_state | varchar(20) | · |  |
| won_at | timestamptz | · |  |
| lost_at | timestamptz | · |  |
| lost_reason_id | varchar(50) | · |  |
| lost_comment | text | · |  |
| reactivate_at | timestamptz | · |  |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |
| archived_at | timestamp | · |  |
| segment | varchar(50) | · |  |
| dm_role | varchar(50) | · |  |
| lost_stage | varchar(30) | · |  |
| onboarding_spec | jsonb | · |  |
| spec_updated_at | timestamptz | · |  |
| spec_updated_by | varchar(150) | · |  |

Индексы: `idx_sales_deals_account`, `idx_sales_deals_forecast`, `idx_sales_deals_owner`, `idx_sales_deals_react`, `idx_sales_deals_stage`, `uq_sales_deals_external`

### `sales_doc_counters` · ~1 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| kind | varchar(20) | **нет** | PK |
| year | integer | **нет** | PK |
| last_seq | integer | **нет** | = 0 |

### `sales_doc_templates` · ~8 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| kind | varchar(20) | **нет** | = 'contract' |
| market_id | varchar(50) | · |  |
| pipeline | varchar(20) | **нет** | = 'sales' |
| entity | jsonb | · |  |
| number_format | varchar(50) | · |  |
| name | varchar(150) | **нет** |  |
| body | text | **нет** |  |
| is_default | boolean | **нет** | = false |
| is_active | boolean | **нет** | = true |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `uq_sales_doc_templates_kind`

### `sales_document_views` · ~3 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| document_id | varchar(50) | **нет** |  |
| opened_at | timestamptz | **нет** | = now() |
| seconds | integer | **нет** | = 0 |
| viewer_hash | varchar(64) | · |  |
| user_agent | varchar(255) | · |  |
| referrer | varchar(255) | · |  |

Индексы: `idx_sales_docviews_doc`

### `sales_documents` · ~8 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| deal_id | varchar(50) | · |  |
| account_id | varchar(50) | · |  |
| kind | varchar(20) | **нет** | = 'quote' |
| number | varchar(50) | · |  |
| version | integer | **нет** | = 1 |
| parent_id | varchar(50) | · |  |
| status | varchar(20) | **нет** | = 'draft' |
| title | varchar(255) | · |  |
| lines | jsonb | **нет** | = '[]' |
| conditions | jsonb | **нет** | = '[]' |
| requisites | jsonb | **нет** | = '{}' |
| body | text | · |  |
| subtotal | numeric | · |  |
| discount_pct | numeric | · |  |
| total | numeric | · |  |
| currency | varchar(10) | **нет** | = 'USD' |
| valid_till | date | · |  |
| share_token | varchar(64) | · |  |
| file_url | text | · |  |
| template_id | varchar(50) | · |  |
| opened_count | integer | **нет** | = 0 |
| read_seconds | integer | **нет** | = 0 |
| first_opened_at | timestamptz | · |  |
| last_opened_at | timestamptz | · |  |
| sent_at | timestamptz | · |  |
| accepted_at | timestamptz | · |  |
| signed_at | timestamptz | · |  |
| paid_at | timestamptz | · |  |
| created_by | varchar(50) | · |  |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |
| materials | jsonb | · |  |

Индексы: `idx_sales_docs_deal`, `idx_sales_docs_org`, `uq_sales_docs_token`

### `sales_field_options` · ~454 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(64) | **нет** |  |
| field | varchar(50) | **нет** |  |
| value | varchar(120) | **нет** |  |
| label | varchar(120) | **нет** |  |
| market_id | varchar(10) | · |  |
| sort_order | integer | · | = 0 |
| is_active | boolean | · | = true |
| created_at | timestamp | · | = now() |

Индексы: `idx_sales_field_options_field`, `uq_sales_field_options`

### `sales_fx_rates` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| currency | varchar(10) | **нет** |  |
| rate_to_usd | numeric | **нет** |  |
| valid_from | date | **нет** |  |
| created_at | timestamptz | **нет** | = now() |

### `sales_kpi_adjustments` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| month | date | **нет** |  |
| agent_id | varchar(80) | **нет** |  |
| amount | bigint | **нет** |  |
| reason | text | **нет** |  |
| created_by | varchar(80) | · |  |
| created_at | timestamp | · | = now() |

### `sales_kpi_closures` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| month | date | **нет** | PK |
| payload | jsonb | **нет** |  |
| closed_by | varchar(80) | · |  |
| closed_at | timestamp | · | = now() |

### `sales_kpi_plans` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| month | date | **нет** | PK |
| agent_id | varchar(80) | **нет** | PK |
| fix_salary | bigint | **нет** | = 0 |
| plan_amount | bigint | **нет** | = 0 |

### `sales_kpi_templates` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| month | date | **нет** | PK |
| budget | bigint | **нет** | = 2000000 |
| metrics | jsonb | **нет** | = '[]' |
| commission_below | numeric | **нет** | = 10 |
| commission_above | numeric | **нет** | = 15 |
| rop_agent_id | varchar(80) | · |  |
| rop_fix | bigint | **нет** | = 0 |
| rop_percent | numeric | **нет** | = 4 |
| team_plan | bigint | **нет** | = 0 |
| enterprise_plan | bigint | **нет** | = 0 |
| region_plans | jsonb | **нет** | = '{}' |
| status | varchar(20) | **нет** | = 'active' |
| closed_at | timestamp | · |  |
| closed_by | varchar(80) | · |  |
| updated_at | timestamp | · | = now() |

### `sales_leads` · ~3 177 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| source_id | varchar(50) | · |  |
| external_id | varchar(120) | · |  |
| account_id | varchar(50) | · |  |
| name | varchar(255) | · |  |
| phone | varchar(50) | · |  |
| phone_norm | varchar(20) | · |  |
| contact_name | varchar(255) | · |  |
| market_id | varchar(50) | · |  |
| campaign | varchar(255) | · |  |
| form_id | varchar(80) | · |  |
| ad_id | varchar(80) | · |  |
| text | text | · |  |
| raw | jsonb | · |  |
| icp_score | integer | · |  |
| icp_reasons | jsonb | · |  |
| status | varchar(20) | **нет** | = 'new' |
| assigned_agent_id | varchar(50) | · |  |
| assigned_at | timestamptz | · |  |
| first_touch_at | timestamptz | · |  |
| sla_due_at | timestamptz | · |  |
| created_at | timestamptz | **нет** | = now() |
| city | varchar(100) | · |  |
| archived_at | timestamp | · |  |
| updated_at | timestamp | · | = now() |
| utm_source | varchar(120) | · |  |
| utm_medium | varchar(120) | · |  |
| utm_campaign | varchar(200) | · |  |
| utm_content | varchar(200) | · |  |
| click_id | varchar(200) | · |  |
| landing_url | text | · |  |
| referrer | text | · |  |
| lead_kind | varchar(20) | · |  |
| nurture_step | integer | · | = 0 |
| nurture_next_at | timestamp | · |  |
| nurture_paused_at | timestamp | · |  |
| lost_reason_id | varchar(50) | · |  |
| lost_comment | text | · |  |
| qual | jsonb | · |  |
| lost_stage | varchar(30) | · |  |
| sla_handoff_at | timestamptz | · |  |
| sla_handoffs | integer | · | = 0 |

Индексы: `idx_sales_leads_phone`, `idx_sales_leads_sla`, `idx_sales_leads_status`, `uq_sales_leads_external_id`

### `sales_legal_docs` · ~12 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| kind | varchar(30) | **нет** |  |
| market_id | varchar(50) | · |  |
| lang | varchar(5) | **нет** | = 'ru' |
| title | varchar(200) | **нет** |  |
| url | text | **нет** |  |
| version | varchar(30) | · |  |
| effective_from | date | · |  |
| is_active | boolean | **нет** | = true |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `idx_sales_legal_docs`, `uq_sales_legal_docs_url`

### `sales_legal_entities` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| market_id | varchar(50) | · |  |
| name | varchar(255) | **нет** |  |
| legal_name | varchar(255) | · |  |
| legal_address | text | · |  |
| tax_code | varchar(30) | · |  |
| bank_name | varchar(255) | · |  |
| bank_code | varchar(30) | · |  |
| bank_account | varchar(50) | · |  |
| signer_name | varchar(255) | · |  |
| signer_title | varchar(120) | · |  |
| signer_basis | varchar(120) | · |  |
| requisites | text | · |  |
| is_default | boolean | **нет** | = false |
| is_active | boolean | **нет** | = true |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `idx_sales_legal_entities_org`

### `sales_lost_reasons` · ~26 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| code | varchar(50) | **нет** |  |
| label | varchar(150) | **нет** |  |
| reactivate_days | integer | · |  |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |

Индексы: `uq_sales_reasons_code`

### `sales_market_settings` · ~14 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| market_id | varchar(50) | **нет** | PK |
| currency | varchar(10) | **нет** |  |
| legal_entity | varchar(150) | · |  |
| contract_template_kind | varchar(30) | · |  |
| is_active | boolean | **нет** | = true |

### `sales_materials` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(60) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| title | varchar(200) | **нет** |  |
| description | text | · |  |
| url | text | **нет** |  |
| kind | varchar(30) | **нет** | = 'presentation' |
| markets | ARRAY | · |  |
| default_on | boolean | **нет** | = false |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |
| opened_count | integer | **нет** | = 0 |
| created_at | timestamptz | **нет** | = now() |

### `sales_partner_programs` · ~12 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| key | varchar(50) | **нет** |  |
| name | varchar(150) | **нет** |  |
| model | varchar(20) | **нет** | = 'revshare' |
| rate_pct | numeric | · |  |
| bounty_amount | numeric | · |  |
| bounty_currency | varchar(10) | · |  |
| duration_months | integer | · |  |
| payout_rule | varchar(20) | **нет** | = 'always' |
| attribution_days | integer | · |  |
| exclusive_territory | boolean | **нет** | = false |
| min_deals_per_quarter | integer | · |  |
| notes | text | · |  |
| is_active | boolean | **нет** | = true |
| sort_order | integer | **нет** | = 0 |

Индексы: `uq_sales_partner_programs_key`

### `sales_payments` · ~24 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| deal_id | varchar(80) | · |  |
| agent_id | varchar(80) | · |  |
| amount | bigint | **нет** |  |
| paid_at | date | **нет** |  |
| source | varchar(20) | **нет** | = 'manual' |
| note | text | · |  |
| created_by | varchar(80) | · |  |
| created_at | timestamp | · | = now() |
| external_id | varchar(80) | · |  |

Индексы: `sales_payments_org_paid`

### `sales_pbx_events` · ~6 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| caller | varchar(64) | · |  |
| callee | varchar(64) | · |  |
| event | varchar(64) | · |  |
| raw | jsonb | · |  |
| created_at | timestamp | · | = now() |

Индексы: `idx_pbx_events_org_at`

### `sales_pbx_seats` · ~21 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| org_id | text | **нет** |  |
| ext | text | **нет** |  |
| agent_id | text | **нет** |  |
| agent_name | text | · |  |
| taken_at | timestamptz | **нет** | = now() |
| renewed_at | timestamptz | **нет** | = now() |
| released_at | timestamptz | · |  |

Индексы: `idx_pbx_seats_lookup`

### `sales_pf_clients` · ~472 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| client_key | text | **нет** | PK |
| title | text | · |  |
| first_paid_at | date | **нет** |  |
| last_paid_at | date | **нет** |  |
| ops_count | integer | **нет** | = 0 |
| total_paid | bigint | **нет** | = 0 |

### `sales_pf_inbox` · ~566 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** | PK |
| pf_operation_id | bigint | **нет** | PK |
| operation_date | date | **нет** |  |
| amount | bigint | **нет** |  |
| contragent | text | · |  |
| comment | text | · |  |
| account | text | · |  |
| category | text | · |  |
| status | varchar(20) | **нет** | = 'new' |
| deal_id | varchar(80) | · |  |
| payment_id | bigint | · |  |
| created_at | timestamp | · | = now() |
| currency | varchar(8) | · | = 'UZS' |
| amount_original | bigint | · |  |

### `sales_pipelines` · ~25 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(64) | **нет** |  |
| key | varchar(50) | **нет** |  |
| label | varchar(120) | **нет** |  |
| market_id | varchar(10) | · |  |
| kind | varchar(20) | · | = 'sales' |
| description | text | · |  |
| sort_order | integer | · | = 0 |
| is_active | boolean | · | = true |
| created_at | timestamp | · | = now() |

Индексы: `uq_sales_pipelines_key`

### `sales_price_items` · ~36 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| key | varchar(50) | **нет** |  |
| name | varchar(200) | **нет** |  |
| description | text | · |  |
| category | varchar(20) | **нет** | = 'module' |
| unit | varchar(50) | · |  |
| unit_kind | varchar(20) | **нет** | = 'flat' |
| recurring | varchar(20) | **нет** | = 'monthly' |
| prices | jsonb | **нет** | = '{}' |
| included_orders | integer | · |  |
| extra_order_price | jsonb | · |  |
| markets | jsonb | · |  |
| is_active | boolean | **нет** | = true |
| sort_order | integer | **нет** | = 0 |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `uq_sales_price_items_key`

### `sales_site_analytics` · ~22 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(64) | **нет** | PK |
| day | date | **нет** | PK |
| views | integer | · |  |
| uniques | integer | · |  |
| sessions | integer | · |  |
| median_seconds | integer | · |  |
| leads | integer | · |  |
| new_visitors | integer | · |  |
| returning_visitors | integer | · |  |
| devices | jsonb | · | = '{}' |
| os | jsonb | · | = '{}' |
| langs | jsonb | · | = '{}' |
| top_pages | jsonb | · | = '[]' |
| interests | jsonb | · | = '[]' |
| sources | jsonb | · | = '[]' |
| countries | jsonb | · | = '[]' |
| engagement | jsonb | · | = '[]' |
| hot_visitors | jsonb | · | = '[]' |
| ab_tests | jsonb | · | = '[]' |
| raw | text | · |  |
| created_at | timestamp | · | = now() |

### `sales_sources` · ~39 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| key | varchar(50) | **нет** |  |
| label | varchar(150) | **нет** |  |
| kind | varchar(20) | **нет** | = 'inbound' |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |

Индексы: `uq_sales_sources_key`

### `sales_stages` · ~252 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| key | varchar(50) | **нет** |  |
| label | varchar(100) | **нет** |  |
| kind | varchar(20) | **нет** | = 'open' |
| owner_role | varchar(20) | **нет** | = 'ae' |
| sla_hours | numeric | · |  |
| required_fields | jsonb | **нет** | = '[]' |
| cadence | jsonb | **нет** | = '[]' |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |
| probability | integer | **нет** | = 0 |
| pipeline | varchar(20) | **нет** | = 'sales' |
| description | text | · |  |

Индексы: `uq_sales_stages_pipeline_key`

### `sales_tasks` · ~31 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| deal_id | varchar(50) | · |  |
| account_id | varchar(50) | · |  |
| lead_id | varchar(50) | · |  |
| kind | varchar(20) | **нет** | = 'manual' |
| title | varchar(500) | **нет** |  |
| channel | varchar(20) | · |  |
| due_at | timestamptz | · |  |
| done_at | timestamptz | · |  |
| done_result | varchar(50) | · |  |
| assignee_agent_id | varchar(50) | · |  |
| cadence_step | integer | · |  |
| auto | boolean | **нет** | = false |
| created_at | timestamptz | **нет** | = now() |
| reminded_at | timestamptz | · |  |
| created_by_agent_id | varchar(60) | · |  |
| status | varchar(20) | **нет** | = 'open' |
| status_note | text | · |  |
| status_at | timestamptz | · |  |

Индексы: `idx_sales_tasks_due`

### `sales_touchpoints` · ~317 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(64) | **нет** |  |
| account_id | varchar(64) | · |  |
| lead_id | varchar(64) | · |  |
| deal_id | varchar(64) | · |  |
| kind | varchar(40) | **нет** |  |
| channel | varchar(40) | · |  |
| title | varchar(300) | · |  |
| detail | text | · |  |
| url | text | · |  |
| identity | varchar(200) | · |  |
| meta | jsonb | · | = '{}' |
| happened_at | timestamp | **нет** | = now() |
| created_at | timestamp | · | = now() |

Индексы: `idx_sales_touchpoints_account`, `idx_sales_touchpoints_identity`

## Подключения (12)

### `onboarding_brands` · ~26 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| name | varchar(255) | **нет** |  |
| pos_id | varchar(50) | · |  |
| channel_id | varchar(50) | · |  |
| owner_name | varchar(255) | · |  |
| notes | text | · |  |
| started_at | timestamptz | **нет** | = now() |
| archived_at | timestamptz | · |  |
| created_at | timestamptz | **нет** | = now() |
| assignee_id | varchar(64) | · |  |
| assignee_name | varchar(255) | · |  |
| next_step | text | · |  |
| depends_on | text | · |  |
| blockers | text | · |  |
| tariff | varchar(100) | · |  |
| launch_due | date | · |  |
| market_id | varchar(50) | · |  |
| connection_type | varchar(30) | · |  |
| parent_brand_id | varchar(50) | · |  |
| portal_token | varchar(40) | · |  |

Индексы: `idx_ob_brands_org`

### `onboarding_comments` · ~16 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| brand_id | varchar(50) | **нет** |  |
| author_id | varchar(64) | · |  |
| author_name | varchar(255) | · |  |
| text | text | **нет** |  |
| created_at | timestamptz | **нет** | = now() |

Индексы: `idx_ob_comments_brand`

### `onboarding_option_categories` · ~11 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| label | varchar(100) | **нет** |  |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |

### `onboarding_options` · ~70 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| category_id | varchar(50) | **нет** |  |
| label | varchar(100) | **нет** |  |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |
| markets | text | · |  |
| guide_url | text | · |  |

### `onboarding_participants` · ~74 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** |  |
| brand_id | varchar(50) | **нет** |  |
| agent_id | varchar(64) | · |  |
| name | varchar(255) | **нет** |  |
| source | varchar(10) | **нет** | = 'auto' |
| added_at | timestamptz | **нет** | = now() |

Индексы: `uq_ob_participants`

### `onboarding_pos_systems` · ~16 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| name | varchar(100) | **нет** |  |
| is_active | boolean | **нет** | = true |

### `onboarding_pos_task_map` · ~154 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| org_id | varchar(50) | **нет** |  |
| pos_id | varchar(50) | **нет** | PK |
| task_type_id | varchar(50) | **нет** | PK |

### `onboarding_statuses` · ~6 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| label | varchar(100) | **нет** |  |
| kind | varchar(20) | **нет** | = 'todo' |
| color | varchar(20) | **нет** | = 'gray' |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |

### `onboarding_task_events` · ~458 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| brand_id | varchar(50) | **нет** |  |
| task_type_id | varchar(50) | **нет** |  |
| old_status_id | varchar(50) | · |  |
| new_status_id | varchar(50) | · |  |
| changed_by | varchar(255) | · |  |
| changed_at | timestamptz | **нет** | = now() |
| option_id | varchar(50) | · |  |

Индексы: `idx_ob_events_brand`

### `onboarding_task_types` · ~20 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| label | varchar(100) | **нет** |  |
| sort_order | integer | **нет** | = 0 |
| is_active | boolean | **нет** | = true |
| option_category_id | varchar(50) | · |  |
| group_label | varchar(100) | · |  |
| target_days | integer | · |  |
| owner_agent_id | varchar(64) | · |  |
| owner_name | varchar(255) | · |  |
| guide_url | text | · |  |

### `onboarding_tasks` · ~471 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| brand_id | varchar(50) | **нет** |  |
| task_type_id | varchar(50) | **нет** |  |
| status_id | varchar(50) | · |  |
| assignee_name | varchar(255) | · |  |
| status_since | timestamptz | **нет** | = now() |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |
| assignee_id | varchar(64) | · |  |
| option_id | varchar(50) | · |  |
| waiting_on | varchar(12) | · |  |

Индексы: `idx_ob_tasks_brand`, `uq_ob_tasks_brand_type_option`

### `onboarding_todos` · ~4 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| brand_id | varchar(50) | **нет** |  |
| text | text | **нет** |  |
| assignee_id | varchar(64) | · |  |
| assignee_name | varchar(255) | · |  |
| due_at | timestamptz | · |  |
| done_at | timestamptz | · |  |
| created_by | varchar(255) | · |  |
| created_at | timestamptz | **нет** | = now() |
| created_by_id | varchar(60) | · |  |

Индексы: `idx_ob_todos_brand`

## Бенчмарки (1)

### `benchmark_targets` · ~60 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| metric_key | varchar(80) | **нет** |  |
| scope_role | varchar(20) | · |  |
| scope_market | varchar(20) | · |  |
| scope_source | varchar(20) | · |  |
| period_type | varchar(20) | **нет** | = 'monthly' |
| tier | varchar(20) | **нет** |  |
| target_value | float8 | **нет** |  |
| source_type | varchar(30) | **нет** | = 'manual' |
| sample_size | integer | · |  |
| computed_at | timestamp | · |  |
| set_by | varchar(50) | · |  |
| set_at | timestamp | · | = now() |
| notes | text | · |  |

Индексы: `idx_benchmark_org_metric`, `uq_benchmark_scope`

## Учёт работы (1)

### `work_items` · ~579 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| org_id | varchar(50) | **нет** |  |
| case_id | varchar(64) | · |  |
| channel_id | varchar(50) | · |  |
| parent_id | varchar(64) | · |  |
| source | varchar(20) | **нет** | = 'case' |
| title | text | · |  |
| topic | varchar(40) | · |  |
| client_name | varchar(200) | · |  |
| status | varchar(24) | **нет** | = 'phantom' |
| owner_agent_id | varchar(50) | · |  |
| owner_name | varchar(120) | · |  |
| started_at | timestamptz | **нет** | = now() |
| first_touch_at | timestamptz | · |  |
| last_activity_at | timestamptz | · |  |
| await_since | timestamptz | · |  |
| confirmed_at | timestamptz | · |  |
| confirmed_by | varchar(50) | · |  |
| closed_at | timestamptz | · |  |
| active_minutes | integer | · |  |
| offchat_minutes | integer | · |  |
| more_work | boolean | · |  |
| reopened_count | integer | **нет** | = 0 |
| ask_stage | varchar(12) | · |  |
| tg_chat_id | bigint | · |  |
| tg_message_id | bigint | · |  |
| created_at | timestamptz | **нет** | = now() |
| updated_at | timestamptz | **нет** | = now() |

Индексы: `idx_work_items_owner`, `idx_work_items_status`, `uq_work_items_case`

## Системный журнал (2)

### `system_events` · ~916 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | bigint | **нет** | PK |
| actor | varchar(60) | **нет** |  |
| action | varchar(60) | **нет** |  |
| summary | text | **нет** |  |
| ref | varchar(200) | · |  |
| meta | jsonb | · |  |
| at | timestamptz | **нет** | = now() |

Индексы: `idx_system_events_actor`, `idx_system_events_at`

### `system_incidents` · ~224 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(64) | **нет** | PK |
| kind | varchar(24) | **нет** |  |
| system | varchar(120) | **нет** |  |
| title | text | · |  |
| status | varchar(16) | **нет** | = 'open' |
| first_seen | timestamptz | **нет** |  |
| last_seen | timestamptz | **нет** |  |
| count | integer | **нет** | = 1 |
| sample | text | · |  |
| source_ref | varchar(200) | · |  |
| confidence | real | · |  |
| created_at | timestamptz | **нет** | = now() |
| resolved_at | timestamptz | · |  |

Индексы: `idx_system_incidents_open`

## Ошибки заказов (1)

### `order_errors` · ~81 549 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| msg_id | varchar(64) | **нет** | PK |
| restaurant | varchar(200) | · |  |
| service | varchar(80) | · |  |
| source | varchar(80) | · |  |
| error_text | text | · |  |
| error_class | varchar(180) | · |  |
| crm_id | varchar(80) | · |  |
| error_at | timestamptz | · |  |
| msg_at | timestamptz | **нет** |  |
| created_at | timestamptz | **нет** | = now() |

Индексы: `idx_order_errors_at`, `idx_order_errors_class`, `idx_order_errors_rest`

## Прочее (40)

### `ActivationMilestone` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| company_id | text | **нет** | → Company.id |
| milestone_key | text | **нет** |  |
| reached_at | timestamp | **нет** |  |

### `AuditLog` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| entity_type | text | **нет** |  |
| entity_id | text | **нет** |  |
| user_id | text | **нет** | → User.id |
| action | text | **нет** |  |
| old_values | jsonb | · |  |
| new_values | jsonb | · |  |
| at | timestamp | **нет** | = CURRENT_TIMESTAMP |

Индексы: `AuditLog_entity_type_entity_id_idx`, `AuditLog_user_id_idx`

### `Campaign` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| source_id | text | **нет** | → Source.id |
| name | text | **нет** |  |
| cost | numeric | · |  |
| started_at | timestamp | · |  |
| ended_at | timestamp | · |  |

### `CommissionAccrual` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| sales_rep_id | text | **нет** | → SalesRep.id |
| commission_plan_id | text | **нет** | → CommissionPlan.id |
| deal_id | text | · | → Deal.id |
| subscription_id | text | · | → Subscription.id |
| amount | numeric | **нет** |  |
| currency_id | text | **нет** | → Currency.id |
| period_start | timestamp | **нет** |  |
| period_end | timestamp | **нет** |  |
| status | text | **нет** | = 'pending' |
| accrual_type | text | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

### `CommissionPlan` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| name | text | **нет** |  |
| type | text | **нет** |  |
| valid_from | timestamp | **нет** |  |
| valid_to | timestamp | · |  |

### `CommissionRule` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| commission_plan_id | text | **нет** | → CommissionPlan.id |
| territory_id | text | · | → Territory.id |
| tier_min | numeric | · |  |
| tier_max | numeric | · |  |
| rate_pct | numeric | **нет** |  |
| rule_type | text | · |  |

### `Company` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| name | text | **нет** |  |
| territory_id | text | · | → Territory.id |
| domain | text | · |  |
| deleted_at | timestamp | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

### `Contact` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| company_id | text | · | → Company.id |
| name | text | **нет** |  |
| email | text | · |  |
| phone | text | · |  |
| position | text | · |  |

### `Contract` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| deal_id | text | · | → Deal.id |
| company_id | text | **нет** | → Company.id |
| territory_id | text | **нет** | → Territory.id |
| currency_id | text | **нет** | → Currency.id |
| price_list_id | text | · | → PriceList.id |
| start_date | timestamp | **нет** |  |
| end_date | timestamp | **нет** |  |
| length_months | integer | · |  |
| status | text | **нет** | = 'active' |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

### `Currency` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| code | text | **нет** |  |
| name | text | **нет** |  |
| symbol | text | · |  |

Индексы: `Currency_code_key`

### `Deal` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| pipeline_id | text | **нет** | → Pipeline.id |
| pipeline_stage_id | text | **нет** | → PipelineStage.id |
| company_id | text | **нет** | → Company.id |
| contact_id | text | · | → Contact.id |
| lead_id | text | · | → Lead.id |
| sales_rep_id | text | · | → SalesRep.id |
| amount | numeric | · |  |
| currency_id | text | · | → Currency.id |
| expected_close_at | timestamp | · |  |
| closed_at | timestamp | · |  |
| outcome | text | **нет** | = 'open' |
| deleted_at | timestamp | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

Индексы: `Deal_company_id_idx`, `Deal_pipeline_id_pipeline_stage_id_idx`, `Deal_sales_rep_id_idx`

### `HealthScore` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| company_id | text | · | → Company.id |
| subscription_id | text | · | → Subscription.id |
| score | integer | **нет** |  |
| usage_score | integer | · |  |
| support_score | integer | · |  |
| payment_score | integer | · |  |
| calculated_at | timestamp | **нет** |  |

### `IdempotencyKey` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| key | text | **нет** |  |
| result | jsonb | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

Индексы: `IdempotencyKey_key_key`

### `Invoice` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| subscription_id | text | · | → Subscription.id |
| contract_id | text | · | → Contract.id |
| amount | numeric | **нет** |  |
| currency_id | text | **нет** | → Currency.id |
| status | text | **нет** | = 'draft' |
| due_date | timestamp | · |  |
| paid_at | timestamp | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

### `Lead` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| company_id | text | · | → Company.id |
| contact_id | text | · | → Contact.id |
| source_id | text | · | → Source.id |
| campaign_id | text | · | → Campaign.id |
| territory_id | text | · | → Territory.id |
| partner_id | text | · | → Partner.id |
| channel | text | · |  |
| cost | numeric | · |  |
| referral_tracking_id | text | · |  |
| status | text | **нет** | = 'new' |
| score | numeric | · |  |
| assigned_to_id | text | · | → SalesRep.id |
| deleted_at | timestamp | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

### `MetricSnapshot` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| metric_key | text | **нет** |  |
| dimensions | jsonb | · |  |
| value | numeric | **нет** |  |
| period_type | text | **нет** |  |
| period_at | timestamp | **нет** |  |

### `Onboarding` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| company_id | text | **нет** | → Company.id |
| contract_id | text | **нет** | → Contract.id |
| status | text | **нет** | = 'not_started' |
| steps | jsonb | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

### `Partner` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| name | text | **нет** |  |
| territory_id | text | **нет** | → Territory.id |
| commission_pct | numeric | · |  |
| type | text | · |  |

### `Payment` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| invoice_id | text | **нет** | → Invoice.id |
| amount | numeric | **нет** |  |
| currency_id | text | **нет** | → Currency.id |
| paid_at | timestamp | **нет** |  |
| method | text | · |  |
| gateway_fee | numeric | · |  |

### `Payout` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| sales_rep_id | text | **нет** | → SalesRep.id |
| amount | numeric | **нет** |  |
| currency_id | text | **нет** | → Currency.id |
| paid_at | timestamp | **нет** |  |
| status | text | **нет** | = 'completed' |

### `Pipeline` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| code | text | **нет** |  |
| name | text | **нет** |  |

Индексы: `Pipeline_code_key`

### `PipelineSnapshot` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| pipeline_id | text | **нет** |  |
| stage_id | text | **нет** |  |
| deal_count | integer | **нет** |  |
| weighted_value | numeric | **нет** |  |
| snapshot_at | timestamp | **нет** |  |

### `PipelineStage` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| pipeline_id | text | **нет** | → Pipeline.id |
| name | text | **нет** |  |
| sort_order | integer | **нет** |  |
| probability_pct | numeric | · |  |
| sla_hours | integer | · |  |
| is_won | boolean | **нет** | = false |
| is_lost | boolean | **нет** | = false |

### `PriceList` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| territory_id | text | **нет** | → Territory.id |
| currency_id | text | **нет** | → Currency.id |
| valid_from | timestamp | **нет** |  |
| valid_to | timestamp | · |  |

### `PriceListItem` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| price_list_id | text | **нет** | → PriceList.id |
| product_id | text | **нет** | → Product.id |
| amount | numeric | **нет** |  |
| billing_cycle | text | · |  |

### `Product` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| name | text | **нет** |  |
| sku | text | · |  |
| type | text | **нет** |  |

### `Role` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| code | text | **нет** |  |
| name | text | **нет** |  |

Индексы: `Role_code_key`

### `SalesActivity` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| deal_id | text | · | → Deal.id |
| lead_id | text | · | → Lead.id |
| contact_id | text | · | → Contact.id |
| sales_rep_id | text | **нет** | → SalesRep.id |
| type | text | **нет** |  |
| subject | text | · |  |
| occurred_at | timestamp | **нет** |  |
| metadata | jsonb | · |  |
| duration_sec | integer | · |  |

### `SalesRep` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| user_id | text | **нет** | → User.id |
| territory_id | text | · | → Territory.id |
| name | text | **нет** |  |
| email | text | **нет** |  |

Индексы: `SalesRep_user_id_key`

### `Source` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| code | text | **нет** |  |
| name | text | **нет** |  |
| channel | text | · |  |

Индексы: `Source_code_key`

### `Subscription` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| contract_id | text | **нет** | → Contract.id |
| product_id | text | **нет** | → Product.id |
| mrr | numeric | **нет** |  |
| arr | numeric | **нет** |  |
| billing_cycle | text | **нет** |  |
| renewal_date | timestamp | **нет** |  |
| status | text | **нет** | = 'active' |
| churn_risk | text | · |  |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

Индексы: `Subscription_status_renewal_date_idx`

### `Task` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| deal_id | text | · | → Deal.id |
| lead_id | text | · | → Lead.id |
| subscription_id | text | · | → Subscription.id |
| assigned_to_id | text | **нет** | → SalesRep.id |
| created_by_id | text | · | → User.id |
| title | text | **нет** |  |
| due_at | timestamp | · |  |
| status | text | **нет** | = 'pending' |
| priority | text | · | = 'medium' |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

### `Territory` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| code | text | **нет** |  |
| name | text | **нет** |  |
| timezone | text | · |  |
| currency_id | text | **нет** | → Currency.id |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

Индексы: `Territory_code_key`

### `User` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| email | text | **нет** |  |
| password_hash | text | **нет** |  |
| name | text | · |  |
| role_id | text | **нет** | → Role.id |
| territory_id | text | · | → Territory.id |
| partner_id | text | · | → Partner.id |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |
| updated_at | timestamp | **нет** |  |

Индексы: `User_email_key`

### `Workflow` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | text | **нет** | PK |
| name | text | **нет** |  |
| trigger_entity | text | **нет** |  |
| trigger_event | text | **нет** |  |
| conditions | jsonb | · |  |
| actions | jsonb | · |  |
| is_active | boolean | **нет** | = true |
| created_at | timestamp | **нет** | = CURRENT_TIMESTAMP |

### `crm_calls` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(100) | **нет** | PK |
| phone_number | varchar(50) | **нет** |  |
| direction | varchar(20) | · | = 'outbound' |
| status | varchar(50) | · | = 'initiated' |
| duration | integer | · | = 0 |
| manager_id | varchar(100) | · |  |
| lead_id | varchar(100) | · |  |
| pbx_call_id | varchar(255) | · |  |
| recording_url | text | · |  |
| notes | text | · |  |
| created_at | timestamp | · | = now() |
| updated_at | timestamp | · | = now() |

### `crm_companies` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | · |  |
| created_at | timestamp | · | = now() |

### `crm_managers` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | · |  |
| created_at | timestamp | · | = now() |
| telegram_id | varchar(64) | · |  |

Индексы: `idx_crm_managers_telegram`

### `organizations` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| name | varchar(255) | **нет** |  |
| plan | varchar(20) | · | = 'free' |
| owner_agent_id | varchar(50) | · |  |
| bot_token | text | · |  |
| created_at | timestamp | · | = now() |

### `super_admins` · ~0 строк

| Колонка | Тип | Null | Прим. |
|---|---|---|---|
| id | varchar(50) | **нет** | PK |
| email | varchar(255) | **нет** |  |
| password_hash | varchar(255) | **нет** |  |
| name | varchar(255) | · |  |
| created_at | timestamp | · | = now() |

Индексы: `super_admins_email_key`
