import { neon } from '@neondatabase/serverless'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}))
const sql = neon(env.POSTGRES_URL||env.DATABASE_URL||env.NEON_URL)
const since = process.argv[2] || '2026-09-18T09:30:00Z'
const m = await sql`SELECT c.name, c.source, c.meta_page_id, m.sender_role, left(m.text_content,100) t, m.created_at
  FROM support_messages m JOIN support_channels c ON c.id=m.channel_id
  WHERE c.source IN ('instagram','messenger') AND m.created_at > ${since}::timestamptz ORDER BY m.created_at`
console.log('messages:', m.length); for (const r of m) console.log(JSON.stringify(r))
const st = await sql`SELECT d.channel_id, c.name, d.facts, d.who, d.lead_id, d.updated_at FROM sales_dialog_state d LEFT JOIN support_channels c ON c.id=d.channel_id WHERE d.updated_at > ${since}::timestamptz`
console.log('dialogs:', st.length); for (const r of st) console.log(JSON.stringify(r))
const a = await sql`SELECT action, status, channel, left(message,100) message, left(error,120) error, created_at FROM sales_assistant_log WHERE created_at > ${since}::timestamptz AND (channel IN ('instagram','messenger') OR action ILIKE 'qualif%' OR action ILIKE 'dialog%') ORDER BY created_at DESC LIMIT 10`.catch(e=>[{err:e.message}])
console.log('assistant:', a.length); for (const r of a) console.log(JSON.stringify(r))
