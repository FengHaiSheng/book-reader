import { registerSecretsIpc } from './secrets'
import { registerSettingsIpc } from './settings'

/** 所有 IPC handler 的唯一注册点。新增域时在这里加一行。 */
export function registerIpc(): void {
  registerSettingsIpc()
  registerSecretsIpc()
}
