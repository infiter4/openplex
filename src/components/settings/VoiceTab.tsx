import type { SttOption } from '../../lib/stt'
import { useSettings } from '../../state/settings'
import { useStore } from '../../state/store'
import { VoiceModelList } from '../VoiceModelList'

export function VoiceTab() {
  const update = useSettings((s) => s.update)
  const openSettings = useStore((s) => s.openSettings)

  const choose = (o: SttOption) => {
    if (!o.connected) { openSettings('providers', o.providerId); return }
    update({ voice: { providerId: o.providerId, model: o.modelId } })
  }

  // Flush to the settings-card edges; a bounded height makes the list scroll internally so the
  // search + filters stay pinned at the top instead of scrolling away with the page.
  return (
    <div className="-mx-5 -mt-5 flex flex-col" style={{ height: 'calc(100vh - 250px)', minHeight: '380px' }}>
      <VoiceModelList variant="page" onChoose={choose} />
    </div>
  )
}
