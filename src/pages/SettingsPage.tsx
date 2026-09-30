import { DataSection } from '../features/settings/DataSection'
import { ModelSection } from '../features/settings/ModelSection'
import { ReadingSection } from '../features/settings/ReadingSection'

export function SettingsPage() {
  return (
    <div className="settings">
      <ModelSection />
      <ReadingSection />
      <DataSection />
    </div>
  )
}
