import type { CatalogModel, Usage } from './types'

export function computeCost(model: CatalogModel | undefined, inputTokens: number, outputTokens: number): number | undefined {
  const c = model?.cost
  if (!c || (c.input == null && c.output == null)) return undefined
  return (inputTokens * (c.input ?? 0) + outputTokens * (c.output ?? 0)) / 1_000_000
}

export function mergeUsage(model: CatalogModel | undefined, usage: Partial<Usage>): Usage {
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  return {
    inputTokens,
    outputTokens,
    estimated: usage.estimated,
    cost: computeCost(model, inputTokens, outputTokens),
  }
}
