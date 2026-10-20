import { DataSection } from '../features/settings/DataSection'
import { ModelSection } from '../features/settings/ModelSection'
import { ReadingSection } from '../features/settings/ReadingSection'
import { ReadingStatsSection } from '../features/settings/ReadingStatsSection'

export function SettingsPage() {
  return (
    <div className="settings">
      <ModelSection />
      <ReadingSection />
      <ReadingStatsSection />
      <DataSection />
    </div>
  )
}
