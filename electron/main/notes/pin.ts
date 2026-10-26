/** 本章同文划线里选「最早一条」（id 最小）。多条时 reusedEarliestDuplicate 为 true。 */
export function chooseHighlightForPin(
  sameText: readonly { id: number }[]
):
  | { kind: 'create' }
  | { kind: 'reuse'; id: number; reusedEarliestDuplicate: boolean } {
  if (sameText.length === 0) return { kind: 'create' }
  let earliest = sameText[0]!
  for (const row of sameText) {
    if (row.id < earliest.id) earliest = row
  }
  return {
    kind: 'reuse',
    id: earliest.id,
    reusedEarliestDuplicate: sameText.length > 1
  }
}
