import { registerAiIpc } from './ai'
import { registerBookmarksIpc } from './bookmarks'
import { registerDataIpc } from './data'
import { registerLibraryIpc } from './library'
import { registerNotesIpc } from './notes'
import { registerReaderIpc } from './reader'
import { registerReadingIpc } from './reading'
import { registerSecretsIpc } from './secrets'
import { registerSettingsIpc } from './settings'
import { registerShellIpc } from './shell'

/** 所有 IPC handler 的唯一注册点。新增域时在这里加一行。 */
export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
  registerLibraryIpc()
  registerReaderIpc()
  registerBookmarksIpc()
  registerReadingIpc()
  registerNotesIpc()
  registerShellIpc()
  registerDataIpc()
  registerAiIpc()
}
