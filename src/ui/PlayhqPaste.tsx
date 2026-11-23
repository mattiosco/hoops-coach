import { useMemo, useState } from 'react'
import { mergePlayhq, parsePlayhq } from '../lib/playhq'
import type { Fixture } from '../domain/types'

const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Paste a team's fixture page from PlayHQ and turn it into games. Nothing is saved until
 * the coach has seen the list and tapped Add — a paste of the wrong page should cost a
 * tap on Cancel, not a cleanup.
 */
export default function PlayhqPaste({
  existing,
  playhqUrl,
  onSave,
  onClose,
}: {
  existing: Fixture[]
  playhqUrl: string
  onSave: (fixtures: Fixture[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [clipboardError, setClipboardError] = useState<string | null>(null)

  const result = useMemo(() => (text.trim() ? parsePlayhq(text) : null), [text])
  const merge = useMemo(
    () => (result ? mergePlayhq(existing, result.games) : null),
    [existing, result],
  )

  const pasteFromClipboard = async () => {
    setClipboardError(null)
    try {
      setText(await navigator.clipboard.readText())
    } catch {
      setClipboardError('The phone would not hand over the clipboard — press and hold the box below and choose Paste.')
    }
  }

  const unchanged = merge ? result!.games.length - merge.added - merge.updated : 0

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row stack" style={{ alignItems: 'stretch', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Paste from PlayHQ</div>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>
            Open your team&apos;s page on PlayHQ, on the <strong>Fixture</strong> tab
            {playhqUrl ? (
              <>
                {' '}
                —{' '}
                <a href={playhqUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  open it ↗
                </a>
              </>
            ) : null}
            .
          </li>
          <li>
            Press and hold on the page, choose <strong>Select All</strong>, then{' '}
            <strong>Copy</strong>. On a computer, Ctrl+A then Ctrl+C.
          </li>
          <li>Come back here and paste. Only games still to come are added.</li>
        </ol>

        {'clipboard' in navigator && (
          <button className="btn-sm" onClick={() => void pasteFromClipboard()}>
            Paste what I copied
          </button>
        )}
        {clipboardError && (
          <span className="small" style={{ color: 'var(--amber)', lineHeight: 1.5 }}>
            {clipboardError}
          </span>
        )}

        <textarea
          value={text}
          rows={4}
          placeholder="…or paste here"
          onChange={(e) => setText(e.target.value)}
          style={{
            font: 'inherit',
            fontSize: 14,
            color: 'var(--text)',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 10,
            resize: 'vertical',
          }}
        />

        {result && result.games.length === 0 && result.skippedPast === 0 && (
          <span className="small" style={{ color: 'var(--amber)', lineHeight: 1.5 }}>
            No games found in that. Make sure it is copied from your team&apos;s Fixture tab
            on PlayHQ, with the whole page selected.
          </span>
        )}

        {result && (result.games.length > 0 || result.skippedPast > 0) && (
          <>
            <div className="small" style={{ lineHeight: 1.5 }}>
              {result.team && (
                <>
                  Team: <strong>{result.team}</strong>
                  <br />
                </>
              )}
              {result.games.length === 0
                ? 'Every game on that page has already been played — nothing to add.'
                : `${result.games.length} game${result.games.length === 1 ? '' : 's'} to come`}
              {result.skippedPast > 0 &&
                ` · ${result.skippedPast} already played, left out`}
            </div>
            {result.games.map((g) => (
              <div key={g.id} className="small" style={{ lineHeight: 1.4 }}>
                <strong>v {g.opponent}</strong>{' '}
                <span className="muted">
                  · {g.homeAway === 'home' ? 'Home' : 'Away'} · {fmt.format(new Date(g.startTime))}
                  {g.venue ? ` · ${g.venue}` : ''}
                  <br />
                  {g.round}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="row">
        <button
          className="btn-primary grow"
          disabled={!merge || merge.added + merge.updated === 0}
          onClick={() => merge && onSave(merge.fixtures)}
        >
          {!merge || merge.added + merge.updated === 0
            ? result && result.games.length > 0
              ? 'Already up to date'
              : 'Add games'
            : [
                merge.added ? `Add ${merge.added} new` : '',
                merge.updated ? `update ${merge.updated}` : '',
              ]
                .filter(Boolean)
                .join(', ')
                .replace(/^u/, 'U')}
        </button>
        <button className="btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
      {merge && unchanged > 0 && merge.added + merge.updated > 0 && (
        <div className="row small muted">{unchanged} already in your list and unchanged.</div>
      )}
    </div>
  )
}
