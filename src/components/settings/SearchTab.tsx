import { ExternalLink, Zap } from 'lucide-react'
import { cx } from '../../lib/utils'
import { useSettings } from '../../state/settings'
import { Field, inputCls, Switch } from '../ui'

export function SearchTab() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const search = settings.search

  const setSearch = (patch: Partial<typeof search>) => update({ search: { ...search, ...patch } })

  return (
    <div>
      <p className="text-[12.5px] text-muted leading-relaxed mb-4">
        With <span className="text-ink font-medium">Web</span> toggled on in the composer, openplex plans several
        searches, runs them at once, ranks what comes back against your actual question, reads the pages worth
        reading, and answers with numbered citations.
      </p>

      <Field
        label="Tavily API key"
        hint={
          <>
            Tavily is built for this — it returns clean passages and full page text instead of a list of links. The
            free tier covers 1,000 searches a month.{' '}
            <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              Get a key <ExternalLink size={10} />
            </a>
          </>
        }
      >
        <input
          type="password"
          value={search.keys.tavily ?? ''}
          onChange={(e) => setSearch({ keys: { ...search.keys, tavily: e.target.value } })}
          placeholder="tvly-…"
          className={cx(inputCls, 'font-mono text-[12.5px]')}
        />
      </Field>

      <Field label="Results per search" hint="More results = better grounding but more input tokens.">
        <input
          type="number"
          min={2}
          max={12}
          value={search.maxResults}
          onChange={(e) => setSearch({ maxResults: Math.max(2, Math.min(12, Number(e.target.value) || 6)) })}
          className={cx(inputCls, 'w-24')}
        />
      </Field>

      <label className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-line cursor-pointer">
        <span>
          <span className="text-[13.5px] font-medium flex items-center gap-1.5">
            <Zap size={13} className="text-accent" /> Light search mode
          </span>
          <span className="block text-[12px] text-muted mt-1 leading-relaxed">
            Skips the model’s planning steps and sends short snippets only — a couple of searches, no
            agentic loop. Far fewer tokens per answer (~2–5k), for providers with tight per-minute limits
            like Cerebras’ free tier. Less thorough than full search.
          </span>
        </span>
        <Switch checked={!!search.light} onChange={(v) => setSearch({ light: v })} />
      </label>
    </div>
  )
}
